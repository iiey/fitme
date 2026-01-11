"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Column, DataTable } from "@/components/ui/DataTable";
import { ErrorState, Spinner } from "@/components/ui/States";
import { useActivities, useMeta } from "@/lib/api";
import { formatActivityPace, formatDate, formatDuration, formatNumber } from "@/lib/format";
import type { ActivitySummary } from "@/lib/types";

const PAGE_SIZE = 25;

function useUrlState(key: string, fallback: string) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const value = searchParams.get(key) ?? fallback;

  const setValue = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === fallback) {
        params.delete(key);
      } else {
        params.set(key, next);
      }
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [key, fallback, searchParams, router],
  );

  return [value, setValue] as const;
}

export default function ActivitiesPage() {
  const { data: meta } = useMeta();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [sportFilter, setSportFilter] = useUrlState("sport", "");
  const [sort, setSort] = useUrlState("sort", "start_date_time");
  const [order, setOrder] = useUrlState("order", "desc");
  const [pageStr, setPageStr] = useUrlState("page", "0");

  const sportTypes = sportFilter ? [sportFilter] : [];
  const page = Math.max(0, parseInt(pageStr, 10) || 0);

  const { data, error, isLoading } = useActivities({
    search: search || undefined,
    sport_type: sportTypes.length ? sportTypes : undefined,
    sort,
    order: order as "asc" | "desc",
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const distanceUnit = meta?.distance_unit ?? "km";

  const toggleSort = (key: string) => {
    if (sort === key) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSort(key);
      setOrder("desc");
    }
    setPageStr("0");
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
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Activities</h1>
        <p className="text-sm text-gray-500">
          {formatNumber(total)} activities · browse, search and sort your history
        </p>
      </header>

      <div className="card flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <input
          type="search"
          placeholder="Search e.g. “2025-12 run”, “trail”, “gravel 2024”…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPageStr("0");
          }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none md:max-w-md"
        />
        <select
          multiple={false}
          value={sportFilter}
          onChange={(event) => {
            setSportFilter(event.target.value);
            setPageStr("0");
          }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        >
          <option value="">All sports</option>
          {meta?.sport_types.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

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

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPageStr(String(Math.max(0, page - 1)))}
          >
            Previous
          </button>
          <span className="text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40"
            disabled={page >= totalPages - 1}
            onClick={() => setPageStr(String(page + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
