"use client";

import { useState } from "react";
import Link from "next/link";

import { Column, DataTable } from "@/components/ui/DataTable";
import { ErrorState, Spinner } from "@/components/ui/States";
import { useActivities, useMeta } from "@/lib/api";
import { formatActivityPace, formatDate, formatDuration, formatNumber } from "@/lib/format";
import type { ActivitySummary } from "@/lib/types";

const PAGE_SIZE = 25;

export default function ActivitiesPage() {
  const { data: meta } = useMeta();
  const [search, setSearch] = useState("");
  const [sportTypes, setSportTypes] = useState<string[]>([]);
  const [sort, setSort] = useState("start_date_time");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const { data, error, isLoading } = useActivities({
    search: search || undefined,
    sport_type: sportTypes.length ? sportTypes : undefined,
    sort,
    order,
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
    setPage(0);
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
            setPage(0);
          }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none md:max-w-md"
        />
        <select
          multiple={false}
          value={sportTypes[0] ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setSportTypes(value ? [value] : []);
            setPage(0);
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
            order={order}
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
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            Previous
          </button>
          <span className="text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
