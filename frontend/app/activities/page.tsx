"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Column, DataTable } from "@/components/ui/DataTable";
import { ErrorState, Spinner } from "@/components/ui/States";
import { useActivities, useMeta } from "@/lib/api";
import { useAthleteContext } from "@/lib/athlete-context";
import { formatActivityPace, formatDate, formatDuration, formatNumber } from "@/lib/format";
import type { ActivitySummary } from "@/lib/types";

const PAGE_SIZES = [25, 50, 100, 300, 500, 1000];
const DEFAULT_PAGE_SIZE = "300";

function useUrlParams() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const get = useCallback(
    (key: string, fallback: string) => searchParams.get(key) ?? fallback,
    [searchParams],
  );

  const set = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [searchParams, router],
  );

  return { get, set };
}

export default function ActivitiesPage() {
  const { athleteId } = useAthleteContext();
  const { data: meta } = useMeta(athleteId);
  const searchParams = useSearchParams();
  const { get, set } = useUrlParams();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [showDateFilter, setShowDateFilter] = useState(
    () => !!(searchParams.get("from") || searchParams.get("to")),
  );
  const [showDistanceFilter, setShowDistanceFilter] = useState(
    () => !!(searchParams.get("dmin") || searchParams.get("dmax")),
  );

  const sportFilter = get("sport", "");
  const sort = get("sort", "start_date_time");
  const order = get("order", "desc");
  const pageStr = get("page", "0");
  const pageSizeStr = get("size", DEFAULT_PAGE_SIZE);
  const dateFrom = get("from", "");
  const dateTo = get("to", "");
  const distMin = get("dmin", "");
  const distMax = get("dmax", "");

  const sportTypes = sportFilter ? [sportFilter] : [];
  const pageSize = Math.max(1, parseInt(pageSizeStr, 10) || parseInt(DEFAULT_PAGE_SIZE, 10));
  const page = Math.max(0, parseInt(pageStr, 10) || 0);

  const { data, error, isLoading } = useActivities(athleteId, {
    search: search || undefined,
    sport_type: sportTypes.length ? sportTypes : undefined,
    sort,
    order: order as "asc" | "desc",
    limit: pageSize,
    offset: page * pageSize,
    start: dateFrom || undefined,
    end: dateTo || undefined,
    distance_min: distMin ? parseFloat(distMin) : undefined,
    distance_max: distMax ? parseFloat(distMax) : undefined,
  });

  const distanceUnit = meta?.distance_unit ?? "km";

  const toggleSort = (key: string) => {
    if (sort === key) {
      set({ order: order === "asc" ? "desc" : "asc", page: "" });
    } else {
      set({ sort: key, order: "desc", page: "" });
    }
  };

  const setDatePreset = (preset: string) => {
    const now = new Date();
    let start: Date;
    let endStr = "";
    switch (preset) {
      case "this-month":
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "last-month":
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endStr = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
        break;
      case "last-30":
        start = new Date(now.getTime() - 30 * 86400000);
        break;
      case "last-90":
        start = new Date(now.getTime() - 90 * 86400000);
        break;
      case "this-year":
        start = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        return;
    }
    set({ from: start.toISOString().slice(0, 10), to: endStr, page: "" });
  };

  const clearDates = () => {
    set({ from: "", to: "", page: "" });
    setShowDateFilter(false);
  };

  const clearDistance = () => {
    set({ dmin: "", dmax: "", page: "" });
    setShowDistanceFilter(false);
  };

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
        <Link href={`/activities/${row.activity_id}`} className="font-medium text-brand hover:underline">
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
      render: (row) =>
        formatNumber(distanceUnit === "mi" ? row.distance_mi : row.distance_km, 1),
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
      render: (row) => formatActivityPace(row),
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
  ];

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const hasDateFilter = dateFrom || dateTo;
  const hasDistanceFilter = distMin || distMax;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Activities</h1>
        <p className="text-sm text-gray-500">
          {formatNumber(total)} activities
          {meta?.activity_count && total !== meta.activity_count ? ` of ${formatNumber(meta.activity_count)} total` : ""}
        </p>
      </header>

      {/* Search */}
      <div className="card p-4">
        <input
          type="search"
          placeholder="Search e.g. &quot;2025-12 run&quot;, &quot;trail&quot;, &quot;gravel 2024&quot;…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            set({ page: "" });
          }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
      </div>

      {/* Filters */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Sport type */}
          <select
            value={sportFilter}
            onChange={(event) => set({ sport: event.target.value, page: "" })}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          >
            <option value="">All sports</option>
            {meta?.sport_types.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {/* Date filter toggle */}
          <button
            onClick={() => {
              if (showDateFilter && hasDateFilter) {
                clearDates();
              } else {
                setShowDateFilter(!showDateFilter);
              }
            }}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              hasDateFilter
                ? "border-brand bg-brand/10 text-brand"
                : showDateFilter
                  ? "border-gray-400 text-gray-700"
                  : "border-gray-300 text-gray-600 hover:border-gray-400"
            }`}
          >
            Date{hasDateFilter ? " ✕" : ""}
          </button>

          {/* Distance filter toggle */}
          <button
            onClick={() => {
              if (showDistanceFilter && hasDistanceFilter) {
                clearDistance();
              } else {
                setShowDistanceFilter(!showDistanceFilter);
              }
            }}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              hasDistanceFilter
                ? "border-brand bg-brand/10 text-brand"
                : showDistanceFilter
                  ? "border-gray-400 text-gray-700"
                  : "border-gray-300 text-gray-600 hover:border-gray-400"
            }`}
          >
            Distance{hasDistanceFilter ? " ✕" : ""}
          </button>

          {/* Date inputs — shown when expanded */}
          {showDateFilter && (
            <>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => set({ from: event.target.value, page: "" })}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => set({ to: event.target.value, page: "" })}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </div>

              {hasDateFilter && (
                <button
                  onClick={clearDates}
                  className="text-sm text-brand hover:underline"
                >
                  Clear dates
                </button>
              )}
            </>
          )}

          {/* Distance inputs — shown when expanded */}
          {showDistanceFilter && (
            <>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500">Min</label>
                <input
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
                <label className="text-xs text-gray-500">Max</label>
                <input
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
                  onClick={clearDistance}
                  className="text-sm text-brand hover:underline"
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>

        {/* Date presets — shown when expanded */}
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
                key={p.key}
                onClick={() => setDatePreset(p.key)}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:border-brand hover:text-brand transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Distance presets — shown when expanded */}
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
            className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40"
            disabled={page >= totalPages - 1}
            onClick={() => set({ page: String(page + 1) })}
          >
            Next
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Per page</label>
          <select
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
  );
}
