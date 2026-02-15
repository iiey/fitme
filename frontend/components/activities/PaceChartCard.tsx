"use client"

import { useMemo, useState } from "react"

import { EChart } from "@/components/charts/EChart"
import { Card } from "@/components/ui/Card"
import { InfoTip } from "@/components/ui/InfoTip"
import { StatCard } from "@/components/ui/StatCard"
import { formatActivityPace, formatNumber, formatPace } from "@/lib/format"
import type { ActivityDetail } from "@/lib/types"

import { multiStreamChart, streamChart } from "./charts"

type SpeedMode = "pace" | "gap" | "both"

const PACE_COLOR = "#2563eb"
const GAP_COLOR = "#7c3aed"

const SPEED_MODES: { key: SpeedMode; label: string }[] = [
  { key: "pace", label: "Pace" },
  { key: "gap", label: "GAP" },
  { key: "both", label: "Both" },
]

/** Convert a m/s velocity stream to km/h, preserving null gaps. */
const toKmh = (stream: (number | null)[]): (number | null)[] =>
  stream.map((v) => (v ? v * 3.6 : null))

/**
 * Speed chart for running activities with a Pace / GAP / Both toggle (top-right).
 * "Both" overlays the raw-pace and grade-adjusted curves on one graph so the
 * terrain's impact is visible at a glance; the default view stays on raw Pace.
 */
export function PaceChartCard({
  activity,
  distanceStream,
}: {
  activity: ActivityDetail
  distanceStream: (number | null)[]
}) {
  const rawVelocity = activity.streams.velocity_smooth ?? []
  const gapVelocity = activity.streams.grade_adjusted_velocity
  const hasGap = Array.isArray(gapVelocity) && gapVelocity.length > 0
  const [mode, setMode] = useState<SpeedMode>("pace")
  const showGap = hasGap && mode === "gap"
  const showBoth = hasGap && mode === "both"
  const series = showGap && gapVelocity ? gapVelocity : rawVelocity
  const color = showGap ? GAP_COLOR : PACE_COLOR

  // Plot speed over distance for GPS sports, else over elapsed time (treadmill /
  // indoor), so a missing distance stream doesn't collapse the line onto x=0.
  const hasDistance = activity.is_distance_based && distanceStream.some((d) => d != null && d > 0)
  const timeStream = activity.streams.time
  const { axisStream, axis } = hasDistance
    ? { axisStream: distanceStream, axis: "distance" as const }
    : timeStream && timeStream.some((t) => t != null)
      ? { axisStream: timeStream, axis: "time" as const }
      : { axisStream: series.map((_, i) => i), axis: "time" as const }

  // Average pace and max speed derived from the GAP series for GAP mode; pace
  // mode keeps the activity's canonical (raw) stats.
  const gapStats = useMemo(() => {
    const vals = (gapVelocity ?? []).filter((v): v is number => v != null && v > 0)
    if (vals.length === 0) return { avgPaceSPerKm: null, maxSpeedKmh: null }
    const avgV = vals.reduce((sum, v) => sum + v, 0) / vals.length
    const maxV = Math.max(...vals)
    return { avgPaceSPerKm: 1000 / avgV, maxSpeedKmh: maxV * 3.6 }
  }, [gapVelocity])

  const averageValue = showGap
    ? formatPace(gapStats.avgPaceSPerKm, "/km")
    : formatActivityPace(activity)
  const maxSpeedKmh = showGap ? gapStats.maxSpeedKmh : activity.max_speed_kmh
  const maxSpeedValue = maxSpeedKmh ? `${formatNumber(maxSpeedKmh, 1)} km/h` : "-"

  const toggle = hasGap ? (
    <div className="flex items-center">
      <div className="flex rounded-md border border-gray-300 text-xs dark:border-gray-600">
        {SPEED_MODES.map((m, i) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            className={`px-2.5 py-1 ${i === 0 ? "rounded-l-md" : "border-l border-gray-300 dark:border-gray-600"} ${i === SPEED_MODES.length - 1 ? "rounded-r-md" : ""} ${mode === m.key ? "bg-brand text-white" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <InfoTip width="w-72" align="right">
        <p className="font-semibold">GAP - Grade Adjusted Pace</p>
        <p className="mt-1">
          Your actual running pace normalized to what it would be on flat ground - same effort, zero
          slope.
        </p>
        <p className="mt-2">
          Raw pace is misleading on hills. Running 6:00/km up a 10% grade is a completely different
          effort than 6:00/km flat. GAP converts that hill pace into its flat equivalent so you can
          compare efforts consistently across any terrain.
        </p>
        <p className="mt-2">
          Pick <span className="font-medium">Both</span> to overlay raw pace and GAP on one chart
          and see the terrain&apos;s impact at a glance.
        </p>
      </InfoTip>
    </div>
  ) : undefined

  return (
    <Card title="Speed" action={toggle}>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard label="Average" value={averageValue} />
        <StatCard label="Max Speed" value={maxSpeedValue} />
      </div>
      <EChart
        option={
          showBoth
            ? multiStreamChart(
                axisStream,
                [
                  { name: "Pace", values: toKmh(rawVelocity), color: PACE_COLOR },
                  { name: "GAP", values: toKmh(gapVelocity ?? []), color: GAP_COLOR },
                ],
                "km/h",
                axis,
              )
            : streamChart(axisStream, toKmh(series), color, "km/h", axis)
        }
        height={220}
      />
    </Card>
  )
}
