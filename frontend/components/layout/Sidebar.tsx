"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ImportDialog } from "@/components/import/ImportDialog";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { deleteAthlete, revalidateAll, useMeta } from "@/lib/api";
import { useAthleteContext } from "@/lib/athlete-context";
import type { AthleteListItem } from "@/lib/types";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/fitness", label: "Fitness", icon: "📈 " },
  { href: "/activities", label: "Activities", icon: "📋" },
  { href: "/calendar", label: "Calendar", icon: "🗓️" },
  { href: "/heatmap", label: "Heatmap", icon: "🗺️" },
  { href: "/milestones", label: "Milestones", icon: "🏆" },
  { href: "/rewind", label: "Rewind", icon: "⏪" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { athleteId, setAthleteId, athletes, setAthletes } = useAthleteContext();
  const { data: meta } = useMeta(athleteId);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!meta) return;
    setAthletes(meta.athletes);
    if (meta.athletes.length === 0) {
      // All data was wiped - drop any persisted selection.
      if (athleteId) setAthleteId(null);
      return;
    }
    // Reset a missing or stale selection (e.g. an id cached in the browser
    // after a db reset or importing a different export) to a valid athlete.
    const exists = meta.athletes.some((a) => a.athlete_id === athleteId);
    if (!athleteId || !exists) {
      setAthleteId(meta.athletes[0].athlete_id);
    }
  }, [meta, athleteId, setAthleteId, setAthletes]);

  return (
    <aside className="fixed left-0 top-0 z-20 hidden h-screen w-64 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 lg:flex">
      <div className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🏃</span>
          <span className="text-xl font-bold tracking-tight">
            Fit<span className="text-brand">Me</span>
          </span>
        </div>
        <ThemeToggle />
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand/10 text-brand"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200",
              )}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-2 border-t border-gray-200 p-3 dark:border-gray-700">
        <button
          onClick={() => setImportOpen(true)}
          className="flex w-full items-center gap-3 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
        >
          <span className="text-lg">⬆️</span>
          Import data
        </button>
        <AthleteSwitcher
          athletes={athletes}
          activeId={athleteId}
          onSwitch={setAthleteId}
        />
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </aside>
  );
}

function AthleteSwitcher({
  athletes,
  activeId,
  onSwitch,
}: {
  athletes: AthleteListItem[];
  activeId: string | null;
  onSwitch: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setDeleting(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const active = athletes.find((a) => a.athlete_id === activeId);

  if (athletes.length === 0) {
    return <p className="px-3 py-2 text-xs text-gray-400">Self-hosted · Strava export</p>;
  }

  const initials = (name: string | null) =>
    (name ?? "?")
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  async function handleDelete(id: string) {
    try {
      await deleteAthlete(id);
      setDeleting(null);
      setOpen(false);
      if (activeId === id) {
        const remaining = athletes.filter((a) => a.athlete_id !== id);
        onSwitch(remaining.length > 0 ? remaining[0].athlete_id : null);
      }
      revalidateAll();
    } catch {
      setDeleting(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
          {initials(active?.name ?? null)}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-200">
            {active?.name ?? "Select athlete"}
          </span>
          {active?.location && (
            <span className="block truncate text-xs text-gray-400">{active.location}</span>
          )}
        </span>
        <span className="text-xs text-gray-400">{open ? "▲" : "▼"}</span>
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
                        onClick={() => handleDelete(athlete.athlete_id)}
                        className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                      >
                        Yes
                      </button>
                      <button
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
                      onClick={() => {
                        onSwitch(athlete.athlete_id);
                        setOpen(false);
                      }}
                      className="flex flex-1 items-center gap-2"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
                        {initials(athlete.name)}
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate font-medium">{athlete.name ?? "Unknown"}</span>
                        <span className="block truncate text-xs text-gray-400">
                          {athlete.activity_count} activities
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => setDeleting(athlete.athlete_id)}
                      className="hidden rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 group-hover:block dark:hover:bg-red-900/20"
                      title="Delete athlete"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
