"use client"

import { X } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { type Column, DataTable } from "@/components/ui/DataTable"
import { SportFilter } from "@/components/ui/SportFilter"
import { ErrorState, Spinner } from "@/components/ui/States"
import { useActivities, useMeta } from "@/lib/api"
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
  const [showDistanceFilter, setShowDistanceFilter] = useState(
    () => !!(searchParams.get("dmin") || searchParams.get("dmax")),
  )

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

  const sportTypes =
    sportParam === "" ? defaultSports : sportParam === "all" ? [] : sportParam.split(",")
  const pageSize = Math.max(1, parseInt(pageSizeStr, 10) || parseInt(DEFAULT_PAGE_SIZE, 10))
  const page = Math.max(0, parseInt(pageStr, 10) || 0)

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

  const clearDistance = () => {
    set({ dmin: "", dmax: "", page: "" })
    setShowDistanceFilter(false)
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
  const hasDistanceFilter = distMin || distMax

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Activities</h1>
        <p className="text-sm text-gray-500">
          {formatNumber(total)} activities
          {meta?.activity_count && total !== meta.activity_count
            ? ` of ${formatNumber(meta.activity_count)} total`
            : ""}
        </p>
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
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Sport type */}
          <SportFilter
            options={meta?.sport_types ?? []}
            selected={sportTypes}
            onChange={(next) => set({ sport: next.length ? next.join(",") : "all", page: "" })}
          />

          {/* Date filter toggle */}
          <button
            type="button"
            onClick={() => {
              if (showDateFilter && hasDateFilter) {
                clearDates()
              } else {
                setShowDateFilter(!showDateFilter)
              }
            }}
            className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              hasDateFilter
                ? "border-brand bg-brand/10 text-brand"
                : showDateFilter
                  ? "border-gray-400 text-gray-700"
                  : "border-gray-300 text-gray-600 hover:border-gray-400"
            }`}
          >
            Date
            {hasDateFilter && <X className="h-3.5 w-3.5" />}
          </button>

          {/* Distance filter toggle */}
          <button
            type="button"
            onClick={() => {
              if (showDistanceFilter && hasDistanceFilter) {
                clearDistance()
              } else {
                setShowDistanceFilter(!showDistanceFilter)
              }
            }}
            className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              hasDistanceFilter
                ? "border-brand bg-brand/10 text-brand"
                : showDistanceFilter
                  ? "border-gray-400 text-gray-700"
                  : "border-gray-300 text-gray-600 hover:border-gray-400"
            }`}
          >
            Distance
            {hasDistanceFilter && <X className="h-3.5 w-3.5" />}
          </button>

          {/* Date inputs - shown when expanded */}
          {showDateFilter && (
            <>
              <div className="flex items-center gap-1.5">
                <label htmlFor="filter-date-from" className="text-xs text-gray-500">
                  From
                </label>
                <input
                  id="filter-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => set({ from: event.target.value, page: "" })}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
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
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </div>

              {hasDateFilter && (
                <button
                  type="button"
                  onClick={clearDates}
                  className="text-sm text-brand hover:underline"
                >
                  Clear dates
                </button>
              )}
            </>
          )}

          {/* Distance inputs - shown when expanded */}
          {showDistanceFilter && (
            <>
              <div className="flex items-center gap-1.5">
                <label htmlFor="filter-dist-min" className="text-xs text-gray-500">
                  Min
                </label>
                <input
                  id="filter-dist-min"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0"
                  value={distMin}
                  onChange={(event) => set({ dmin: event.target.value, page: "" })}
                  className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
                <span className="text-xs text-gray-400">{distanceUnit}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <label htmlFor="filter-dist-max" className="text-xs text-gray-500">
                  Max
                </label>
                <input
                  id="filter-dist-max"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="∞"
                  value={distMax}
                  onChange={(event) => set({ dmax: event.target.value, page: "" })}
                  className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
                <span className="text-xs text-gray-400">{distanceUnit}</span>
              </div>

              {hasDistanceFilter && (
                <button
                  type="button"
                  onClick={clearDistance}
                  className="text-sm text-brand hover:underline"
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>

        {/* Date presets - shown when expanded */}
        {showDateFilter && (
          <div className="flex flex-wrap gap-2">
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
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:border-brand hover:text-brand transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Distance presets - shown when expanded */}
        {showDistanceFilter && (
          <div className="flex flex-wrap gap-2">
            {[
              { min: "5", max: "", label: "5+ km" },
              { min: "10", max: "", label: "10+ km" },
              { min: "21", max: "", label: "Half marathon+" },
              { min: "42", max: "", label: "Marathon+" },
              { min: "", max: "5", label: "Under 5 km" },
              { min: "5", max: "10", label: "5–10 km" },
              { min: "10", max: "21", label: "10–21 km" },
            ].map((p) => (
              <button
                type="button"
                key={p.label}
                onClick={() => set({ dmin: p.min, dmax: p.max, page: "" })}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:border-brand hover:text-brand transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
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
            rows={data?.items ?? []}
            sort={sort}
            order={order as "asc" | "desc"}
            onSort={toggleSort}
            getRowKey={(row) => row.activity_id}
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
