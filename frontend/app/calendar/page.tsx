"use client"

import clsx from "clsx"
import { getISOWeek, parseISO } from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"

import { DayDetailModal } from "@/components/calendar/DayDetailModal"
import { Card } from "@/components/ui/Card"
import { InfoTip } from "@/components/ui/InfoTip"
import { StatCard } from "@/components/ui/StatCard"
import { ErrorState, Spinner } from "@/components/ui/States"
import { useMeta, useMonth } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { colorForSportType, formatDate, formatHours, formatNumber } from "@/lib/format"
import { iconForSportType } from "@/lib/sportIcons"
import type { CalendarActivity, MonthDay, MonthResponse } from "@/lib/types"

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const now = new Date()

/** Local calendar date as ``YYYY-MM-DD`` (avoids the UTC shift of toISOString). */
function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

const TODAY = isoDate(now)

/** Which per-day metric drives the grid cell shading. */
type ColorMetric = "distance" | "moving_time_s" | "elevation" | "load"
const COLOR_METRICS: { value: ColorMetric; label: string }[] = [
  { value: "distance", label: "Distance" },
  { value: "moving_time_s", label: "Time" },
  { value: "elevation", label: "Elevation" },
  { value: "load", label: "Load" },
]

export default function CalendarPage() {
  const { athleteId } = useAthleteContext()
  const { data: meta } = useMeta(athleteId)
  // Default to the month of the most recent activity (the export may be historical).
  const [current, setCurrent] = useState<{ year: number; month: number } | null>(null)
  const [initialised, setInitialised] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  // Sports to highlight; an empty array means "no filter" (all shown normally).
  const [selectedSports, setSelectedSports] = useState<string[]>([])
  // Which metric drives the grid cell shading.
  const [colorMetric, setColorMetric] = useState<ColorMetric>("distance")

  useEffect(() => {
    if (initialised) return
    const params = new URLSearchParams(window.location.search)
    const yearParam = parseInt(params.get("year") ?? "", 10)
    const monthParam = parseInt(params.get("month") ?? "", 10)
    if (yearParam && monthParam >= 1 && monthParam <= 12) {
      setCurrent({ year: yearParam, month: monthParam })
      setInitialised(true)
      return
    }
    if (meta?.last_activity) {
      const last = new Date(meta.last_activity)
      setCurrent({ year: last.getFullYear(), month: last.getMonth() + 1 })
      setInitialised(true)
    } else if (meta && !meta.last_activity) {
      setCurrent({ year: now.getFullYear(), month: now.getMonth() + 1 })
      setInitialised(true)
    }
  }, [meta, initialised])

  const year = current?.year ?? now.getFullYear()
  const month = current?.month ?? now.getMonth() + 1
  const { data, error, isLoading } = useMonth(athleteId, year, month)

  // Previous month, fetched for the month-over-month deltas on the stat cards.
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  const { data: prevData } = useMonth(athleteId, prev.year, prev.month)

  // Only compare fully elapsed months: a still-running (current) month has fewer
  // days on the clock, so a delta against a whole prior month would be misleading.
  const monthComplete =
    year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)

  const goPrev = useCallback(() => {
    setSelectedSports([])
    setCurrent(month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 })
  }, [year, month])

  const goNext = useCallback(() => {
    setSelectedSports([])
    setCurrent(month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 })
  }, [year, month])

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
  const goToday = () => {
    setSelectedSports([])
    setCurrent({ year: now.getFullYear(), month: now.getMonth() + 1 })
  }

  // Arrow keys move between months, mirroring the header chevrons. Typing in a
  // field or an open day drawer keeps its own key handling.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (selectedDate) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return
      }
      if (event.key === "ArrowLeft") goPrev()
      else if (event.key === "ArrowRight") goNext()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [goPrev, goNext, selectedDate])

  // Horizontal swipes on the calendar area move between months on touch devices.
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const SWIPE_THRESHOLD_PX = 50
  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
  }
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return
    if (dx < 0) goNext()
    else goPrev()
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center text-2xl font-bold">
            Calendar
            <InfoTip width="w-72" position="below">
              <p className="mb-1.5 font-semibold">How to read this calendar</p>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  <strong>Week column</strong> - Weekly totals: time, distance, elevation, calories
                  &amp; training load.
                </li>
                <li>
                  <strong>Day number</strong> - Click to view that day&apos;s activities.
                </li>
                <li>
                  <strong>Activity rows</strong> - Duration, distance, avg HR &amp; training load.
                </li>
                <li>
                  <strong>Sport dot</strong> - Colored by sport type.
                </li>
              </ul>
            </InfoTip>
          </h1>
          <p className="text-sm text-gray-500">Monthly stats with an interactive calendar</p>
        </div>
        <div className="flex items-center gap-2">
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={goToday}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={goPrev}
            className="rounded-lg border border-gray-300 p-1.5 text-sm hover:bg-gray-100"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[140px] text-center text-sm font-semibold">
            {data?.month_name ?? ""} {year}
          </span>
          <button
            type="button"
            onClick={goNext}
            className="rounded-lg border border-gray-300 p-1.5 text-sm hover:bg-gray-100"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {isLoading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Activities"
              value={formatNumber(data.totals.count)}
              accent
              sub={
                <MonthDelta
                  current={data.totals.count}
                  previous={monthComplete ? prevData?.totals.count : undefined}
                  label={prevData?.month_name}
                />
              }
            />
            <StatCard
              label={`Distance (${data.unit_system === "imperial" ? "mi" : "km"})`}
              value={formatNumber(data.totals.distance, 1)}
              sub={
                <MonthDelta
                  current={data.totals.distance}
                  previous={monthComplete ? prevData?.totals.distance : undefined}
                  label={prevData?.month_name}
                />
              }
            />
            <StatCard
              label="Elevation (m)"
              value={formatNumber(data.totals.elevation, 0)}
              sub={
                <MonthDelta
                  current={data.totals.elevation}
                  previous={monthComplete ? prevData?.totals.elevation : undefined}
                  label={prevData?.month_name}
                />
              }
            />
            <StatCard
              label="Moving Time"
              value={formatHours(data.totals.moving_time_s)}
              sub={
                <MonthDelta
                  current={data.totals.moving_time_s}
                  previous={monthComplete ? prevData?.totals.moving_time_s : undefined}
                  label={prevData?.month_name}
                />
              }
            />
          </div>

          <Card>
            {data.per_sport.length > 1 && (
              <SportChips
                sports={data.per_sport}
                selected={selectedSports}
                onChange={setSelectedSports}
              />
            )}
            <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="hidden md:block">
              <ColorMetricControl value={colorMetric} onChange={setColorMetric} />
              <CalendarGrid
                days={data.days}
                firstWeekday={data.first_weekday}
                unitSystem={data.unit_system}
                activities={data.activities}
                selectedSports={selectedSports}
                colorMetric={colorMetric}
                today={TODAY}
                onSelectDay={setSelectedDate}
              />
            </div>
            <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="md:hidden">
              <AgendaList
                days={data.days}
                unitSystem={data.unit_system}
                activities={data.activities}
                selectedSports={selectedSports}
                today={TODAY}
                onSelectDay={setSelectedDate}
              />
            </div>
            <DayStreakSummary days={data.days} />
          </Card>

          {data.per_sport.length > 0 && (
            <Card title="By sport type">
              <div className="mb-1 flex items-center justify-between border-b border-gray-300 pb-1 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:border-gray-700">
                <span className="pl-5">Sport</span>
                <span className="flex">
                  <span className="w-12 text-right">Count</span>
                  <span className="w-20 text-right">
                    {data.unit_system === "imperial" ? "Miles" : "Km"}
                  </span>
                  <span className="w-16 text-right">Time</span>
                </span>
              </div>
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {data.per_sport.map((sport) => {
                  const monthStr = String(month).padStart(2, "0")
                  const from = `${year}-${monthStr}-01`
                  const to = `${year}-${monthStr}-${String(data.days_in_month).padStart(2, "0")}`
                  const href = `/activities?sport=${encodeURIComponent(sport.sport_type)}&from=${from}&to=${to}`
                  const SportIcon = iconForSportType(sport.sport_type)
                  return (
                    <li key={sport.sport_type}>
                      <Link
                        href={href}
                        title={`View ${sport.label} activities in ${data.month_name} ${year}`}
                        className="flex items-center justify-between rounded-md py-2 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <span className="flex items-center gap-2">
                          <SportIcon
                            className="h-4 w-4 shrink-0"
                            style={{ color: colorForSportType(sport.sport_type) }}
                          />
                          <span className="font-medium text-brand hover:underline">
                            {sport.label}
                          </span>
                        </span>
                        <span className="flex text-gray-500">
                          <span className="w-12 text-right">{sport.count}</span>
                          <span className="w-20 text-right">{formatNumber(sport.distance, 1)}</span>
                          <span className="w-16 text-right">
                            {formatHours(sport.moving_time_s)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </>
      )}

      {selectedDate && data && (
        <DayDetailModal
          date={selectedDate}
          activities={data.activities.filter(
            (act) => act.start_date_time.split("T")[0] === selectedDate,
          )}
          unitSystem={data.unit_system}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  )
}

/**
 * Percentage change of a stat versus the previous month. Rendered muted when
 * there is no prior month to compare against (the first month of data).
 */
function MonthDelta({
  current,
  previous,
  label,
}: {
  current: number
  previous: number | undefined
  label: string | undefined
}) {
  if (previous === undefined || label === undefined) return null
  const suffix = ` vs ${label}`
  if (previous === 0) {
    return (
      <span className="text-gray-400">{current > 0 ? `New${suffix}` : `No change${suffix}`}</span>
    )
  }
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return <span className="text-gray-400">{`No change${suffix}`}</span>
  const up = pct > 0
  return (
    <span className={up ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"}>
      {`${up ? "▲" : "▼"} ${Math.abs(pct)}%${suffix}`}
    </span>
  )
}

function formatCompactTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h${m}m`
}

/** Segmented control choosing which per-day metric shades the grid cells. */
function ColorMetricControl({
  value,
  onChange,
}: {
  value: ColorMetric
  onChange: (next: ColorMetric) => void
}) {
  return (
    <div className="mb-2 flex items-center justify-end gap-1 text-xs text-gray-500">
      <span className="mr-1">Shade by</span>
      {COLOR_METRICS.map((metric) => (
        <button
          key={metric.value}
          type="button"
          onClick={() => onChange(metric.value)}
          aria-pressed={value === metric.value}
          className={clsx(
            "rounded-md px-2 py-1 font-medium transition-colors",
            value === metric.value
              ? "bg-brand/10 text-brand"
              : "hover:bg-gray-100 dark:hover:bg-gray-800",
          )}
        >
          {metric.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Toggleable chips for the month's sports. Selecting sports highlights their
 * activities and dims the rest; an empty selection shows everything normally.
 */
function SportChips({
  sports,
  selected,
  onChange,
}: {
  sports: MonthResponse["per_sport"]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  function toggle(sportType: string) {
    onChange(
      selected.includes(sportType)
        ? selected.filter((s) => s !== sportType)
        : [...selected, sportType],
    )
  }

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange([])}
        aria-pressed={selected.length === 0}
        className={clsx(
          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
          selected.length === 0
            ? "border-brand bg-brand/10 text-brand"
            : "border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800",
        )}
      >
        All
      </button>
      {sports.map((sport) => {
        const active = selected.includes(sport.sport_type)
        const SportIcon = iconForSportType(sport.sport_type)
        return (
          <button
            key={sport.sport_type}
            type="button"
            onClick={() => toggle(sport.sport_type)}
            aria-pressed={active}
            className={clsx(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-brand bg-brand/10 text-brand"
                : "border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800",
            )}
          >
            <SportIcon
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: colorForSportType(sport.sport_type) }}
              aria-hidden="true"
            />
            {sport.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Active/rest day counts and the longest run of consecutive active days within
 * the month. The streak resets at month boundaries, so it is scoped to "this
 * month" rather than an all-time figure.
 */
function summarizeDays(days: MonthDay[]): { active: number; rest: number; longestStreak: number } {
  let active = 0
  let longestStreak = 0
  let run = 0
  for (const day of days) {
    if (day.count > 0) {
      active += 1
      run += 1
      if (run > longestStreak) longestStreak = run
    } else {
      run = 0
    }
  }
  return { active, rest: days.length - active, longestStreak }
}

/** One-line active/rest/streak summary for the visible month. */
function DayStreakSummary({ days }: { days: MonthDay[] }) {
  const { active, rest, longestStreak } = summarizeDays(days)
  return (
    <p className="mt-3 border-t border-gray-100 pt-2 text-center text-xs text-gray-500 dark:border-gray-700">
      {active} active {active === 1 ? "day" : "days"} · {rest} rest {rest === 1 ? "day" : "days"} ·
      longest streak {longestStreak} {longestStreak === 1 ? "day" : "days"}
    </p>
  )
}

/**
 * Human-readable totals for a day, used as the day button's accessible label and
 * the cell's hover title so the color-encoded intensity is not the only cue.
 */
function daySummary(
  day: MonthDay,
  dayActs: CalendarActivity[],
  distUnit: string,
  elevUnit: string,
): string {
  if (day.count === 0) return "no activities"
  const load = dayActs.reduce((sum, a) => sum + a.load, 0)
  const parts = [
    `${day.count} ${day.count === 1 ? "activity" : "activities"}`,
    formatHours(day.moving_time_s),
  ]
  if (day.distance > 0.1) parts.push(`${formatNumber(day.distance, 1)} ${distUnit}`)
  if (day.elevation > 0) parts.push(`${formatNumber(day.elevation, 0)} ${elevUnit}`)
  if (load > 0) parts.push(`load ${load}`)
  return parts.join(", ")
}

/** Group activities by their local calendar date (``YYYY-MM-DD``). */
function groupActivitiesByDate(activities: CalendarActivity[]): Map<string, CalendarActivity[]> {
  const byDate = new Map<string, CalendarActivity[]>()
  for (const act of activities) {
    const dateKey = act.start_date_time.split("T")[0]
    const list = byDate.get(dateKey) ?? []
    list.push(act)
    byDate.set(dateKey, list)
  }
  return byDate
}

/** Single compact activity line shared by the grid cells and the mobile agenda. */
function ActivityLine({
  act,
  unitSystem,
  dimmed,
}: {
  act: CalendarActivity
  unitSystem: string
  dimmed?: boolean
}) {
  const distUnit = unitSystem === "imperial" ? "mi" : "km"
  const dist = unitSystem === "imperial" ? act.distance_mi : act.distance_km
  const SportIcon = iconForSportType(act.sport_type, act.activity_type)
  return (
    <div
      className={clsx(
        "mt-px flex flex-wrap items-center gap-x-1 text-[15px] leading-snug text-gray-600 dark:text-gray-300",
        dimmed && "opacity-30",
      )}
    >
      <SportIcon
        className="h-3 w-3 shrink-0"
        style={{ color: colorForSportType(act.sport_type) }}
        aria-hidden="true"
      />
      <span className="font-medium">{formatCompactTime(act.moving_time_s)}</span>
      {dist > 0.1 && (
        <span>
          {formatNumber(dist, 1)} {distUnit}
        </span>
      )}
      {act.average_heart_rate != null && (
        <span
          role="img"
          className="text-red-400"
          title="Average heart rate"
          aria-label={`${Math.round(act.average_heart_rate)} bpm average heart rate`}
        >
          ♥{Math.round(act.average_heart_rate)}
        </span>
      )}
      {act.load > 0 && (
        <span
          role="img"
          className="text-brand"
          title="Training load"
          aria-label={`Training load ${act.load}`}
        >
          L{act.load}
        </span>
      )}
    </div>
  )
}

/**
 * Vertical day-by-day list shown on narrow screens, where the seven-column grid
 * is too cramped to be legible. Only days with activities are listed.
 */
function AgendaList({
  days,
  unitSystem,
  activities,
  selectedSports,
  today,
  onSelectDay,
}: {
  days: MonthDay[]
  unitSystem: string
  activities: CalendarActivity[]
  selectedSports: string[]
  today: string
  onSelectDay: (date: string) => void
}) {
  const byDate = groupActivitiesByDate(activities)
  const distUnit = unitSystem === "imperial" ? "mi" : "km"
  const filterActive = selectedSports.length > 0
  const activeDays = days.filter((d) => d.count > 0)

  if (activeDays.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-400">No activities this month.</p>
  }

  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
      {activeDays.map((day) => {
        const dayMatches = !filterActive || day.sport_types.some((s) => selectedSports.includes(s))
        return (
          <li
            key={day.date}
            className={clsx(
              "py-2 first:pt-0 last:pb-0",
              filterActive && !dayMatches && "opacity-40",
            )}
          >
            <button
              type="button"
              onClick={() => onSelectDay(day.date)}
              className="mb-1 flex w-full items-baseline justify-between gap-2 text-left"
            >
              <span className={clsx("font-semibold", day.date === today && "text-brand")}>
                {formatDate(day.date, "EEE d")}
                {day.date === today && " · Today"}
              </span>
              <span className="text-xs text-gray-500">
                {formatCompactTime(day.moving_time_s)}
                {day.distance > 0.1 && ` · ${formatNumber(day.distance, 1)} ${distUnit}`}
              </span>
            </button>
            {(byDate.get(day.date) ?? []).map((act) => (
              <ActivityLine
                key={act.activity_id}
                act={act}
                unitSystem={unitSystem}
                dimmed={filterActive && !selectedSports.includes(act.sport_type)}
              />
            ))}
          </li>
        )
      })}
    </ul>
  )
}

function CalendarGrid({
  days,
  firstWeekday,
  unitSystem,
  activities,
  selectedSports,
  colorMetric,
  today,
  onSelectDay,
}: {
  days: MonthDay[]
  firstWeekday: number
  unitSystem: string
  activities: CalendarActivity[]
  selectedSports: string[]
  colorMetric: ColorMetric
  today: string
  onSelectDay: (date: string) => void
}) {
  const distUnit = unitSystem === "imperial" ? "mi" : "km"
  const elevUnit = unitSystem === "imperial" ? "ft" : "m"
  const filterActive = selectedSports.length > 0

  const activitiesByDate = groupActivitiesByDate(activities)

  // Value driving each cell's shade, per the selected metric. Load is summed
  // from the day's activities since MonthDay has no load field.
  const shadeValue = (day: MonthDay): number => {
    if (colorMetric === "load") {
      return (activitiesByDate.get(day.date) ?? []).reduce((sum, a) => sum + a.load, 0)
    }
    return day[colorMetric]
  }
  const maxShade = Math.max(1, ...days.map(shadeValue))

  const allCells: (MonthDay | null)[] = [...Array(firstWeekday).fill(null), ...days]
  while (allCells.length % 7 !== 0) allCells.push(null)

  const weeks: {
    weekNum: number
    cells: (MonthDay | null)[]
    count: number
    time_s: number
    distance: number
    elevation: number
    calories: number
    load: number
  }[] = []
  for (let i = 0; i < allCells.length; i += 7) {
    const cells = allCells.slice(i, i + 7)
    const firstDay = cells.find((d): d is MonthDay => d !== null)
    const weekNum = firstDay ? getISOWeek(parseISO(firstDay.date)) : 0
    let count = 0
    let time_s = 0
    let distance = 0
    let elevation = 0
    let calories = 0
    let load = 0
    for (const d of cells) {
      if (d && d.count > 0) {
        count += d.count
        time_s += d.moving_time_s
        distance += d.distance
        elevation += d.elevation
        calories += d.calories
        const dayActs = activitiesByDate.get(d.date) ?? []
        for (const a of dayActs) load += a.load
      }
    }
    weeks.push({ weekNum, cells, count, time_s, distance, elevation, calories, load })
  }

  return (
    <div>
      <div className="mb-2 grid grid-cols-[80px_repeat(7,1fr)] gap-1 text-center text-xs font-semibold text-gray-400">
        <div>Week</div>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="space-y-1">
        {weeks.map((week) => (
          <div key={week.weekNum} className="grid grid-cols-[80px_repeat(7,1fr)] gap-1">
            <div
              className="flex flex-col items-center justify-center rounded-lg bg-gray-50 py-1 text-gray-400 dark:bg-gray-800/50"
              title={
                week.count > 0
                  ? `Week ${week.weekNum}: ${week.count} activities · ${formatHours(week.time_s)} · ${formatNumber(week.distance, 1)} ${distUnit} · ${formatNumber(week.elevation, 0)} ${elevUnit}${week.calories > 0 ? ` · ${formatNumber(week.calories, 0)} cal` : ""}${week.load > 0 ? ` · Load ${week.load}` : ""}`
                  : `Week ${week.weekNum}`
              }
            >
              <span className="text-xs font-bold text-gray-500 dark:text-gray-300">
                {week.weekNum}
              </span>
              {week.count > 0 && (
                <div className="mt-0.5 flex flex-col items-center text-[11px] leading-snug">
                  <span className="font-medium">{formatHours(week.time_s)}</span>
                  <span>
                    {formatNumber(week.distance, 0)} {distUnit}
                  </span>
                  {week.elevation > 0 && (
                    <span>
                      {formatNumber(week.elevation, 0)} {elevUnit}
                    </span>
                  )}
                  {week.calories > 0 && <span>{formatNumber(week.calories, 0)} cal</span>}
                  {week.load > 0 && <span className="font-medium text-brand">L {week.load}</span>}
                </div>
              )}
            </div>
            {week.cells.map((day, di) => {
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional placeholder in a 7-column week grid; blanks never reorder
              if (!day) return <div key={`blank-${week.weekNum}-${di}`} />
              const dayActs = activitiesByDate.get(day.date) ?? []
              const dayMatches =
                !filterActive || day.sport_types.some((s) => selectedSports.includes(s))
              const summary = daySummary(day, dayActs, distUnit, elevUnit)
              const dateLabel = formatDate(day.date, "EEEE, d MMMM")
              return (
                <div
                  key={day.date}
                  title={day.count > 0 ? `${dateLabel}: ${summary}` : undefined}
                  className={clsx(
                    "flex min-h-[150px] flex-col rounded-lg border p-1.5 text-xs transition-opacity",
                    day.count > 0 ? "border-brand/30" : "border-gray-100 dark:border-gray-700",
                    day.date === today &&
                      "ring-2 ring-brand ring-offset-1 dark:ring-offset-gray-900",
                    filterActive && !dayMatches && "opacity-40",
                  )}
                  style={
                    day.count > 0
                      ? {
                          backgroundColor: `rgba(59, 130, 246, ${0.05 + (shadeValue(day) / maxShade) * 0.15})`,
                        }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => onSelectDay(day.date)}
                    className="mb-0.5 self-start text-xl font-bold text-gray-400 transition-colors hover:text-brand"
                    aria-label={`${dateLabel}: ${summary}. View day.`}
                  >
                    {day.day}
                  </button>
                  {dayActs.slice(0, 3).map((act) => (
                    <ActivityLine
                      key={act.activity_id}
                      act={act}
                      unitSystem={unitSystem}
                      dimmed={filterActive && !selectedSports.includes(act.sport_type)}
                    />
                  ))}
                  {dayActs.length > 3 && (
                    <span className="mt-px text-[10px] text-gray-400">
                      +{dayActs.length - 3} more
                    </span>
                  )}
                  {day.count === 0 && (
                    <span
                      aria-hidden="true"
                      className="mt-auto self-center pb-0.5 text-[10px] uppercase tracking-wide text-gray-300 dark:text-gray-600"
                    >
                      rest
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
