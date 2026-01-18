"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ActivityHeatmap } from "@/components/charts/ActivityHeatmap";
import { EChart } from "@/components/charts/EChart";
import { barChart, donutChart, hrZoneBarChart, lineChart, yearlyStatsChart } from "@/components/charts/options";
import { TrainingLoadSection } from "@/components/charts/TrainingLoadSection";
import { ImportDialog } from "@/components/import/ImportDialog";
import { Card } from "@/components/ui/Card";
import { DeferredSection } from "@/components/ui/DeferredSection";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import { useDashboard, useMeta } from "@/lib/api";
import { useAthleteContext } from "@/lib/athlete-context";
import { formatDate, formatHours, formatNumber } from "@/lib/format";
import { useIsDark } from "@/lib/use-is-dark";

const WINDOW_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
  { value: 120, label: "120 days" },
  { value: 180, label: "180 days" },
  { value: 365, label: "1 year" },
];

const HR_ZONE_INFO: Record<string, string> = {
  Z1: "Recovery — very light effort, active recovery",
  Z2: "Endurance — easy conversational pace, fat-burning base",
  Z3: "Tempo — moderate effort, sustained pace",
  Z4: "Threshold — hard effort near lactate threshold",
  Z5: "VO2max — maximal effort, anaerobic capacity",
};

const POWER_DURATION_INFO: Record<string, string> = {
  "5s": "Neuromuscular — peak sprint power",
  "30s": "Anaerobic capacity — short burst power",
  "1m": "Anaerobic power — sustained sprint",
  "5m": "VO2max / MAP — maximal aerobic power",
  "20m": "FTP estimate — functional threshold power",
};

export default function DashboardPage() {
  const { athleteId } = useAthleteContext();
  const { data: meta } = useMeta(athleteId);
  const isDark = useIsDark();
  const [importOpen, setImportOpen] = useState(false);
  const [sportType, setSportType] = useState("");
  const [year, setYear] = useState("");
  const [hrWindow, setHrWindow] = useState(30);
  const [powerWindow, setPowerWindow] = useState(120);

  const filters = useMemo(
    () => ({
      sport_type: sportType ? [sportType] : undefined,
      start: year ? `${year}-01-01` : undefined,
      end: year ? `${year}-12-31T23:59:59` : undefined,
      hr_window: hrWindow,
      power_window: powerWindow,
    }),
    [sportType, year, hrWindow, powerWindow],
  );
  const { data, error, isLoading } = useDashboard(athleteId, filters);

  const distanceUnit = meta?.distance_unit ?? "km";
  const availableYears = data?.available_years ?? [];

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
              Import data
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
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none dark:border-gray-600 dark:bg-surface dark:text-foreground"
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
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none dark:border-gray-600 dark:bg-surface dark:text-foreground"
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
      <Card title="Activity intensity">
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
                isDark,
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
                isDark,
              )}
              height={260}
            />
          </Card>
        </div>
      </DeferredSection>

      {/* Training load analysis */}
      {data.training_load_analysis && (
        <DeferredSection height={160}>
          <TrainingLoadSection analysis={data.training_load_analysis} />
        </DeferredSection>
      )}

      {/* Yearly stats + HR zones + Peak power + By weekday */}
      <DeferredSection height={340}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {data.monthly_stats.length > 0 && (
            <Card title={`Yearly stats (${distanceUnit})`}>
              <EChart
                option={yearlyStatsChart(data.monthly_stats, distanceUnit, isDark)}
                height={280}
              />
            </Card>
          )}
          {data.hr_zones && (
            <Card
              title={
                <div className="flex items-center gap-2">
                  <span>Heart-rate zones</span>
                  <InfoTooltip text="Time spent in each HR zone. Z1=Recovery, Z2=Endurance, Z3=Tempo, Z4=Threshold, Z5=VO2max" />
                </div>
              }
              action={
                <WindowSelector value={hrWindow} onChange={setHrWindow} />
              }
            >
              <EChart
                option={hrZoneBarChart(
                  data.hr_zones.zones.map((s) => Math.round((s / 3600) * 10) / 10),
                  "h",
                  isDark,
                )}
                height={220}
              />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(HR_ZONE_INFO).map(([zone, desc]) => (
                  <span key={zone} className="text-[11px] text-gray-400">
                    <strong className="text-gray-500 dark:text-gray-300">{zone}</strong> {desc.split("—")[1]?.trim()}
                  </span>
                ))}
              </div>
            </Card>
          )}
          {data.peak_power && (
            <Card
              title={
                <div className="flex items-center gap-2">
                  <span>Peak power</span>
                  <InfoTooltip text="Best average watts for each duration. 5s=Sprint, 30s=Anaerobic, 1m=Power, 5m=VO2max, 20m=FTP" />
                </div>
              }
              action={
                <WindowSelector value={powerWindow} onChange={setPowerWindow} />
              }
            >
              <EChart
                option={barChart(
                  data.peak_power.outputs.map((o) => labelForDuration(o.duration_s)),
                  data.peak_power.outputs.map((o) => o.watts ?? 0),
                  "#ca8a04",
                  "W",
                  isDark,
                )}
                height={220}
              />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(POWER_DURATION_INFO).map(([dur, desc]) => (
                  <span key={dur} className="text-[11px] text-gray-400">
                    <strong className="text-gray-500 dark:text-gray-300">{dur}</strong> {desc.split("—")[1]?.trim()}
                  </span>
                ))}
              </div>
            </Card>
          )}
          <Card title="By weekday">
            <EChart
              option={barChart(
                data.weekday_stats.map((d) => d.label),
                data.weekday_stats.map((d) => d.count),
                "#16a34a",
                "",
                isDark,
              )}
              height={220}
            />
          </Card>
        </div>
      </DeferredSection>

      {/* VO2Max trend + By time of day + Distance breakdown */}
      <DeferredSection height={260}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="VO2Max over time">
            {data.vo2max_trend && data.vo2max_trend.length > 0 ? (
              <EChart
                option={lineChart(
                  data.vo2max_trend.map((p) => p.date.slice(5)),
                  data.vo2max_trend.map((p) => p.vo2max),
                  "#8b5cf6",
                  isDark,
                )}
                height={220}
              />
            ) : (
              <p className="flex h-[220px] items-center justify-center text-sm text-gray-400">
                Not enough running data yet.
              </p>
            )}
          </Card>
          <Card title="By time of day">
            <EChart
              option={donutChart(
                data.daytime_stats.map((d) => ({ name: d.label, value: d.count })),
                isDark,
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
                isDark,
              )}
              height={220}
            />
          </Card>
        </div>
      </DeferredSection>

      {/* Recent activities + milestones */}
      <DeferredSection height={200}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Recent activities">
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
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
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
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

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative cursor-help">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-400">
        ?
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs leading-relaxed text-gray-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-gray-700">
        {text}
      </span>
    </span>
  );
}

function WindowSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand focus:outline-none dark:border-gray-600 dark:bg-surface dark:text-foreground"
    >
      {WINDOW_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
