"use client"

import { useMemo, useState } from "react"

import { EChart } from "@/components/charts/EChart"
import { Card } from "@/components/ui/Card"
import { InfoTip } from "@/components/ui/InfoTip"
import { StatCard } from "@/components/ui/StatCard"
import { formatActivityPace, formatNumber, formatPace } from "@/lib/format"
import type { ActivityDetail } from "@/lib/types"

import { streamChart } from "./charts"

/** Pace chart with a Pace ↔ GAP toggle (top-right) for running activities. */
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
  const [mode, setMode] = useState<"pace" | "gap">("pace")
  const showGap = hasGap && mode === "gap"
  const series = showGap && gapVelocity ? gapVelocity : rawVelocity
  const color = showGap ? "#7c3aed" : "#2563eb"

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
        <button
          type="button"
          onClick={() => setMode("pace")}
          className={`rounded-l-md px-2.5 py-1 ${mode === "pace" ? "bg-brand text-white" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
        >
          Pace
        </button>
        <button
          type="button"
          onClick={() => setMode("gap")}
          className={`rounded-r-md px-2.5 py-1 ${mode === "gap" ? "bg-brand text-white" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
        >
          GAP
        </button>
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
        option={streamChart(
          distanceStream,
          series.map((v) => (v ? v * 3.6 : null)),
          color,
          "km/h",
        )}
        height={220}
      />
    </Card>
  )
}
