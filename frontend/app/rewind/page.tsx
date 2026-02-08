"use client"

import { Award, Flame, type LucideIcon, Mountain, Ruler, Timer } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { EChart } from "@/components/charts/EChart"
import { barChart, donutChart, themeColors } from "@/components/charts/options"
import { Card } from "@/components/ui/Card"
import { StatCard } from "@/components/ui/StatCard"
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States"
import { useMeta, useRewind } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { formatDuration, formatHours, formatNumber } from "@/lib/format"
import { useDefaultSport } from "@/lib/preferences"
import type { Rewind } from "@/lib/types"
import { useIsDark } from "@/lib/use-is-dark"

type SportMetric = "distance" | "hours"

export default function RewindPage() {
  const { athleteId } = useAthleteContext()
  const isDark = useIsDark()
  const { defaultSport } = useDefaultSport()
  const [filter, setFilter] = useState<string>("")
  // null = follow the configured default; any string = an explicit user choice.
  const [sportType, setSportType] = useState<string | null>(null)
  const activeSport = sportType ?? defaultSport
  const [sportMetric, setSportMetric] = useState<SportMetric>("distance")
  const year = filter && filter !== "last365" ? Number(filter) : null
  const days = filter === "last365" ? 365 : null
  const { data: meta } = useMeta(athleteId)
  const { data, error, isLoading } = useRewind(
    athleteId,
    year,
    days,
    activeSport ? [activeSport] : undefined,
  )

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
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeSport}
            onChange={(event) => setSportType(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none dark:border-gray-600 dark:bg-surface dark:text-foreground"
          >
            <option value="">All sports</option>
            {meta?.sport_types.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none dark:border-gray-600 dark:bg-surface dark:text-foreground"
          >
            <option value="">All time</option>
            <option value="last365">Last 365 days</option>
            {data.available_years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
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
          <EChart option={distancePerMonthChart(rewind, distanceUnit, isDark)} height={260} />
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

function distancePerMonthChart(rewind: Rewind, unit: string, dark: boolean) {
  const t = themeColors(dark)
  const months = rewind.totals_per_month.map((m) => m.month)
  const distances = rewind.totals_per_month.map((m) => m.distance)
  const counts = rewind.totals_per_month.map((m) => m.count)
  return {
    grid: { left: 50, right: 15, top: 28, bottom: 50 },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
      formatter: (params: unknown) => {
        const list = params as { dataIndex: number }[]
        const i = Array.isArray(list) ? (list[0]?.dataIndex ?? 0) : 0
        const n = counts[i]
        return `<b>${months[i]}</b><br/>${n} ${n === 1 ? "activity" : "activities"}`
      },
    },
    xAxis: {
      type: "category" as const,
      data: months,
      axisLabel: { fontSize: 10, rotate: 0, color: t.axis },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: { fontSize: 10, color: t.axis },
      splitLine: { lineStyle: { color: t.splitLine } },
    },
    series: [
      {
        type: "bar" as const,
        data: distances,
        itemStyle: { color: "#3b82f6", borderRadius: [3, 3, 0, 0] },
        label: {
          show: true,
          position: "top" as const,
          fontSize: 10,
          color: t.text,
          formatter: (p: unknown) => {
            const v = (p as { value: number }).value
            return v > 0 ? `${Math.round(v)} ${unit}` : ""
          },
        },
      },
    ],
  }
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

const HIGHLIGHT_ICONS: Record<string, LucideIcon> = {
  ruler: Ruler,
  mountain: Mountain,
  timer: Timer,
  flame: Flame,
}

function HighlightIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = HIGHLIGHT_ICONS[icon] ?? Award
  return <Icon className={className} />
}

function AchievementsSection({ rewind }: { rewind: Rewind }) {
  const { highlights, personal_records } = rewind.achievements
  if (highlights.length === 0 && personal_records.length === 0 && !rewind.longest_streak)
    return null

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Award className="h-4 w-4 text-brand" />
          Best efforts
        </span>
      }
    >
      {highlights.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {highlights.map((item) => (
            <Link
              key={item.label}
              href={`/activities/${item.activity_id}`}
              className="rounded-lg bg-surface-muted p-3 transition-colors hover:bg-brand/10"
            >
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
                <HighlightIcon icon={item.icon} className="h-3.5 w-3.5" />
                {item.label}
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
