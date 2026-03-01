"use client"

import { Trash2, X } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { PaceFilter } from "@/components/activities/PaceFilter"
import { RangeFilter } from "@/components/activities/RangeFilter"
import { type Column, DataTable } from "@/components/ui/DataTable"
import { SportFilter } from "@/components/ui/SportFilter"
import { ErrorState, Spinner } from "@/components/ui/States"
import { deleteActivities, revalidateAll, useActivities, useMeta } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { formatActivityPace, formatDate, formatDuration, formatNumber } from "@/lib/format"
import { useDefaultSports } from "@/lib/preferences"
import type { ActivitySummary } from "@/lib/types"
import { useUrlParams } from "@/lib/use-url-params"

const PAGE_SIZES = [25, 50, 100, 300, 500, 1000]
const DEFAULT_PAGE_SIZE = "300"

export default function ActivitiesPage() {
  const { athleteId } = useAthleteContext()
  const { data: meta } = useMeta(athleteId)
  const searchParams = useSearchParams()
  const { get, set } = useUrlParams()
  const { defaultSports } = useDefaultSports()

  const [search, setSearch] = useState(searchParams.get("search") ?? "")
  // Debounce the query that drives fetching so typing issues one request after
  // the user pauses, not one per keystroke. The input stays bound to `search`.
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(id)
  }, [search])
  const [showDateFilter, setShowDateFilter] = useState(
    () => !!(searchParams.get("from") || searchParams.get("to")),
  )

  // Multi-select for bulk deletion. Selection is keyed by activity id so it
  // survives re-sorts and pagination, and is cleared on leaving select mode.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)

  // The ?sport= param holds a comma-separated list. Absent => follow the
  // configured default; "all" => an explicit All-sports choice (empty filter).
  const sportParam = get("sport", "")
  const sort = get("sort", "start_date_time")
  const order = get("order", "desc")
  const pageStr = get("page", "0")
  const pageSizeStr = get("size", DEFAULT_PAGE_SIZE)
  const dateFrom = get("from", "")
  const dateTo = get("to", "")
  const distMin = get("dmin", "")
  const distMax = get("dmax", "")
  const timeMin = get("tmin", "")
  const timeMax = get("tmax", "")
  const spdMin = get("spdmin", "")
  const spdMax = get("spdmax", "")
  const elevMin = get("emin", "")
  const elevMax = get("emax", "")
  const hrMin = get("hrmin", "")
  const hrMax = get("hrmax", "")

  const sportTypes =
    sportParam === "" ? defaultSports : sportParam === "all" ? [] : sportParam.split(",")
  const pageSize = Math.max(1, parseInt(pageSizeStr, 10) || parseInt(DEFAULT_PAGE_SIZE, 10))
  const page = Math.max(0, parseInt(pageStr, 10) || 0)

  // Pace is shown as min/km only when every selected sport is a run/walk type
  // (mirrors the backend's pace-unit rule); otherwise the filter shows speed.
  const paceMode =
    sportTypes.length > 0 &&
    sportTypes.every((value) => {
      const activityType = meta?.sport_types.find((option) => option.value === value)?.activity_type
      return activityType === "Run" || activityType === "Walk"
    })

  const { data, error, isLoading } = useActivities(athleteId, {
    search: debouncedSearch || undefined,
    sport_type: sportTypes.length ? sportTypes : undefined,
    sort,
    order: order as "asc" | "desc",
    limit: pageSize,
    offset: page * pageSize,
    start: dateFrom || undefined,
    end: dateTo || undefined,
    distance_min: distMin ? parseFloat(distMin) : undefined,
    distance_max: distMax ? parseFloat(distMax) : undefined,
    time_min: timeMin ? parseFloat(timeMin) : undefined,
    time_max: timeMax ? parseFloat(timeMax) : undefined,
    speed_min: spdMin ? parseFloat(spdMin) : undefined,
    speed_max: spdMax ? parseFloat(spdMax) : undefined,
    elevation_min: elevMin ? parseFloat(elevMin) : undefined,
    elevation_max: elevMax ? parseFloat(elevMax) : undefined,
    hr_min: hrMin ? parseInt(hrMin, 10) : undefined,
    hr_max: hrMax ? parseInt(hrMax, 10) : undefined,
  })

  const distanceUnit = meta?.distance_unit ?? "km"

  const toggleSort = (key: string) => {
    if (sort === key) {
      set({ order: order === "asc" ? "desc" : "asc", page: "" })
    } else {
      set({ sort: key, order: "desc", page: "" })
    }
  }

  const setDatePreset = (preset: string) => {
    const now = new Date()
    let start: Date
    let endStr = ""
    switch (preset) {
      case "this-month":
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case "last-month":
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        endStr = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10)
        break
      case "last-30":
        start = new Date(now.getTime() - 30 * 86400000)
        break
      case "last-90":
        start = new Date(now.getTime() - 90 * 86400000)
        break
      case "this-year":
        start = new Date(now.getFullYear(), 0, 1)
        break
      default:
        return
    }
    set({ from: start.toISOString().slice(0, 10), to: endStr, page: "" })
  }

  const clearDates = () => {
    set({ from: "", to: "", page: "" })
    setShowDateFilter(false)
  }

  const columns: Column<ActivitySummary>[] = [
    {
      key: "start_date_time",
      header: "Date",
      sortable: true,
      render: (row) => formatDate(row.start_date_time),
    },
    {
      key: "name",
      header: "Activity",
      sortable: true,
      render: (row) => (
        <Link
          href={`/activities/${row.activity_id}`}
          className="font-medium text-brand hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "sport_type",
      header: "Sport",
      render: (row) => <span className="text-gray-600">{row.sport_label}</span>,
    },
    {
      key: "distance_m",
      header: `Distance (${distanceUnit})`,
      sortable: true,
      align: "right",
      render: (row) => formatNumber(distanceUnit === "mi" ? row.distance_mi : row.distance_km, 1),
    },
    {
      key: "moving_time_s",
      header: "Time",
      sortable: true,
      align: "right",
      render: (row) => formatDuration(row.moving_time_s),
    },
    {
      key: "average_speed_ms",
      header: "Pace",
      sortable: true,
      align: "right",
      render: (row) => formatActivityPace(row, distanceUnit),
    },
    {
      key: "elevation_m",
      header: "Elev (m)",
      sortable: true,
      align: "right",
      render: (row) => formatNumber(row.elevation_m, 0),
    },
    {
      key: "average_heart_rate",
      header: "HR",
      sortable: true,
      align: "right",
      render: (row) => (row.average_heart_rate ? `${row.average_heart_rate}` : "-"),
    },
  ]

  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)
  const hasDateFilter = dateFrom || dateTo

  const rows = data?.items ?? []
  const selectedCount = selectedIds.size
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.activity_id))
  const someSelected = rows.some((row) => selectedIds.has(row.activity_id))

  const toggleRow = (activityId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(activityId)) {
        next.delete(activityId)
      } else {
        next.add(activityId)
      }
      return next
    })
  }

  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (rows.every((row) => next.has(row.activity_id))) {
        for (const row of rows) next.delete(row.activity_id)
      } else {
        for (const row of rows) next.add(row.activity_id)
      }
      return next
    })
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const handleDelete = async () => {
    if (!athleteId || selectedCount === 0) return
    if (!confirm(`Delete ${selectedCount} activit${selectedCount === 1 ? "y" : "ies"}?`)) return
    setIsDeleting(true)
    try {
      await deleteActivities(athleteId, [...selectedIds])
      exitSelectMode()
      revalidateAll()
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not delete activities")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Activities</h1>
          <p className="text-sm text-gray-500">
            {formatNumber(total)} activities
            {meta?.activity_count && total !== meta.activity_count
              ? ` of ${formatNumber(meta.activity_count)} total`
              : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectMode && selectedCount > 0 && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
              {isDeleting ? "Deleting…" : `Delete ${selectedCount}`}
            </button>
          )}
          <button
            type="button"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
              selectMode
                ? "border-brand bg-brand/10 text-brand"
                : "border-gray-300 text-gray-600 hover:border-gray-400"
            }`}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="card p-4">
        <input
          type="search"
          placeholder="Search e.g. &quot;2025-12 run&quot;, &quot;trail&quot;, &quot;gravel 2024&quot;…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            set({ page: "" })
          }}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none dark:border-gray-600 dark:bg-surface dark:text-foreground"
        />
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-start gap-3">
          {/* Sport type */}
          <SportFilter
            options={meta?.sport_types ?? []}
            selected={sportTypes}
            onChange={(next) => set({ sport: next.length ? next.join(",") : "all", page: "" })}
          />

          {/* Date - kept page-managed (date pickers differ from numeric ranges) */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                if (showDateFilter && hasDateFilter) {
                  clearDates()
                } else {
                  setShowDateFilter(!showDateFilter)
                }
              }}
              className={`inline-flex items-center gap-1 self-start rounded-lg border px-3 py-2 text-sm transition-colors ${
                hasDateFilter
                  ? "border-brand bg-brand/10 text-brand"
                  : showDateFilter
                    ? "border-gray-400 text-gray-700 dark:text-gray-200"
                    : "border-gray-300 text-gray-600 hover:border-gray-400"
              }`}
            >
              Date
              {hasDateFilter && <X className="h-3.5 w-3.5" />}
            </button>

            {showDateFilter && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="filter-date-from" className="text-xs text-gray-500">
                    From
                  </label>
                  <input
                    id="filter-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(event) => set({ from: event.target.value, page: "" })}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-surface"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label htmlFor="filter-date-to" className="text-xs text-gray-500">
                    To
                  </label>
                  <input
                    id="filter-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(event) => set({ to: event.target.value, page: "" })}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-surface"
                  />
                </div>
                {[
                  { key: "this-month", label: "This month" },
                  { key: "last-month", label: "Last month" },
                  { key: "last-30", label: "Last 30 days" },
                  { key: "last-90", label: "Last 90 days" },
                  { key: "this-year", label: "This year" },
                ].map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => setDatePreset(p.key)}
                    className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 transition-colors hover:border-brand hover:text-brand"
                  >
                    {p.label}
                  </button>
                ))}
                {hasDateFilter && (
                  <button
                    type="button"
                    onClick={clearDates}
                    className="text-sm text-brand hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Distance */}
          <RangeFilter
            label="Distance"
            unit={distanceUnit}
            min={distMin}
            max={distMax}
            presets={[
              { label: "5+", min: "5" },
              { label: "10+", min: "10" },
              { label: "HM+", min: "21" },
              { label: "M+", min: "42" },
              { label: "<5", max: "5" },
              { label: "5–10", min: "5", max: "10" },
            ]}
            onChange={(min, max) => set({ dmin: min, dmax: max, page: "" })}
            onClear={() => set({ dmin: "", dmax: "", page: "" })}
          />

          {/* Time (minutes) */}
          <RangeFilter
            label="Time"
            unit="min"
            step="1"
            min={timeMin}
            max={timeMax}
            presets={[
              { label: "<30", max: "30" },
              { label: "30–60", min: "30", max: "60" },
              { label: "1–2h", min: "60", max: "120" },
              { label: "2h+", min: "120" },
            ]}
            onChange={(min, max) => set({ tmin: min, tmax: max, page: "" })}
            onClear={() => set({ tmin: "", tmax: "", page: "" })}
          />

          {/* Pace / Speed (sport-aware) */}
          <PaceFilter
            mode={paceMode ? "pace" : "speed"}
            distanceUnit={distanceUnit}
            speedMin={spdMin}
            speedMax={spdMax}
            onChange={(min, max) => set({ spdmin: min, spdmax: max, page: "" })}
            onClear={() => set({ spdmin: "", spdmax: "", page: "" })}
          />

          {/* Elevation (m) */}
          <RangeFilter
            label="Elevation"
            unit="m"
            step="1"
            min={elevMin}
            max={elevMax}
            presets={[
              { label: "Flat <100", max: "100" },
              { label: "500+", min: "500" },
              { label: "1000+", min: "1000" },
            ]}
            onChange={(min, max) => set({ emin: min, emax: max, page: "" })}
            onClear={() => set({ emin: "", emax: "", page: "" })}
          />

          {/* Heart rate (bpm) */}
          <RangeFilter
            label="HR"
            unit="bpm"
            step="1"
            min={hrMin}
            max={hrMax}
            presets={[
              { label: "<120", max: "120" },
              { label: "120–150", min: "120", max: "150" },
              { label: "150+", min: "150" },
            ]}
            onChange={(min, max) => set({ hrmin: min, hrmax: max, page: "" })}
            onClear={() => set({ hrmin: "", hrmax: "", page: "" })}
          />
        </div>
      </div>

      {/* Table */}
      <div className="card p-2">
        {isLoading && !data ? (
          <Spinner label="Loading activities…" />
        ) : error ? (
          <ErrorState />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            sort={sort}
            order={order as "asc" | "desc"}
            onSort={toggleSort}
            getRowKey={(row) => row.activity_id}
            selection={{
              enabled: selectMode,
              selectedKeys: selectedIds,
              onToggleRow: toggleRow,
              allSelected,
              someSelected,
              onToggleAll: toggleAll,
            }}
          />
        )}
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40"
            disabled={page === 0}
            onClick={() => set({ page: String(Math.max(0, page - 1)) || "" })}
          >
            Previous
          </button>
          {totalPages > 0 && (
            <span className="text-gray-500">
              Page {page + 1} of {totalPages}
            </span>
          )}
          <button
            type="button"
            className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40"
            disabled={page >= totalPages - 1}
            onClick={() => set({ page: String(page + 1) })}
          >
            Next
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="filter-page-size" className="text-xs text-gray-500">
            Per page
          </label>
          <select
            id="filter-page-size"
            value={pageSize}
            onChange={(event) => set({ size: event.target.value, page: "" })}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
