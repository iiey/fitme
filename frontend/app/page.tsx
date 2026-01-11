"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ActivityHeatmap } from "@/components/charts/ActivityHeatmap";
import { EChart } from "@/components/charts/EChart";
import { barChart, donutChart, lineChart } from "@/components/charts/options";
import { ImportDialog } from "@/components/import/ImportDialog";
import { Card } from "@/components/ui/Card";
import { DeferredSection } from "@/components/ui/DeferredSection";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import { useDashboard, useMeta } from "@/lib/api";
import { formatDate, formatHours, formatNumber } from "@/lib/format";

export default function DashboardPage() {
  const { data: meta } = useMeta();
  const [importOpen, setImportOpen] = useState(false);
  const [sportType, setSportType] = useState("");
  const [year, setYear] = useState("");

  const filters = useMemo(
    () => ({
      sport_type: sportType ? [sportType] : undefined,
      start: year ? `${year}-01-01` : undefined,
      end: year ? `${year}-12-31T23:59:59` : undefined,
    }),
    [sportType, year],
  );
  const { data, error, isLoading } = useDashboard(filters);

  const distanceUnit = meta?.distance_unit ?? "km";
  const availableYears = data?.available_years ?? [];

  // No data at all → prompt to import.
  if (!isLoading && data?.empty) {
    return (
      <>
        <EmptyState
          message="No activities yet. Import a Strava export to get started."
          action={
            <button
              onClick={() => setImportOpen(true)}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              ⬆️ Import data
            </button>
          }
        />
        {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      </>
    );
  }

  const filterControls = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={sportType}
        onChange={(event) => setSportType(event.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
      >
        <option value="">All sports</option>
        {meta?.sport_types.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        value={year}
        onChange={(event) => setYear(event.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
      >
        <option value="">All time</option>
        {availableYears.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-gray-500">{meta?.app_subtitle}</p>
      </div>
      {filterControls}
    </header>
  );

  if (isLoading && !data) {
    return (
      <div className="space-y-6">
        {header}
        <Spinner label="Loading dashboard…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState />
      </div>
    );
  }
  if (!data || data.filtered_empty) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState message="No activities match these filters. Try a different sport or time period." />
      </div>
    );
  }

  const monthly = data.monthly_stats.slice(-24);

  return (
    <div className="space-y-6">
      {header}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Activities" value={formatNumber(data.totals.count)} accent />
        <StatCard label={`Distance (${distanceUnit})`} value={formatNumber(data.totals.distance, 0)} />
        <StatCard label="Elevation (m)" value={formatNumber(data.totals.elevation, 0)} />
        <StatCard label="Moving Time" value={formatHours(data.totals.moving_time_s)} />
      </div>

      {/* Activity heatmap calendar */}
      <Card title="Activity heatmap (last 12 months)">
        <ActivityHeatmap points={data.activity_calendar} />
      </Card>

      <DeferredSection height={100}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Current streak" className="lg:col-span-1">
            <div className="flex items-baseline gap-2">
              <span className="stat-value text-brand">{data.streaks.current}</span>
              <span className="text-sm text-gray-500">days</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">Longest: {data.streaks.longest} days</p>
          </Card>
          <Card title="Eddington" className="lg:col-span-2">
            <div className="flex flex-wrap gap-4">
              {data.eddington.length === 0 && (
                <p className="text-sm text-gray-400">Not enough distance data yet.</p>
              )}
              {data.eddington.map((item) => (
                <div key={item.activity_type} className="rounded-lg bg-surface-muted px-4 py-2">
                  <p className="text-xs uppercase text-gray-500">{item.activity_type}</p>
                  <p className="text-xl font-bold">{item.number}</p>
                  {item.days_to_next != null && (
                    <p className="text-[11px] text-gray-400">
                      {item.days_to_next} days to {item.next}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </DeferredSection>

      {/* Monthly + weekly trends */}
      <DeferredSection height={300}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title={`Monthly distance (${distanceUnit})`}>
            <EChart
              option={barChart(
                monthly.map((m) => m.period),
                monthly.map((m) => m.distance),
                "#fc4c02",
                distanceUnit,
              )}
              height={260}
            />
          </Card>
          <Card title="Weekly moving time (hours)">
            <EChart
              option={lineChart(
                data.weekly_stats.map((w) => w.period.replace(/^\d+-/, "")),
                data.weekly_stats.map((w) => Math.round((w.moving_time_s / 3600) * 10) / 10),
                "#2563eb",
              )}
              height={260}
            />
          </Card>
        </div>
      </DeferredSection>

      {/* Training load */}
      <DeferredSection height={260}>
        <Card title="Training load (last 90 days)">
          <EChart
            option={barChart(
              data.training_load.map((t) => t.date.slice(5)),
              data.training_load.map((t) => t.load),
              "#7c3aed",
            )}
            height={220}
          />
        </Card>
      </DeferredSection>

      {/* Distributions */}
      <DeferredSection height={260}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="By weekday">
            <EChart
              option={barChart(
                data.weekday_stats.map((d) => d.label),
                data.weekday_stats.map((d) => d.count),
                "#16a34a",
              )}
              height={220}
            />
          </Card>
          <Card title="By time of day">
            <EChart
              option={donutChart(
                data.daytime_stats.map((d) => ({ name: d.label, value: d.count })),
              )}
              height={220}
            />
          </Card>
          <Card title="Distance breakdown">
            <EChart
              option={donutChart(
                data.distance_breakdown
                  .filter((d) => d.count > 0)
                  .map((d) => ({ name: d.label, value: d.count })),
              )}
              height={220}
            />
          </Card>
        </div>
      </DeferredSection>

      {/* HR zones + peak power */}
      <DeferredSection height={260}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.hr_zones && (
            <Card title={`Heart-rate zones (last ${data.hr_zones.window_days} days)`}>
              <EChart
                option={barChart(
                  ["Z1", "Z2", "Z3", "Z4", "Z5"],
                  data.hr_zones.zones.map((s) => Math.round((s / 3600) * 10) / 10),
                  "#dc2626",
                  "h",
                )}
                height={220}
              />
            </Card>
          )}
          {data.peak_power && (
            <Card title={`Peak power (last ${data.peak_power.window_days} days)`}>
              <EChart
                option={barChart(
                  data.peak_power.outputs.map((o) => labelForDuration(o.duration_s)),
                  data.peak_power.outputs.map((o) => o.watts ?? 0),
                  "#ca8a04",
                  "W",
                )}
                height={220}
              />
            </Card>
          )}
        </div>
      </DeferredSection>

      {/* Recent activities + milestones */}
      <DeferredSection height={200}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Recent activities">
            <ul className="divide-y divide-gray-100">
              {data.recent_activities.map((activity) => (
                <li key={activity.activity_id} className="flex items-center justify-between py-2">
                  <Link
                    href={`/activities/${activity.activity_id}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {activity.name}
                  </Link>
                  <span className="text-xs text-gray-400">{formatDate(activity.start_date_time)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Recent milestones">
            <ul className="divide-y divide-gray-100">
              {data.recent_milestones.map((milestone, index) => (
                <li key={index} className="py-2">
                  <p className="text-sm font-medium">{milestone.title}</p>
                  <p className="text-xs text-gray-400">{formatDate(milestone.achieved_on)}</p>
                </li>
              ))}
              {data.recent_milestones.length === 0 && (
                <li className="py-2 text-sm text-gray-400">No milestones yet.</li>
              )}
            </ul>
          </Card>
        </div>
      </DeferredSection>
    </div>
  );
}

function labelForDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}
