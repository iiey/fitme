"use client"

import type { EChartsType } from "echarts"
import { Pin, PinOff } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { EChart } from "@/components/charts/EChart"
import {
  FATIGUE_COLOR,
  FITNESS_COLOR,
  FORM_ZONES,
  formZoneFor,
  trainingLoadDetailChart,
  tsbColor,
} from "@/components/charts/options"
import { InfoTip } from "@/components/ui/InfoTip"
import { hasActivitiesButNoLoad, LoadConfigHint } from "@/components/ui/LoadConfigHint"
import {
  colorForActivityType,
  formatActivityPace,
  formatDate,
  formatDuration,
  formatNumber,
} from "@/lib/format"
import { iconForSportType } from "@/lib/sportIcons"
import type { TrainingLoadActivity, TrainingLoadAnalysis, TrainingLoadPoint } from "@/lib/types"
import { useIsDark } from "@/lib/use-is-dark"

const STATUS_COLORS: Record<string, string> = {
  green: "text-green-600 dark:text-green-400",
  red: "text-red-600 dark:text-red-400",
  yellow: "text-yellow-600 dark:text-yellow-400",
  orange: "text-orange-500 dark:text-orange-400",
  neutral: "text-gray-900 dark:text-gray-100",
}

function MetricCard({
  label,
  value,
  sub,
  tip,
  colorClass,
  color,
}: {
  label: string
  value: string
  sub: string
  tip?: string
  colorClass?: string
  color?: string
}) {
  return (
    <div className="card flex flex-col gap-1 p-3">
      <span className="card-title flex items-center text-xs">
        {label}
        {tip && <InfoTip text={tip} />}
      </span>
      <span
        className={`text-xl font-bold ${color ? "" : (colorClass ?? "text-gray-900 dark:text-gray-100")}`}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
      <span className="text-[11px] text-gray-400">{sub}</span>
    </div>
  )
}

function MiniStat({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span>{label}</span>
      <span className="font-semibold text-gray-800 dark:text-gray-100">{value}</span>
    </span>
  )
}

function ActivityRow({
  activity,
  distanceUnit,
}: {
  activity: TrainingLoadActivity
  distanceUnit: string
}) {
  const distance = distanceUnit === "mi" ? activity.distance_mi : activity.distance_km
  const SportIcon = iconForSportType(activity.sport_type, activity.activity_type)
  return (
    <Link
      href={`/activities/${activity.activity_id}`}
      className="group flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md px-2 py-1.5 hover:bg-surface dark:hover:bg-gray-800"
    >
      <SportIcon
        className="h-4 w-4 shrink-0"
        style={{ color: colorForActivityType(activity.activity_type) }}
      />
      <span className="font-medium text-brand group-hover:underline">{activity.name}</span>
      <span className="text-xs text-gray-400">{activity.sport_label}</span>
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
        <span>{formatDuration(activity.moving_time_s)}</span>
        {distance > 0 && (
          <span>
            {formatNumber(distance, 1)} {distanceUnit}
          </span>
        )}
        <span className="font-semibold text-gray-700 dark:text-gray-200">Load {activity.load}</span>
        {activity.intensity > 0 && <span>{activity.intensity}%</span>}
        {activity.average_heart_rate != null && <span>{activity.average_heart_rate} bpm</span>}
        <span>{formatActivityPace(activity)}</span>
      </span>
    </Link>
  )
}

function DayPanel({
  point,
  distanceUnit,
  pinned,
  onUnpin,
}: {
  point: TrainingLoadPoint
  distanceUnit: string
  pinned: boolean
  onUnpin: () => void
}) {
  const zone = formZoneFor(Math.round(point.tsb))
  const activities = point.activities ?? []

  return (
    <div className="rounded-lg border border-gray-300 bg-surface-muted p-3 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2 dark:border-gray-700">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {formatDate(point.date, "EEE, d MMM yyyy")}
          </span>
          <MiniStat color={FITNESS_COLOR} label="Fitness" value={Math.round(point.ctl)} />
          <MiniStat color={FATIGUE_COLOR} label="Fatigue" value={Math.round(point.atl)} />
          <MiniStat color={zone.color} label="Form" value={Math.round(point.tsb)} />
        </div>
        <div className="flex items-center gap-2">
          {pinned ? (
            <button
              type="button"
              onClick={onUnpin}
              className="flex items-center gap-1 rounded-full border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600 hover:border-brand hover:text-brand dark:border-gray-600 dark:text-gray-300"
              title="Unpin - follow the cursor again"
            >
              <PinOff className="h-3 w-3" />
              Unpin
            </button>
          ) : (
            <span className="hidden items-center gap-1 text-xs text-gray-400 sm:flex">
              <Pin className="h-3 w-3" />
              Click a day to pin
            </span>
          )}
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ background: `${zone.color}22`, color: zone.color }}
          >
            {zone.label}
          </span>
        </div>
      </div>
      {/* Fixed height keeps the layout stable while scrubbing across days so the
          page doesn't grow/shrink and toggle the browser scrollbar. */}
      <div className="mt-1 h-52 overflow-y-auto">
        {activities.length === 0 ? (
          <p className="px-2 py-2 text-sm text-gray-400">Rest day - no activities logged.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {activities.map((activity) => (
              <li key={activity.activity_id}>
                <ActivityRow activity={activity} distanceUnit={distanceUnit} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function HowToRead() {
  return (
    <details className="rounded-lg border border-gray-300 dark:border-gray-700">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-700 hover:text-brand dark:text-gray-200">
        How to read this chart
      </summary>
      <div className="space-y-2 px-3 pb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        <p>
          <strong>
            <span style={{ color: FITNESS_COLOR }} className="font-semibold">
              Blue line
            </span>{" "}
            (Fitness/CTL)
          </strong>{" "}
          - <em>42-day</em> trend showing your aerobic capacity
          <br />
          <strong>
            <span style={{ color: FATIGUE_COLOR }} className="font-semibold">
              Purple line
            </span>{" "}
            (Fatigue/ATL)
          </strong>{" "}
          - <em>7-day</em> stress level from recent workouts
          <br />
          <strong>Goal:</strong> Keep purple <em>above</em> blue to build fitness, then rest to
          recover.
        </p>
        <p>
          <strong>Form (TSB) = Fitness − Fatigue</strong>
          <br />✓ <strong>Optimal zone:</strong> You&apos;re gaining fitness
          <br />✓ <strong>Fresh zone:</strong> Ready to race
          <br />✗ <strong>High-risk zone:</strong> Risk of overtraining -{" "}
          <em>avoid staying long</em>
          <br />
          <strong>Key:</strong> Include <em>rest weeks</em> to recover and peak before goal events.
          Too much monotony = injury risk.
        </p>
      </div>
    </details>
  )
}

export function TrainingLoadSection({
  analysis,
  distanceUnit = "km",
}: {
  analysis: TrainingLoadAnalysis
  distanceUnit?: string
}) {
  const isDark = useIsDark()
  const series = analysis.series
  const lastIndex = Math.max(0, series.length - 1)
  const [activeIndex, setActiveIndex] = useState(lastIndex)
  // The pinned day (or null). When set, the chart keeps a vertical marker there
  // and the panel snaps back to it once the cursor leaves the chart.
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null)

  // Refs let the chart's zrender / global-out handlers read fresh values without
  // being re-registered on every render.
  const seriesLenRef = useRef(series.length)
  seriesLenRef.current = series.length
  const pinnedIndexRef = useRef<number | null>(null)
  pinnedIndexRef.current = pinnedIndex

  // Reset the hovered and pinned day when the underlying window changes
  // (filters / athlete), since the old indices no longer map to the same days.
  useEffect(() => {
    setActiveIndex(Math.max(0, series.length - 1))
    setPinnedIndex(null)
  }, [series.length])

  const labels = useMemo(() => series.map((s) => s.date.slice(5)), [series])
  const option = useMemo(
    () => trainingLoadDetailChart(analysis, isDark, pinnedIndex),
    [analysis, isDark, pinnedIndex],
  )

  const handleAxisPointer = useCallback(
    (params: unknown) => {
      const payload = params as {
        axesInfo?: { axisDim?: string; value?: number | string }[]
      }
      const xAxis = payload.axesInfo?.find((axis) => axis.axisDim === "x")
      if (!xAxis || xAxis.value == null) return
      const index =
        typeof xAxis.value === "number" ? xAxis.value : labels.indexOf(String(xAxis.value))
      if (index < 0 || index >= series.length) return
      setActiveIndex(index)
    },
    [labels, series.length],
  )

  const onEvents = useMemo(
    () => ({
      updateAxisPointer: handleAxisPointer,
      // Leaving the chart returns to the pinned day if there is one, otherwise
      // the most recent day.
      globalout: () =>
        setActiveIndex(pinnedIndexRef.current ?? Math.max(0, seriesLenRef.current - 1)),
    }),
    [handleAxisPointer],
  )

  // Clicking anywhere over the plot pins that day (or unpins it if already
  // pinned) so its vertical marker and activity list stay put.
  const handleChartReady = useCallback((chart: EChartsType) => {
    chart.getZr().on("click", (event) => {
      const point: [number, number] = [event.offsetX, event.offsetY]
      const inGrid =
        chart.containPixel({ gridIndex: 0 }, point) || chart.containPixel({ gridIndex: 1 }, point)
      if (!inGrid) return
      const converted = chart.convertFromPixel({ gridIndex: 0 }, point)
      const xValue = Array.isArray(converted) ? converted[0] : converted
      const index = Math.round(Number(xValue))
      if (Number.isNaN(index) || index < 0 || index >= seriesLenRef.current) return
      setPinnedIndex((prev) => (prev === index ? null : index))
      setActiveIndex(index)
    })
  }, [])

  if (series.length === 0) return null

  const activePoint = series[Math.min(activeIndex, lastIndex)]

  return (
    <div className="space-y-4">
      {hasActivitiesButNoLoad(series) && <LoadConfigHint />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="CTL (Fitness)"
          value={String(analysis.ctl)}
          sub="42-day fitness trend"
          tip="Chronic Training Load - exponentially weighted average of daily training load over 42 days."
          color={FITNESS_COLOR}
        />
        <MetricCard
          label="ATL (Fatigue)"
          value={String(analysis.atl)}
          sub="7-day fatigue level"
          tip="Acute Training Load - exponentially weighted average over 7 days."
          color={FATIGUE_COLOR}
        />
        <MetricCard
          label="TSB (Form)"
          value={String(analysis.tsb)}
          sub={analysis.tsb_status}
          tip="Training Stress Balance = CTL − ATL. Positive = fresh, negative = fatigued."
          color={tsbColor(analysis.tsb, isDark)}
        />
        <MetricCard
          label="A:C Ratio"
          value={String(analysis.ac_ratio)}
          sub={analysis.ac_status}
          tip="Acute-to-Chronic ratio. Optimal 0.8–1.3."
          colorClass={STATUS_COLORS[analysis.ac_color] ?? STATUS_COLORS.neutral}
        />
        <MetricCard
          label="Rest Days"
          value={`${analysis.rest_days} / 7`}
          sub="Rest days in last 7 days"
        />
        <MetricCard
          label="Monotony"
          value={String(analysis.monotony)}
          sub={
            analysis.monotony < 1.5
              ? "Good training variety"
              : analysis.monotony < 2
                ? "Moderate variety"
                : "Low variety – risk"
          }
          tip="Standard deviation of last 7 days of load divided by the mean. Below 1.5 = good variety. Above 2.0 = injury risk."
          colorClass={
            analysis.monotony < 1.5
              ? STATUS_COLORS.green
              : analysis.monotony < 2
                ? STATUS_COLORS.yellow
                : STATUS_COLORS.red
          }
        />
        <MetricCard
          label="Weekly Strain"
          value={String(analysis.strain)}
          sub="Overall weekly training stress"
          tip="Weekly load × monotony. High strain with high monotony increases overtraining risk."
        />
        <MetricCard
          label="Weekly TRIMP"
          value={String(analysis.weekly_trimp)}
          sub="Last 7 days training load"
          tip="Sum of daily training load (TRIMP/TSS) over the last 7 days."
        />
      </div>

      <div className="card space-y-4 p-4">
        <EChart option={option} height={460} onEvents={onEvents} onChartReady={handleChartReady} />

        {/* Form zone legend (matches the coloured bands on the lower chart) */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {FORM_ZONES.map((zone) => (
            <span
              key={zone.label}
              className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400"
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: zone.color }} />
              <span className="font-medium text-gray-600 dark:text-gray-300">{zone.label}</span>
              <span className="hidden text-gray-400 sm:inline">- {zone.note}</span>
            </span>
          ))}
        </div>

        <HowToRead />

        {/* Activities for the hovered/pinned day - placed last so height changes don't shift the chart */}
        <DayPanel
          point={activePoint}
          distanceUnit={distanceUnit}
          pinned={pinnedIndex != null}
          onUnpin={() => setPinnedIndex(null)}
        />
      </div>
    </div>
  )
}
