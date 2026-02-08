"use client"

import { useEffect, useMemo, useState } from "react"

import {
  deleteSyncConfig,
  revalidateAll,
  saveSyncConfig,
  triggerSync,
  useSyncConfig,
  useSyncStatus,
} from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { formatDateTime } from "@/lib/format"

const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"

export function IntervalsSettingsSection() {
  const { athleteId, athletes } = useAthleteContext()
  const { data: config, mutate: mutateConfig } = useSyncConfig()
  // Poll the status while a run is in progress so the UI updates live.
  const [polling, setPolling] = useState(false)
  const { data: status, mutate: mutateStatus } = useSyncStatus(polling)

  const [selectedAthlete, setSelectedAthlete] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [icuAthleteId, setIcuAthleteId] = useState("0")
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Seed the form from the saved config (or the active athlete) once loaded.
  useEffect(() => {
    if (config) {
      setSelectedAthlete(config.athlete_id)
      setIcuAthleteId(config.icu_athlete_id)
      setEnabled(config.enabled)
    } else if (athleteId) {
      setSelectedAthlete((prev) => prev || athleteId)
    }
  }, [config, athleteId])

  // Stop polling once the in-progress run finishes.
  useEffect(() => {
    if (polling && status && !status.running) {
      setPolling(false)
      revalidateAll()
      void mutateConfig()
    }
  }, [polling, status, mutateConfig])

  const running = status?.running ?? false
  const canSave = selectedAthlete && (apiKey.trim() || config?.has_api_key)

  const lastRun = useMemo(() => {
    const source = status ?? config
    if (!source) return null
    return {
      last_run_at: source.last_run_at,
      last_status: source.last_status,
      last_message: source.last_message,
      synced_through: source.synced_through,
    }
  }, [status, config])

  async function handleSave() {
    if (!selectedAthlete) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      // Reuse the stored key when the field is left blank on an existing config.
      const key = apiKey.trim()
      if (!key && !config?.has_api_key) {
        setError("An API key is required.")
        return
      }
      await saveSyncConfig({
        athlete_id: selectedAthlete,
        api_key: key,
        icu_athlete_id: icuAthleteId.trim() || "0",
        enabled,
      })
      setApiKey("")
      setNotice("Settings saved and credentials verified.")
      await mutateConfig()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings")
    } finally {
      setBusy(false)
    }
  }

  async function handleSync(fullResync: boolean) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await triggerSync(fullResync)
      setNotice(fullResync ? "Full resync started." : "Sync started.")
      setPolling(true)
      void mutateStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sync")
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!confirm("Remove the Intervals.icu sync configuration?")) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await deleteSyncConfig()
      setApiKey("")
      setNotice("Sync configuration removed.")
      await mutateConfig()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove settings")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Intervals.icu aggregates activities from different source (e.g. Garmin, Strava,.. etc) and
          direct uploads through a free API. Bind the sync to the athlete your existing imports
          belong to so duplicates are merged automatically.
        </p>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Athlete</span>
          <select
            value={selectedAthlete}
            onChange={(e) => setSelectedAthlete(e.target.value)}
            disabled={busy}
            className={INPUT_CLASS}
          >
            <option value="" disabled>
              Select an athlete…
            </option>
            {athletes.map((a) => (
              <option key={a.athlete_id} value={a.athlete_id}>
                {a.name ?? `Athlete ${a.athlete_id}`}
              </option>
            ))}
          </select>
          {athletes.length === 0 && (
            <span className="mt-1 block text-xs text-gray-400">
              Import data first to create an athlete to bind the sync to.
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            API key{" "}
            {config?.has_api_key && (
              <span className="font-normal text-gray-400">(stored - leave blank to keep)</span>
            )}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.has_api_key ? "••••••••••••" : "Personal API key"}
            disabled={busy}
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-gray-400">
            Generate a personal key on Intervals.icu under{" "}
            <a
              href="https://intervals.icu/settings"
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              Settings → Developer Settings
            </a>
            .
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Intervals.icu athlete id{" "}
            <span className="font-normal text-gray-400">(0 = your account)</span>
          </span>
          <input
            type="text"
            value={icuAthleteId}
            onChange={(e) => setIcuAthleteId(e.target.value)}
            disabled={busy}
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-gray-400">
            Leave as <code className="font-mono">0</code> to sync your own account. Only change it
            to pull another athlete&apos;s data (e.g. as their coach).
          </span>
        </label>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded border-gray-300 text-brand"
            />
            Enable Sync
          </label>
          <span className="mt-1 block text-xs text-gray-400">
            When on, FitMe automatically syncs once a day, the first time the app starts that day
            (repeated restarts the same day are skipped). Turn it off to pause all syncing,
            including the manual Sync now button.
          </span>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-green-600">{notice}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSave}
            disabled={busy || !canSave}
            title="Save your credentials and verify the API key works with Intervals.icu"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {config ? "Save & verify" : "Connect"}
          </button>
          <button
            onClick={() => handleSync(false)}
            disabled={busy || running || !config}
            title="Fetch only new activities added since the last sync (quick)"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {running ? "Syncing…" : "Sync now"}
          </button>
          <button
            onClick={() => handleSync(true)}
            disabled={busy || running || !config}
            title="Re-fetch your entire Intervals.icu history from scratch (slow)"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Full resync
          </button>
          {config && (
            <button
              onClick={handleDelete}
              disabled={busy || running}
              title="Remove the sync config and stop all future syncing"
              className="ml-auto rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {config && lastRun && (
        <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h4 className="mb-3 text-sm font-semibold">Sync status</h4>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-400">State</dt>
              <dd className="font-medium">
                {running ? (
                  <span className="text-brand">Running…</span>
                ) : (
                  <StatusBadge status={lastRun.last_status} />
                )}
              </dd>
            </div>
            <div>
              <dt className="text-gray-400">Last run</dt>
              <dd className="font-medium">
                {lastRun.last_run_at ? formatDateTime(lastRun.last_run_at) : "Never"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-400">Synced through</dt>
              <dd className="font-medium">
                {lastRun.synced_through ? formatDateTime(lastRun.synced_through) : "Not yet"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-400">Details</dt>
              <dd className="font-medium break-words">{formatRunMessage(lastRun.last_message)}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (status === "ok") return <span className="text-green-600">Up to date</span>
  if (status === "error") return <span className="text-red-600">Error</span>
  if (status === "running") return <span className="text-brand">Running…</span>
  return <span className="text-gray-400">Idle</span>
}

function formatRunMessage(message: string | null | undefined): string {
  if (!message) return "-"
  try {
    const data = JSON.parse(message) as Record<string, unknown>
    if (typeof data.error === "string") return data.error
    const added = Number(data.added ?? 0)
    const updated = Number(data.updated ?? 0)
    const deduped = Number(data.deduped ?? 0)
    const skipped = Number(data.skipped ?? 0)
    return `${added} added, ${updated} updated, ${deduped} merged, ${skipped} unchanged`
  } catch {
    return message
  }
}
