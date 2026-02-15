"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { CalendarPoint } from "@/lib/types"
import { useIsDark } from "@/lib/use-is-dark"

const DAY_MS = 24 * 60 * 60 * 1000
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

const COLORS = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"]

const DARK_COLORS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]

/**
 * Format a Date as a local "YYYY-MM-DD" string. The grid is built from
 * local-midnight dates, so it must be read back with local getters; using
 * toISOString() would shift to UTC and land activities on the wrong day for
 * users in non-UTC timezones. Matches the backend's tz-naive date keys.
 */
function toLocalISO(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function colorForLoad(load: number, max: number, dark: boolean): string {
  const palette = dark ? DARK_COLORS : COLORS
  if (load <= 0) return palette[0]
  const ratio = Math.min(1, load / max)
  if (ratio < 0.25) return palette[1]
  if (ratio < 0.5) return palette[2]
  if (ratio < 0.75) return palette[3]
  return palette[4]
}

interface YearOption {
  label: string
  value: string // "rolling" or a year like "2024"
}

export function ActivityHeatmap({ points }: { points: CalendarPoint[] }) {
  const isDark = useIsDark()
  const router = useRouter()

  const availableYears = useMemo(() => {
    const years = new Set<number>()
    for (const p of points) {
      years.add(parseInt(p.date.slice(0, 4), 10))
    }
    const sorted = Array.from(years).sort((a, b) => b - a)
    const options: YearOption[] = [{ label: "Last 12 months", value: "rolling" }]
    for (const y of sorted) {
      options.push({ label: String(y), value: String(y) })
    }
    return options
  }, [points])

  const [yearView, setYearView] = useState("rolling")

  const { cells, maxLoad, monthHeaders, dateRange } = useMemo(() => {
    const byDate = new Map(points.map((p) => [p.date, p]))
    const max = points.reduce((acc, p) => Math.max(acc, p.training_load), 1)

    let start: Date
    let end: Date

    if (yearView === "rolling") {
      end = new Date()
      start = new Date(end.getTime() - 364 * DAY_MS)
    } else {
      const y = parseInt(yearView, 10)
      start = new Date(y, 0, 1)
      end = new Date(y, 11, 31)
    }

    // Align start to Monday
    const startDay = start.getDay()
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay
    const alignedStart = new Date(start.getTime() + mondayOffset * DAY_MS)

    // Align end to Sunday
    const endDay = end.getDay()
    const sundayOffset = endDay === 0 ? 0 : 7 - endDay
    const alignedEnd = new Date(end.getTime() + sundayOffset * DAY_MS)

    const totalDays = Math.round((alignedEnd.getTime() - alignedStart.getTime()) / DAY_MS) + 1

    const grid: {
      date: string
      load: number
      count: number
      col: number
      row: number
    }[] = []

    for (let i = 0; i < totalDays; i++) {
      const current = new Date(alignedStart.getTime() + i * DAY_MS)
      const iso = toLocalISO(current)
      const point = byDate.get(iso)
      const col = Math.floor(i / 7)
      const row = i % 7
      grid.push({
        date: iso,
        load: point?.training_load ?? 0,
        count: point?.count ?? 0,
        col,
        row,
      })
    }

    // Build month headers - find the first week column for each month
    const months: { label: string; col: number; year: number; month: number }[] = []
    let lastMonth = -1
    for (const cell of grid) {
      if (cell.row !== 0) continue // only look at Monday row
      const year = parseInt(cell.date.slice(0, 4), 10)
      const month = parseInt(cell.date.slice(5, 7), 10) - 1
      if (month !== lastMonth) {
        months.push({ label: MONTH_LABELS[month], col: cell.col, year, month: month + 1 })
        lastMonth = month
      }
    }

    const totalWeeks = Math.ceil(totalDays / 7)
    const rangeLabel =
      yearView === "rolling"
        ? `${alignedStart.toISOString().slice(0, 10)} - ${alignedEnd.toISOString().slice(0, 10)}`
        : yearView

    return {
      cells: grid,
      maxLoad: max,
      monthHeaders: months,
      totalWeeks,
      dateRange: rangeLabel,
    }
  }, [points, yearView])

  const totalWeeks = monthHeaders.length > 0 ? Math.max(...cells.map((c) => c.col)) + 1 : 53

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  const measure = useCallback(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.clientWidth)
    }
  }, [])

  useEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [measure])

  const dayLabelWidth = 36
  const availableWidth = containerWidth - dayLabelWidth
  const cellPlusGap = availableWidth > 0 ? availableWidth / totalWeeks : 14
  const cellGap = Math.max(1, Math.min(3, Math.floor(cellPlusGap * 0.2)))
  const cellWidth = Math.max(4, cellPlusGap - cellGap)
  const cellHeight = Math.max(4, Math.min(cellWidth, 14))
  const headerHeight = 22

  return (
    <div ref={containerRef}>
      <div className="mb-3 flex items-center justify-between">
        <select
          value={yearView}
          onChange={(e) => setYearView(e.target.value)}
          className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-brand focus:outline-none dark:border-gray-600 dark:bg-surface"
        >
          {availableYears.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {containerWidth > 0 && (
        <div>
          {/* Month labels */}
          <div className="flex" style={{ paddingLeft: dayLabelWidth, height: headerHeight }}>
            {monthHeaders.map((m, i) => {
              const nextCol = i + 1 < monthHeaders.length ? monthHeaders[i + 1].col : totalWeeks
              const spanWeeks = nextCol - m.col
              const width = spanWeeks * (cellWidth + cellGap)
              if (spanWeeks < 2) {
                return <span key={`${m.label}-${m.col}`} style={{ width, flexShrink: 0 }} />
              }
              return (
                <button
                  key={`${m.label}-${m.col}`}
                  type="button"
                  onClick={() => router.push(`/calendar?year=${m.year}&month=${m.month}`)}
                  title={`View ${m.label} ${m.year} in Monthly View`}
                  className="cursor-pointer text-left text-sm font-medium text-gray-500 transition-colors hover:text-brand hover:underline dark:text-gray-400"
                  style={{ width, flexShrink: 0 }}
                >
                  {m.label}
                </button>
              )
            })}
          </div>

          {/* Grid: day labels + cells */}
          <div className="flex">
            {/* Day labels column */}
            <div className="flex flex-col" style={{ width: dayLabelWidth, gap: cellGap }}>
              {DAY_LABELS.map((label, i) => (
                <span
                  key={label}
                  className="text-xs leading-none text-gray-500 dark:text-gray-400"
                  style={{ height: cellHeight, display: "flex", alignItems: "center" }}
                >
                  {i % 2 === 0 ? label : ""}
                </span>
              ))}
            </div>

            {/* Cells grid */}
            <div
              className="grid grid-flow-col"
              style={{
                gridTemplateRows: `repeat(7, ${cellHeight}px)`,
                gap: cellGap,
                flex: 1,
              }}
            >
              {cells.map((cell) => (
                <div
                  key={cell.date}
                  title={`${cell.date}: ${cell.load > 0 ? `Load ${cell.load}` : "No activity"} (${cell.count} activit${cell.count === 1 ? "y" : "ies"})`}
                  className={`rounded-[2px] ${cell.count > 0 ? "cursor-pointer ring-brand/50 transition-shadow hover:ring-2" : ""}`}
                  style={{
                    width: cellWidth,
                    height: cellHeight,
                    backgroundColor: colorForLoad(cell.load, maxLoad, isDark),
                  }}
                  onClick={
                    cell.count > 0
                      ? () => router.push(`/activities?from=${cell.date}&to=${cell.date}`)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-gray-400">
        <span>Less</span>
        {(isDark ? DARK_COLORS : COLORS).map((color) => (
          <span
            key={color}
            className="rounded-[2px]"
            style={{ width: 10, height: 10, backgroundColor: color }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
