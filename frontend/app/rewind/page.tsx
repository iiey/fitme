"use client"

import Link from "next/link"
import { useState } from "react"

import { EChart } from "@/components/charts/EChart"
import { barChart, donutChart } from "@/components/charts/options"
import { Card } from "@/components/ui/Card"
import { StatCard } from "@/components/ui/StatCard"
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States"
import { useRewind } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { formatDuration, formatHours, formatNumber } from "@/lib/format"
import type { Rewind } from "@/lib/types"
import { useIsDark } from "@/lib/use-is-dark"

type SportMetric = "distance" | "hours"

export default function RewindPage() {
  const { athleteId } = useAthleteContext()
  const isDark = useIsDark()
  const [filter, setFilter] = useState<string>("")
  const [sportMetric, setSportMetric] = useState<SportMetric>("distance")
  const year = filter && filter !== "last365" ? Number(filter) : null
  const days = filter === "last365" ? 365 : null
  const { data, error, isLoading } = useRewind(athleteId, year, days)

  if (isLoading && !data) return <Spinner label="Rewinding your year…" />
  if (error) return <ErrorState />
  if (!data) return <EmptyState message="No data to rewind yet." />

  const rewind = data.rewind
  const distanceUnit = rewind.unit

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">FitMe Rewind</h1>
          <p className="text-sm text-gray-500">A fun look back at your year in motion</p>
        </div>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand focus:outline-none dark:border-gray-600 dark:bg-surface dark:text-foreground"
        >
          <option value="">All time</option>
          <option value="last365">Last 365 days</option>
          {data.available_years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Activities" value={formatNumber(rewind.summary.count)} accent />
        <StatCard
          label={`Distance (${distanceUnit})`}
          value={formatNumber(rewind.summary.distance, 0)}
        />
        <StatCard label="Elevation (m)" value={formatNumber(rewind.summary.elevation_m, 0)} />
        <StatCard label="Moving Time" value={formatHours(rewind.summary.moving_time_s)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Distance per month (${distanceUnit})`}>
          <EChart
            option={barChart(
              rewind.totals_per_month.map((m) => m.month),
              rewind.totals_per_month.map((m) => m.distance),
              "#3b82f6",
              distanceUnit,
              isDark,
            )}
            height={260}
          />
        </Card>
        <Card
          title={`By sport (${sportMetric === "distance" ? distanceUnit : "hours"})`}
          action={
            <div className="flex gap-1 rounded-lg bg-surface-muted p-0.5 text-xs">
              <button
                onClick={() => setSportMetric("distance")}
                className={metricTabClass(sportMetric === "distance")}
              >
                {distanceUnit}
              </button>
              <button
                onClick={() => setSportMetric("hours")}
                className={metricTabClass(sportMetric === "hours")}
              >
                Hours
              </button>
            </div>
          }
        >
          <EChart
            option={barChart(
              rewind.per_sport.slice(0, 8).map((s) => s.label),
              rewind.per_sport
                .slice(0, 8)
                .map((s) =>
                  sportMetric === "distance"
                    ? s.distance
                    : Math.round((s.moving_time_s / 3600) * 10) / 10,
                ),
              sportMetric === "distance" ? "#3b82f6" : "#2563eb",
              sportMetric === "distance" ? distanceUnit : "h",
              isDark,
              true,
            )}
            height={260}
          />
        </Card>
        <Card title="When you start activities">
          <EChart
            option={barChart(
              Array.from({ length: 24 }, (_, hour) => `${hour}`),
              rewind.start_times,
              "#7c3aed",
              "",
              isDark,
            )}
            height={240}
          />
        </Card>
        <Card title="Active vs rest days">
          <EChart
            option={donutChart(
              [
                { name: "Active", value: rewind.active_vs_rest.active_days, color: "#3b82f6" },
                { name: "Rest", value: rewind.active_vs_rest.rest_days, color: "#e5e7eb" },
              ],
              isDark,
            )}
            height={240}
          />
        </Card>
      </div>

      <AchievementsSection rewind={rewind} />
    </div>
  )
}

function metricTabClass(active: boolean): string {
  return `rounded-md px-2.5 py-1 font-medium transition-colors ${
    active
      ? "bg-white text-brand shadow-sm dark:bg-gray-700 dark:text-brand"
      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
  }`
}

function formatHighlightValue(value: number, unit: string): string {
  if (unit === "duration") return formatDuration(value)
  if (unit === "kcal") return `${formatNumber(value)} kcal`
  return `${formatNumber(value, value < 100 ? 1 : 0)} ${unit}`
}

function AchievementsSection({ rewind }: { rewind: Rewind }) {
  const { highlights, personal_records } = rewind.achievements
  if (highlights.length === 0 && personal_records.length === 0 && !rewind.longest_streak)
    return null

  return (
    <Card title="🏅 Best efforts">
      {highlights.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {highlights.map((item) => (
            <Link
              key={item.label}
              href={`/activities/${item.activity_id}`}
              className="rounded-lg bg-surface-muted p-3 transition-colors hover:bg-brand/10"
            >
              <p className="text-xs uppercase tracking-wide text-gray-500">
                {item.icon} {item.label}
              </p>
              <p className="mt-1 text-lg font-bold">
                {formatHighlightValue(item.value, item.unit)}
              </p>
              <p className="truncate text-xs text-gray-400" title={item.name}>
                {item.name} · {item.date}
              </p>
            </Link>
          ))}
        </div>
      )}

      {rewind.longest_streak && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Longest streak
          </p>
          <div className="inline-flex items-baseline gap-2 rounded-lg border border-gray-200 px-4 py-2 dark:border-gray-700">
            <span className="text-2xl font-bold text-brand">
              {rewind.longest_streak.length} days
            </span>
            <span className="text-sm text-gray-500">
              {rewind.longest_streak.start} → {rewind.longest_streak.end}
            </span>
          </div>
        </div>
      )}

      {personal_records.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Fastest times
          </p>
          <div className="flex flex-wrap gap-2">
            {personal_records.map((record) => (
              <Link
                key={record.distance_m}
                href={`/activities/${record.activity_id}`}
                className="rounded-lg border border-gray-200 px-3 py-2 text-center transition-colors hover:border-brand dark:border-gray-700"
              >
                <p className="text-xs text-gray-500">{record.label}</p>
                <p className="font-bold text-brand">{formatDuration(record.time_s)}</p>
                <p className="text-[11px] text-gray-400">{record.date}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
