"use client"

import clsx from "clsx"
import {
  Activity,
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  LayoutDashboard,
  type LucideIcon,
  Map as MapIcon,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Rewind,
  Settings,
  Sun,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  Upload,
  User,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

import { ImportDialog } from "@/components/import/ImportDialog"
import { SettingsModal } from "@/components/settings/SettingsModal"
import { type Theme, useTheme } from "@/components/ui/ThemeToggle"
import {
  ApiError,
  deleteAthlete,
  revalidateAll,
  triggerSync,
  useMeta,
  useSyncConfig,
  useSyncStatus,
} from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { useSidebar } from "@/lib/sidebar-context"
import type { AthleteListItem, SyncStatus } from "@/lib/types"

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/fitness", label: "Fitness", icon: TrendingUp },
  { href: "/activities", label: "Activities", icon: ClipboardList },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/heatmap", label: "Heatmap", icon: MapIcon },
  { href: "/milestones", label: "Milestones", icon: Trophy },
  { href: "/rewind", label: "Rewind", icon: Rewind },
]

type SyncBannerState = {
  phase: "running" | "done" | "error"
  message: string
}

/** Read the current sync watermark (last_run_at), falling back when unavailable. */
async function fetchSyncBaseline(fallback: string | null): Promise<string | null> {
  try {
    const response = await fetch("/api/sync/status")
    if (!response.ok) return fallback
    const data = await response.json()
    return (data?.last_run_at as string | null) ?? null
  } catch {
    return fallback
  }
}

/** Turn the persisted sync run state into a friendly banner message. */
function summarizeSync(status: SyncStatus): SyncBannerState {
  if (status.last_status === "error") {
    let detail = "Sync failed"
    try {
      const parsed = JSON.parse(status.last_message ?? "{}")
      if (typeof parsed.error === "string") detail = `Sync failed: ${parsed.error}`
    } catch {
      // Non-JSON message - keep the generic text.
    }
    return { phase: "error", message: detail }
  }

  let added = 0
  let updated = 0
  try {
    const parsed = JSON.parse(status.last_message ?? "{}")
    added = Number(parsed.added) || 0
    updated = Number(parsed.updated) || 0
  } catch {
    // Treat an unparseable message as "no changes".
  }
  if (added === 0 && updated === 0) {
    return { phase: "done", message: "Already up to date- no new activities" }
  }
  const parts: string[] = []
  if (added > 0) parts.push(`${added} new ${added === 1 ? "activity" : "activities"}`)
  if (updated > 0) parts.push(`${updated} updated`)
  return { phase: "done", message: `Sync complete- ${parts.join(", ")}` }
}

/** Small, non-disruptive toast pinned to the top of the viewport. */
function SyncBanner({ state, onDismiss }: { state: SyncBannerState; onDismiss: () => void }) {
  const Icon =
    state.phase === "running" ? RefreshCw : state.phase === "done" ? CheckCircle2 : AlertCircle
  const tone = {
    running:
      "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200",
    done: "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300",
    error:
      "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300",
  }[state.phase]
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "fixed left-1/2 top-16 z-[60] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg lg:top-4",
        tone,
      )}
    >
      <Icon
        className={clsx("h-4 w-4 shrink-0", state.phase === "running" && "animate-spin text-brand")}
        strokeWidth={2.25}
      />
      <span className="truncate">{state.message}</span>
      {state.phase !== "running" && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 ml-1 shrink-0 rounded-full p-0.5 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { athleteId, setAthleteId, athletes, setAthletes } = useAthleteContext()
  const { data: meta } = useMeta(athleteId)
  const { data: syncConfig } = useSyncConfig()
  const { collapsed, toggleCollapsed } = useSidebar()
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // -- Intervals.icu sync feedback ------------------------------------------
  // Clicking "Sync" kicks off a background job on the server; we surface its
  // progress and result in a small banner by polling the status endpoint.
  const [syncBanner, setSyncBanner] = useState<SyncBannerState | null>(null)
  const [syncPolling, setSyncPolling] = useState(false)
  const { data: syncStatus } = useSyncStatus(syncPolling)
  // The last_run_at of the previous run, captured up-front so we can tell when
  // a *new* run has finished (rather than reading a stale earlier result).
  const syncBaselineRef = useRef<string | null | undefined>(undefined)

  const startSync = useCallback(async () => {
    setSyncBanner({ phase: "running", message: "Syncing with Intervals.icu…" })
    // Capture the pre-run watermark from a fresh read (taken *before* we trigger)
    // so we can reliably tell when this run finishes - its last_run_at advances
    // on completion - without mistaking a stale earlier result for our run.
    syncBaselineRef.current = await fetchSyncBaseline(syncStatus?.last_run_at ?? null)
    try {
      await triggerSync(false)
      setSyncPolling(true)
    } catch (err) {
      // A 409 means a sync/import is already in flight - track it to the end
      // rather than reporting a scary error.
      if (err instanceof ApiError && err.status === 409) {
        setSyncBanner({ phase: "running", message: "A sync is already running…" })
        setSyncPolling(true)
        return
      }
      setSyncBanner({
        phase: "error",
        message: err instanceof Error ? err.message : "Could not start sync",
      })
    }
  }, [syncStatus?.last_run_at])

  // When the background run finishes, surface the outcome and refresh data.
  useEffect(() => {
    if (!syncPolling || !syncStatus) return
    if (syncStatus.running) return
    if (syncStatus.last_run_at === syncBaselineRef.current) return
    setSyncPolling(false)
    setSyncBanner(summarizeSync(syncStatus))
    revalidateAll()
  }, [syncPolling, syncStatus])

  // A successful banner auto-dismisses; errors stay until the user closes them.
  useEffect(() => {
    if (syncBanner?.phase !== "done") return
    const timer = setTimeout(() => setSyncBanner(null), 6000)
    return () => clearTimeout(timer)
  }, [syncBanner])

  useEffect(() => {
    if (!meta) return
    setAthletes(meta.athletes)
    if (meta.athletes.length === 0) {
      if (athleteId) setAthleteId(null)
      return
    }
    const exists = meta.athletes.some((a) => a.athlete_id === athleteId)
    if (!athleteId || !exists) {
      setAthleteId(meta.athletes[0].athlete_id)
    }
  }, [meta, athleteId, setAthleteId, setAthletes])

  // Close mobile nav on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [])

  // Rendered for both the mobile slide-out (always expanded) and the desktop
  // rail (collapsible). `rail` drives the icon-only, label-free layout.
  const renderBody = (rail: boolean) => (
    <>
      <div
        className={clsx(
          "flex items-center py-5",
          rail ? "justify-center px-3" : "justify-between px-6",
        )}
      >
        {!rail && (
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
              <Activity className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="text-xl font-bold tracking-tight">
              Fit<span className="text-brand">Me</span>
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 lg:block"
          aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
          title={rail ? "Expand sidebar" : "Collapse sidebar"}
        >
          {rail ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className={clsx("flex flex-1 flex-col gap-1 py-2", rail ? "px-2" : "px-3")}>
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              title={rail ? item.label : undefined}
              className={clsx(
                "flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
                rail ? "justify-center px-2" : "gap-3 px-3",
                active
                  ? "bg-brand/10 text-brand"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.25 : 2} />
              {!rail && item.label}
            </Link>
          )
        })}
      </nav>
      <div className={clsx("border-t border-gray-200 dark:border-gray-700", rail ? "p-2" : "p-3")}>
        <AthleteSwitcher
          collapsed={rail}
          athletes={athletes}
          activeId={athleteId}
          onSwitch={setAthleteId}
          onImport={() => setImportOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          syncConfigured={!!syncConfig}
          syncing={syncBanner?.phase === "running"}
          onSync={startSync}
        />
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  )

  return (
    <>
      {syncBanner && <SyncBanner state={syncBanner} onDismiss={() => setSyncBanner(null)} />}
      {/* Mobile top bar */}
      <div className="fixed left-0 right-0 top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900 lg:hidden">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white">
            <Activity className="h-4 w-4" strokeWidth={2.5} />
          </span>
          <span className="text-lg font-bold tracking-tight">
            Fit<span className="text-brand">Me</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: mobile nav backdrop; the menu has keyboard-accessible controls and closes on navigation
        // biome-ignore lint/a11y/useKeyWithClickEvents: mobile nav backdrop; the menu has keyboard-accessible controls and closes on navigation
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile slide-out sidebar */}
      <aside
        className={clsx(
          "fixed left-0 top-0 z-50 flex h-screen w-72 flex-col border-r border-gray-200 bg-white transition-transform duration-300 dark:border-gray-700 dark:bg-gray-900 lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {renderBody(false)}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={clsx(
          "fixed left-0 top-0 z-20 hidden h-screen flex-col border-r border-gray-200 bg-white transition-[width] duration-200 dark:border-gray-700 dark:bg-gray-900 lg:flex",
          collapsed ? "w-16" : "w-64",
        )}
      >
        {renderBody(collapsed)}
      </aside>
    </>
  )
}

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

function AthleteSwitcher({
  collapsed,
  athletes,
  activeId,
  onSwitch,
  onImport,
  onOpenSettings,
  syncConfigured,
  syncing,
  onSync,
}: {
  collapsed: boolean
  athletes: AthleteListItem[]
  activeId: string | null
  onSwitch: (id: string | null) => void
  onImport: () => void
  onOpenSettings: () => void
  syncConfigured: boolean
  syncing: boolean
  onSync: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { setProfileMenuOpen } = useSidebar()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) setAppearanceOpen(false)
  }, [open])

  // Let overlays (e.g. the chat launcher) step aside while this menu is open.
  useEffect(() => {
    setProfileMenuOpen(open)
  }, [open, setProfileMenuOpen])

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
        setAppearanceOpen(false)
        setDeleting(null)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const active = athletes.find((a) => a.athlete_id === activeId)
  const hasAthletes = athletes.length > 0

  const initials = (name: string | null) =>
    (name ?? "?")
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()

  async function handleDelete(id: string) {
    try {
      await deleteAthlete(id)
      setDeleting(null)
      setOpen(false)
      if (activeId === id) {
        const remaining = athletes.filter((a) => a.athlete_id !== id)
        onSwitch(remaining.length > 0 ? remaining[0].athlete_id : null)
      }
      revalidateAll()
    } catch {
      setDeleting(null)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={collapsed ? (active?.name ?? "Menu") : undefined}
        className={clsx(
          "flex w-full items-center rounded-lg py-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
          collapsed ? "justify-center px-0" : "gap-2 px-2",
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
          {active ? initials(active.name) : <User className="h-4 w-4" />}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-200">
                {active?.name ?? (hasAthletes ? "Select athlete" : "FitMe")}
              </span>
              <span className="block truncate text-xs text-gray-400">
                {active?.location ?? "Self-hosted"}
              </span>
            </span>
            <span className="text-gray-400">
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="max-h-60 overflow-y-auto p-1">
            {athletes.map((athlete) => (
              <div
                key={athlete.athlete_id}
                className={clsx(
                  "group flex items-center gap-2 rounded-md px-2 py-2 text-sm",
                  athlete.athlete_id === activeId
                    ? "bg-brand/10 text-brand"
                    : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800",
                )}
              >
                {deleting === athlete.athlete_id ? (
                  <div className="flex flex-1 items-center justify-between">
                    <span className="text-xs text-red-600">Delete all data?</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleDelete(athlete.athlete_id)}
                        className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(null)}
                        className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
                      >
                        No
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onSwitch(athlete.athlete_id)
                        setOpen(false)
                      }}
                      className="flex flex-1 items-center gap-2"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
                        {initials(athlete.name)}
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate font-medium">
                          {athlete.name ?? "Unknown"}
                        </span>
                        <span className="block truncate text-xs text-gray-400">
                          {athlete.activity_count} activities
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(athlete.athlete_id)}
                      className="hidden rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 group-hover:block dark:hover:bg-red-900/20"
                      title="Delete athlete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          {hasAthletes && <div className="border-t border-gray-200 dark:border-gray-700" />}
          <div className="p-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm",
                pathname.startsWith("/settings")
                  ? "bg-brand/10 text-brand"
                  : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800",
              )}
            >
              <User className="h-4 w-4 shrink-0" />
              Profile
            </Link>
            <button
              type="button"
              onClick={() => {
                onOpenSettings()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Settings className="h-4 w-4 shrink-0" />
              Settings
            </button>
            <button
              type="button"
              onClick={() => {
                onImport()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Upload className="h-4 w-4 shrink-0" />
              Import data
            </button>
            <button
              type="button"
              title={
                syncConfigured
                  ? "Fetch new activities from Intervals.icu"
                  : "Set up Intervals.icu sync in Settings first"
              }
              onClick={() => {
                if (!syncConfigured) {
                  router.push("/settings")
                  setOpen(false)
                  return
                }
                setOpen(false)
                onSync()
              }}
              disabled={syncing}
              className={clsx(
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm",
                syncConfigured
                  ? "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                  : "text-gray-400 dark:text-gray-500",
              )}
            >
              <RefreshCw className={clsx("h-4 w-4 shrink-0", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync"}
            </button>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: hover only reveals the menu; the toggle button inside is the keyboard-accessible control */}
            <div
              className="relative"
              onMouseEnter={() => setAppearanceOpen(true)}
              onMouseLeave={() => setAppearanceOpen(false)}
            >
              <button
                type="button"
                onClick={() => setAppearanceOpen(!appearanceOpen)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {theme === "light" ? (
                  <Sun className="h-4 w-4 shrink-0" />
                ) : theme === "dark" ? (
                  <Moon className="h-4 w-4 shrink-0" />
                ) : (
                  <Monitor className="h-4 w-4 shrink-0" />
                )}
                <span className="flex-1 text-left">Appearance</span>
                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
              </button>
              {appearanceOpen && (
                <div className="absolute bottom-0 left-full pl-1">
                  <div className="w-40 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                    {THEME_OPTIONS.map((opt) => {
                      const Icon = opt.icon
                      return (
                        <button
                          type="button"
                          key={opt.value}
                          onClick={() => {
                            setTheme(opt.value)
                            setAppearanceOpen(false)
                            setOpen(false)
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          <Icon className="h-4 w-4" />
                          <span className="flex-1 text-left">{opt.label}</span>
                          {theme === opt.value && <Check className="h-4 w-4 text-brand" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
