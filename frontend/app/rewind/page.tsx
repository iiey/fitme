"use client";

import { useState } from "react";

import { EChart } from "@/components/charts/EChart";
import { barChart, donutChart } from "@/components/charts/options";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import { useRewind } from "@/lib/api";
import { formatDuration, formatHours, formatNumber } from "@/lib/format";

export default function RewindPage() {
  const [filter, setFilter] = useState<string>("");
  const year = filter && filter !== "last365" ? Number(filter) : null;
  const days = filter === "last365" ? 365 : null;
  const { data, error, isLoading } = useRewind(year, days);

  if (isLoading && !data) return <Spinner label="Rewinding your year…" />;
  if (error) return <ErrorState />;
  if (!data) return <EmptyState message="No data to rewind yet." />;

  const rewind = data.rewind;
  const distanceUnit = rewind.unit;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Strava Rewind</h1>
          <p className="text-sm text-gray-500">A fun look back at your year in motion</p>
        </div>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
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
        <StatCard label={`Distance (${distanceUnit})`} value={formatNumber(rewind.summary.distance, 0)} />
        <StatCard label="Elevation (m)" value={formatNumber(rewind.summary.elevation_m, 0)} />
        <StatCard label="Moving Time" value={formatHours(rewind.summary.moving_time_s)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Distance per month (${distanceUnit})`}>
          <EChart
            option={barChart(
              rewind.totals_per_month.map((m) => m.month),
              rewind.totals_per_month.map((m) => m.distance),
              "#fc4c02",
              distanceUnit,
            )}
            height={260}
          />
        </Card>
        <Card title="Moving time by sport (hours)">
          <EChart
            option={barChart(
              rewind.moving_time_per_sport.slice(0, 8).map((s) => s.label),
              rewind.moving_time_per_sport.slice(0, 8).map((s) => Math.round((s.moving_time_s / 3600) * 10) / 10),
              "#2563eb",
              "h",
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
            )}
            height={240}
          />
        </Card>
        <Card title="Active vs rest days">
          <EChart
            option={donutChart([
              { name: "Active", value: rewind.active_vs_rest.active_days, color: "#fc4c02" },
              { name: "Rest", value: rewind.active_vs_rest.rest_days, color: "#e5e7eb" },
            ])}
            height={240}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Calories burnt">
          <p className="stat-value text-brand">{formatNumber(rewind.calories.total)}</p>
          <p className="mt-1 text-sm text-gray-500">
            🍕 {formatNumber(rewind.calories.pizza_slices, 0)} pizza slices ·
            🍌 {formatNumber(rewind.calories.bananas, 0)} bananas
          </p>
        </Card>
        <Card title="Carbon saved">
          <p className="stat-value text-green-600">{formatNumber(rewind.carbon_saved.co2_kg, 0)} kg</p>
          <p className="mt-1 text-sm text-gray-500">
            ≈ {formatNumber(rewind.carbon_saved.plastic_bottles)} plastic bottles
          </p>
        </Card>
        <Card title="Longest streak">
          {rewind.longest_streak ? (
            <>
              <p className="stat-value text-brand">{rewind.longest_streak.length} days</p>
              <p className="mt-1 text-sm text-gray-500">
                {rewind.longest_streak.start} → {rewind.longest_streak.end}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400">No streak data.</p>
          )}
        </Card>
      </div>

      {rewind.biggest_activity && (
        <Card title="Biggest activity">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{rewind.biggest_activity.name}</p>
              <p className="text-sm text-gray-500">{rewind.biggest_activity.date}</p>
            </div>
            <div className="flex gap-6 text-sm">
              <span>
                <strong>{formatNumber(rewind.biggest_activity.distance, 1)}</strong> {distanceUnit}
              </span>
              <span>
                <strong>{formatNumber(rewind.biggest_activity.elevation_m, 0)}</strong> m
              </span>
              <span>
                <strong>{formatDuration(rewind.biggest_activity.moving_time_s)}</strong>
              </span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
