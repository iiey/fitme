"use client"

import { useEffect, useState } from "react"

import { Card } from "@/components/ui/Card"
import { InfoTip } from "@/components/ui/InfoTip"
import { Spinner } from "@/components/ui/States"
import { revalidateAll, updateAthleteConfig, useAthleteConfig } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import type { AthleteConfig } from "@/lib/types"

export default function AthleteProfilePage() {
  const { athleteId } = useAthleteContext()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Athlete Profile</h1>
        <p className="text-sm text-gray-500">
          Training parameters used for zone calculations, pace analysis, and unit display.
        </p>
      </header>

      {athleteId ? (
        <AthleteConfigSection athleteId={athleteId} />
      ) : (
        <Card title="Athlete profile">
          <p className="text-sm text-gray-500">
            Import data first to create an athlete, then configure their profile here.
          </p>
        </Card>
      )}
    </div>
  )
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
    return Number.isNaN(n) ? null : n
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

  if (isLoading) return <Spinner label="Loading profile…" />

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
            type="button"
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
