"use client"

import type { EChartsOption } from "echarts"
import dynamic from "next/dynamic"
import Link from "next/link"
import { use, useCallback, useState } from "react"
import { mutate } from "swr"

import { EChart } from "@/components/charts/EChart"
import { Card } from "@/components/ui/Card"
import { InfoTip } from "@/components/ui/InfoTip"
import { StatCard } from "@/components/ui/StatCard"
import { ErrorState, Spinner } from "@/components/ui/States"
import { updateActivityNote, useActivity, useMeta } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import {
  colorForActivityType,
  formatActivityPace,
  formatDate,
  formatDuration,
  formatNumber,
} from "@/lib/format"
import type { ActivityDetail, HrCurvePoint, HrZoneItem, PaceZoneItem } from "@/lib/types"

const RouteMap = dynamic(() => import("@/components/map/RouteMap"), { ssr: false })

function streamChart(
  distance: (number | null)[],
  values: (number | null)[],
  color: string,
  unit: string,
): EChartsOption {
  const data = distance.map((d, index) => [d ? d / 1000 : 0, values[index]])
  return {
    grid: { left: 50, right: 20, top: 12, bottom: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.95)",
      borderColor: "#e5e7eb",
      textStyle: { color: "#374151", fontSize: 12 },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params
        const val = (p as { value: [number, number] }).value
        return `<strong>${formatNumber(val[1], 1)} ${unit}</strong><br/><span style="color:#9ca3af">${formatNumber(val[0], 2)} km</span>`
      },
    },
    xAxis: {
      type: "value",
      name: "km",
      nameLocation: "middle",
      nameGap: 22,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: { fontSize: 10, color: "#9ca3af" },
      axisLine: { lineStyle: { color: "#e5e7eb" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: unit,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: { fontSize: 10, color: "#9ca3af" },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "#f3f4f6", type: "dashed" } },
    },
    series: [
      {
        type: "line",
        data,
        showSymbol: false,
        smooth: 0.3,
        lineStyle: { color, width: 1.5 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: color + "40" },
              { offset: 1, color: color + "05" },
            ],
          } as unknown as string,
        },
      },
    ],
  }
}

/** Format a window length (seconds) compactly: "15s", "5m", "1.5h". */
function formatWindowLabel(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hours = seconds / 3600
  return hours % 1 === 0 ? `${hours}h` : `${hours.toFixed(1)}h`
}

const HR_CURVE_HELP =
  "Highest average heart rate you sustained for each window length.\n\n" +
  "How to read:\n" +
  "• Left (short windows) ≈ your peak HR.\n" +
  "• Right (long windows) ≈ your average HR.\n" +
  "• It always slopes down by definition - it does NOT mean HR fell during the run.\n\n" +
  "Use it: a higher curve = a harder, more sustained effort. Compare the 5–60 min range across runs to gauge fitness or fatigue.\n\n" +
  "It shows WHAT you sustained, not WHEN."

const HR_CURVE_TICKS = [1, 5, 15, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 10800]

/** Mean-maximal HR curve: best sustained average HR vs window duration (log x). */
function hrCurveChart(curve: HrCurvePoint[]): EChartsOption {
  const color = "#dc2626"
  const maxDuration = Math.max(...curve.map((p) => p.duration_s))
  const ticks = HR_CURVE_TICKS.filter((t) => t <= maxDuration * 1.1)
  const toLog = (v: number) => Math.log10(v)
  const data = curve.map((p) => [toLog(p.duration_s), p.bpm])
  return {
    grid: { left: 50, right: 20, top: 12, bottom: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.95)",
      borderColor: "#e5e7eb",
      textStyle: { color: "#374151", fontSize: 12 },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params
        const val = (p as { value: [number, number] }).value
        const seconds = 10 ** val[0]
        return `<strong>${Math.round(val[1])} bpm</strong><br/><span style="color:#9ca3af">best average over ${formatWindowLabel(seconds)}</span>`
      },
    },
    xAxis: {
      type: "value",
      name: "duration",
      nameLocation: "middle",
      nameGap: 22,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      min: toLog(ticks[0]),
      max: toLog(ticks[ticks.length - 1]),
      axisLabel: {
        fontSize: 10,
        color: "#9ca3af",
        customValues: ticks.map(toLog),
        formatter: (value: number) => formatWindowLabel(Math.round(10 ** value)),
      },
      axisTick: { show: true, customValues: ticks.map(toLog) },
      axisLine: { lineStyle: { color: "#e5e7eb" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "bpm",
      scale: true,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: { fontSize: 10, color: "#9ca3af" },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "#f3f4f6", type: "dashed" } },
    },
    series: [
      {
        type: "line",
        data,
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { color, width: 2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: color + "40" },
              { offset: 1, color: color + "05" },
            ],
          } as unknown as string,
        },
      },
    ],
  }
}

const ZONE_COLORS = ["#9ca3af", "#3b82f6", "#22c55e", "#f97316", "#ef4444"]

function HrZones({ zones }: { zones: HrZoneItem[] }) {
  const maxPct = Math.max(...zones.map((z) => z.percentage), 1)
  return (
    <div className="space-y-2.5">
      {[...zones].reverse().map((z) => (
        <div key={z.zone} className="flex items-center gap-3">
          <div className="w-28 shrink-0">
            <div className="text-sm font-semibold">
              Zone {z.zone}
              <span className="ml-1.5 font-normal text-gray-400 text-xs">
                {z.upper_bpm ? `${z.lower_bpm}–${z.upper_bpm}` : `> ${z.lower_bpm}`} bpm
              </span>
            </div>
            <div className="text-xs text-gray-400">{z.label}</div>
          </div>
          <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max((z.percentage / maxPct) * 100, 1)}%`,
                backgroundColor: ZONE_COLORS[z.zone - 1],
              }}
            />
          </div>
          <div className="w-16 text-right text-sm tabular-nums">{formatDuration(z.seconds)}</div>
          <div className="w-10 text-right text-sm font-medium tabular-nums">{z.percentage}%</div>
        </div>
      ))}
    </div>
  )
}

function formatZonePace(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}:${String(secs).padStart(2, "0")}`
}

function PaceZones({ zones }: { zones: PaceZoneItem[] }) {
  const maxPct = Math.max(...zones.map((z) => z.percentage), 1)
  return (
    <div className="space-y-2.5">
      {[...zones].reverse().map((z) => (
        <div key={z.zone} className="flex items-center gap-3">
          <div className="w-32 shrink-0">
            <div className="text-sm font-semibold">
              Zone {z.zone}
              <span className="ml-1.5 font-normal text-gray-400 text-xs">
                {z.fast_pace == null
                  ? `< ${formatZonePace(z.slow_pace!)} /km`
                  : z.slow_pace == null
                    ? `> ${formatZonePace(z.fast_pace)} /km`
                    : `${formatZonePace(z.fast_pace)}–${formatZonePace(z.slow_pace)} /km`}
              </span>
            </div>
            <div className="text-xs text-gray-400">{z.label}</div>
          </div>
          <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max((z.percentage / maxPct) * 100, 1)}%`,
                backgroundColor: ZONE_COLORS[z.zone - 1],
              }}
            />
          </div>
          <div className="w-16 text-right text-sm tabular-nums">{formatDuration(z.seconds)}</div>
          <div className="w-10 text-right text-sm font-medium tabular-nums">{z.percentage}%</div>
        </div>
      ))}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || value === "-") return null
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

export default function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { athleteId } = useAthleteContext()
  const { data: activity, error, isLoading } = useActivity(athleteId, id)
  const { data: meta } = useMeta(athleteId)

  if (isLoading) return <Spinner label="Loading activity…" />
  if (error || !activity) return <ErrorState message="Activity not found." />

  const distanceUnit = meta?.distance_unit ?? "km"
  const distance = distanceUnit === "mi" ? activity.distance_mi : activity.distance_km
  const color = colorForActivityType(activity.activity_type)
  const distanceStream = activity.streams.distance ?? []

  const hasHr = activity.average_heart_rate != null
  const hasCadence = activity.average_cadence != null
  const hasPower = activity.average_power != null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/activities" className="text-sm text-brand hover:underline">
          &larr; Back to activities
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{activity.name}</h1>
        <p className="text-sm text-gray-500">
          {activity.sport_label} &middot;{" "}
          {formatDate(activity.start_date_time, "EEEE yyyy-MM-dd 'at' HH:mm")}
        </p>
        {activity.description && (
          <p className="mt-2 text-sm text-gray-600 italic">{activity.description}</p>
        )}
      </div>

      {/* Primary stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={`Distance (${distanceUnit})`} value={formatNumber(distance, 2)} accent />
        <StatCard label="Moving Time" value={formatDuration(activity.moving_time_s)} />
        <StatCard label="Pace / Speed" value={formatActivityPace(activity)} />
        <StatCard label="Elevation" value={`${formatNumber(activity.elevation_m, 0)} m`} />
      </div>

      {/* Route map + Note */}
      {activity.polyline ? (
        <ActivityNote activityId={id} athleteId={athleteId} note={activity.user_note}>
          <Card title="Route" className="min-w-0 flex-1">
            <RouteMap polyline={activity.polyline} color={color} height={360} />
          </Card>
        </ActivityNote>
      ) : (
        <ActivityNote activityId={id} athleteId={athleteId} note={activity.user_note} />
      )}

      {/* Heart Rate Curve (mean-maximal) */}
      {activity.hr_curve && activity.hr_curve.length > 1 && (
        <div className="flex justify-center">
          <div className="w-full lg:w-1/3">
            <Card
              title={
                <span
                  className="inline-flex cursor-help items-center gap-1.5"
                  title={HR_CURVE_HELP}
                >
                  Heart Rate Curve
                  <span className="text-xs font-normal text-gray-400" aria-hidden>
                    ⓘ
                  </span>
                </span>
              }
            >
              <EChart option={hrCurveChart(activity.hr_curve)} height={240} />
            </Card>
          </div>
        </div>
      )}

      {/* Heart Rate + HR Zones row */}
      {hasHr && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Heart Rate">
            <div className="mb-4 grid grid-cols-2 gap-3">
              <StatCard label="Average" value={`${activity.average_heart_rate} bpm`} />
              <StatCard
                label="Maximum"
                value={activity.max_heart_rate ? `${activity.max_heart_rate} bpm` : "-"}
              />
            </div>
            {activity.streams.heartrate && (
              <EChart
                option={streamChart(distanceStream, activity.streams.heartrate, "#dc2626", "bpm")}
                height={220}
              />
            )}
          </Card>
          {activity.hr_zones && activity.hr_zones.length > 0 && (
            <Card title="Time in Heart Rate Zones">
              <HrZones zones={activity.hr_zones} />
            </Card>
          )}
        </div>
      )}

      {/* Pace + Pace Zones row */}
      {(activity.streams.velocity_smooth ||
        (activity.pace_zones && activity.pace_zones.length > 0)) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {activity.streams.velocity_smooth && (
            <Card title="Pace">
              <div className="mb-4 grid grid-cols-2 gap-3">
                <StatCard label="Average" value={formatActivityPace(activity)} />
                <StatCard
                  label="Max Speed"
                  value={
                    activity.max_speed_kmh ? `${formatNumber(activity.max_speed_kmh, 1)} km/h` : "-"
                  }
                />
              </div>
              <EChart
                option={streamChart(
                  distanceStream,
                  activity.streams.velocity_smooth.map((v) => (v ? v * 3.6 : null)),
                  "#2563eb",
                  "km/h",
                )}
                height={220}
              />
            </Card>
          )}
          {activity.pace_zones && activity.pace_zones.length > 0 && (
            <Card
              title={
                <span className="inline-flex items-center">
                  Pace Zones
                  <InfoTip width="w-72">
                    <p className="font-semibold">Joe Friel, The Triathlete&apos;s Training Bible</p>
                    <p className="mt-1">Zones = % of Functional Threshold Pace (FTP):</p>
                    <ul className="mt-1 space-y-0.5">
                      <li>Z1 Recovery: FTP × 1.29 (&gt;129%)</li>
                      <li>Z2 Aerobic: FTP × 1.14 (114–129%)</li>
                      <li>Z3 Tempo: FTP × 1.06 (106–113%)</li>
                      <li>Z4 Sub-Threshold: FTP × 0.99 (99–105%)</li>
                      <li>Z5 VO2 Max: FTP × 0.95 (&lt;99%)</li>
                    </ul>
                    <p className="mt-2 text-gray-400">
                      We perform only a rough estimate. To set your own threshold pace, go to
                      Settings → Athlete Profile.
                    </p>
                  </InfoTip>
                </span>
              }
            >
              <PaceZones zones={activity.pace_zones} />
            </Card>
          )}
        </div>
      )}

      {/* Elevation + Power row */}
      {(activity.streams.altitude || hasPower) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {activity.streams.altitude && (
            <Card title="Elevation">
              <div className="mb-4 grid grid-cols-2 gap-3">
                <StatCard label="Gain" value={`${formatNumber(activity.elevation_m, 0)} m`} />
                <StatCard
                  label="Min / Max"
                  value={`${formatNumber(Math.min(...activity.streams.altitude.filter((v): v is number => v != null)), 0)} – ${formatNumber(Math.max(...activity.streams.altitude.filter((v): v is number => v != null)), 0)} m`}
                />
              </div>
              <EChart
                option={streamChart(distanceStream, activity.streams.altitude, "#16a34a", "m")}
                height={220}
              />
            </Card>
          )}
          {hasPower && (
            <Card title="Power">
              <div className="mb-4 grid grid-cols-2 gap-3">
                <StatCard label="Average" value={`${activity.average_power} W`} />
                <StatCard
                  label="Max"
                  value={activity.max_power ? `${activity.max_power} W` : "-"}
                />
              </div>
              {activity.streams.watts && (
                <EChart
                  option={streamChart(distanceStream, activity.streams.watts, "#ca8a04", "W")}
                  height={220}
                />
              )}
            </Card>
          )}
        </div>
      )}

      {/* Cadence section */}
      {hasCadence && (
        <Card title="Cadence">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Average" value={`${activity.average_cadence} rpm`} />
            <StatCard
              label="Maximum"
              value={activity.max_cadence ? `${activity.max_cadence} rpm` : "-"}
            />
          </div>
        </Card>
      )}

      {/* Best efforts */}
      {activity.best_efforts.length > 0 && <BestEfforts activity={activity} />}

      {/* Additional details */}
      <Card title="Details">
        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          <div>
            <DetailRow label="Elapsed Time" value={formatDuration(activity.elapsed_time_s)} />
            <DetailRow label="Moving Time" value={formatDuration(activity.moving_time_s)} />
            <DetailRow
              label="Calories"
              value={activity.calories ? `${formatNumber(activity.calories, 0)} kcal` : null}
            />
            <DetailRow label="Sport" value={activity.sport_label} />
          </div>
          <div>
            <DetailRow label="Gear" value={activity.gear_name} />
            <DetailRow label="Device" value={activity.device_name} />
            <DetailRow
              label="Date"
              value={formatDate(activity.start_date_time, "EEEE, d MMMM yyyy 'at' HH:mm")}
            />
            <DetailRow label="Commute" value={activity.is_commute ? "Yes" : null} />
          </div>
        </div>
      </Card>
    </div>
  )
}

function BestEfforts({ activity }: { activity: ActivityDetail }) {
  return (
    <Card title="Best Efforts">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {activity.best_efforts.map((effort) => (
          <div key={effort.distance_m} className="rounded-lg bg-surface-muted p-3">
            <p className="text-xs uppercase text-gray-500">{effort.label}</p>
            <p className="text-lg font-semibold">{formatDuration(effort.time_s)}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ActivityNote({
  activityId,
  athleteId,
  note,
  children,
}: {
  activityId: string
  athleteId: string | null
  note: string | null
  children?: React.ReactNode
}) {
  const hasNote = !!note
  const [open, setOpen] = useState(hasNote)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note ?? "")
  const [saving, setSaving] = useState(false)

  const save = useCallback(async () => {
    if (!athleteId) return
    setSaving(true)
    try {
      const value = draft.trim() || null
      await updateActivityNote(athleteId, activityId, value)
      mutate(
        (key: unknown) =>
          typeof key === "string" && key.startsWith(`/api/activities/${activityId}`),
      )
      setEditing(false)
      if (!value) setOpen(false)
    } finally {
      setSaving(false)
    }
  }, [athleteId, activityId, draft])

  const cancel = useCallback(() => {
    setDraft(note ?? "")
    setEditing(false)
    if (!hasNote) setOpen(false)
  }, [note, hasNote])

  const beginEdit = useCallback(() => {
    setDraft(note ?? "")
    setOpen(true)
    setEditing(true)
  }, [note])

  if (!children) {
    return (
      <div className="card p-4">
        {editing ? (
          <NoteEditor
            draft={draft}
            setDraft={setDraft}
            save={save}
            cancel={cancel}
            saving={saving}
          />
        ) : (
          <NoteDisplay note={note} onEdit={beginEdit} />
        )}
      </div>
    )
  }

  const panelOpen = open || editing

  return (
    <div className="relative flex gap-6">
      {children}
      <div
        className={`hidden transition-all duration-300 ease-in-out lg:block ${
          panelOpen ? "w-[33%] min-w-[260px] opacity-100" : "w-0 min-w-0 overflow-hidden opacity-0"
        }`}
      >
        {panelOpen && (
          <div className="card flex h-full flex-col p-4">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="card-title">Note</h2>
              {!editing && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Close note"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </header>
            <div className="flex flex-1 flex-col">
              {editing ? (
                <NoteEditor
                  draft={draft}
                  setDraft={setDraft}
                  save={save}
                  cancel={cancel}
                  saving={saving}
                />
              ) : (
                <NoteDisplay note={note} onEdit={beginEdit} />
              )}
            </div>
          </div>
        )}
      </div>
      {!panelOpen && (
        <button
          type="button"
          onClick={beginEdit}
          className="absolute right-3 top-3 hidden items-center gap-1.5 rounded-lg bg-gray-900/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-gray-900/80 lg:flex"
          aria-label="Add note"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Note
        </button>
      )}
      <div className="contents lg:hidden">
        {(hasNote || editing) && (
          <div className="card p-4">
            {editing ? (
              <NoteEditor
                draft={draft}
                setDraft={setDraft}
                save={save}
                cancel={cancel}
                saving={saving}
              />
            ) : (
              <NoteDisplay note={note} onEdit={beginEdit} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function NoteDisplay({ note, onEdit }: { note: string | null; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex w-full flex-1 items-start text-left rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-4 py-3 text-sm text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
    >
      {note ? (
        <span className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{note}</span>
      ) : (
        "Add a note…"
      )}
    </button>
  )
}

function NoteEditor({
  draft,
  setDraft,
  save,
  cancel,
  saving,
}: {
  draft: string
  setDraft: (v: string) => void
  save: () => void
  cancel: () => void
  saving: boolean
}) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Write a note about this activity…"
        className="w-full flex-1 resize-none rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}
