"use client"

import { useEffect, useMemo, useState } from "react"

import { Card } from "@/components/ui/Card"
import { InfoTip } from "@/components/ui/InfoTip"
import { Spinner } from "@/components/ui/States"
import {
  deleteSyncConfig,
  revalidateAll,
  saveSyncConfig,
  triggerSync,
  updateAthleteConfig,
  useAthleteConfig,
  useSyncConfig,
  useSyncStatus,
} from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { formatDateTime } from "@/lib/format"
import type { AthleteConfig } from "@/lib/types"

export default function SettingsPage() {
  const { athleteId, athletes } = useAthleteContext()
  const { data: config, isLoading: syncLoading, mutate: mutateConfig } = useSyncConfig()
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

  if (syncLoading) return <Spinner label="Loading settings…" />

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-500">
          Continuously sync new activities from Intervals.icu.
        </p>
      </header>

      <Card title="Intervals.icu sync">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Intervals.icu aggregates activities from Garmin, Strava and direct uploads through a
            free API. Generate a personal API key under{" "}
            <a
              href="https://intervals.icu/settings"
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              Developer Settings
            </a>{" "}
            and paste it below. Bind the sync to the athlete your existing imports belong to so
            duplicates are merged automatically.
          </p>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Athlete</span>
            <select
              value={selectedAthlete}
              onChange={(e) => setSelectedAthlete(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
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
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
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
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
            <span className="mt-1 block text-xs text-gray-400">
              Leave as <code className="font-mono">0</code> to sync your own account. Only change it
              to pull another athlete&apos;s data (e.g. as their coach).
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded border-gray-300 text-brand"
            />
            Enable sync
          </label>

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
                className="ml-auto rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </Card>

      {config && lastRun && (
        <Card title="Sync status">
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
        </Card>
      )}

      {athleteId && <AthleteConfigSection athleteId={athleteId} />}
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

function AthleteConfigSection({ athleteId }: { athleteId: string }) {
  const { data: cfg, isLoading, mutate: mutateCfg } = useAthleteConfig(athleteId)

  const [form, setForm] = useState<Partial<AthleteConfig>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cfg) {
      setForm({
        birthday: cfg.birthday,
        weight_kg: cfg.weight_kg,
        ftp: cfg.ftp,
        max_heart_rate: cfg.max_heart_rate,
        resting_heart_rate: cfg.resting_heart_rate,
        unit_system: cfg.unit_system,
        threshold_pace: cfg.threshold_pace,
      })
      setDirty(false)
    }
  }, [cfg])

  function update<K extends keyof AthleteConfig>(key: K, value: AthleteConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
    setNotice(null)
  }

  function numOrNull(v: string): number | null {
    const n = parseFloat(v)
    return isNaN(n) ? null : n
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await updateAthleteConfig(athleteId, form)
      await mutateCfg()
      revalidateAll()
      setDirty(false)
      setNotice("Settings saved.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings")
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return null

  return (
    <Card title="Athlete profile">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Training parameters used for zone calculations, pace analysis, and unit display. Values
          saved here override the YAML config file.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Birthday</span>
            <input
              type="date"
              value={form.birthday ?? ""}
              onChange={(e) => update("birthday", e.target.value || null)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Weight (kg)</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={form.weight_kg ?? ""}
              onChange={(e) => update("weight_kg", numOrNull(e.target.value))}
              placeholder="e.g. 72"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">FTP (watts)</span>
            <input
              type="number"
              min="0"
              value={form.ftp ?? ""}
              onChange={(e) => update("ftp", numOrNull(e.target.value))}
              placeholder="e.g. 250"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Max HR (bpm)</span>
            <input
              type="number"
              min="0"
              value={form.max_heart_rate ?? ""}
              onChange={(e) => update("max_heart_rate", numOrNull(e.target.value))}
              placeholder="e.g. 190"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Resting HR (bpm)</span>
            <input
              type="number"
              min="0"
              value={form.resting_heart_rate ?? ""}
              onChange={(e) => update("resting_heart_rate", numOrNull(e.target.value))}
              placeholder="e.g. 50"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center text-sm font-medium">
              Threshold pace (s/km)
              <InfoTip width="w-72">
                <p className="font-semibold">Functional Threshold Pace (FTP)</p>
                <p className="mt-1">The fastest pace you can sustain for ~60 min.</p>
                <p className="mt-2 font-semibold">Garmin users</p>
                <p className="mt-0.5">
                  Garmin Connect app → More → Performance Stats → Running Lactate Threshold
                </p>
                <p className="mt-0.5 text-gray-400">
                  Requires: Watch Settings → User Profile → HR &amp; Power Zones → Auto Detection →
                  ON
                </p>
                <p className="mt-2 font-semibold">Manual estimate</p>
                <ol className="mt-0.5 list-inside list-decimal">
                  <li>Run a 30-min time trial at max sustainable effort</li>
                  <li>Divide total seconds by distance in km</li>
                  <li>Multiply by 1.05 to approximate the 60-min pace</li>
                </ol>
                <p className="mt-1 text-gray-400">
                  Example: 30 min for 6.3 km → 286 s/km × 1.05 ≈ 300 s/km (5:00/km)
                </p>
              </InfoTip>
            </span>
            <input
              type="number"
              min="0"
              value={form.threshold_pace ?? ""}
              onChange={(e) => update("threshold_pace", numOrNull(e.target.value))}
              placeholder="e.g. 300"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Unit system</span>
            <select
              value={form.unit_system ?? "metric"}
              onChange={(e) => update("unit_system", e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="metric">Metric (km, m)</option>
              <option value="imperial">Imperial (mi, ft)</option>
            </select>
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-green-600">{notice}</p>}

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>
    </Card>
  )
}
