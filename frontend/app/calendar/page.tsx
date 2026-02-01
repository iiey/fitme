"use client";

import clsx from "clsx";
import { getISOWeek, parseISO } from "date-fns";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { InfoTip } from "@/components/ui/InfoTip";
import { ErrorState, Spinner } from "@/components/ui/States";
import { useMeta, useMonth } from "@/lib/api";
import { useAthleteContext } from "@/lib/athlete-context";
import { colorForSportType, formatHours, formatNumber } from "@/lib/format";
import type { CalendarActivity, MonthDay } from "@/lib/types";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const now = new Date();

export default function CalendarPage() {
  const { athleteId } = useAthleteContext();
  const { data: meta } = useMeta(athleteId);
  // Default to the month of the most recent activity (the export may be historical).
  const [current, setCurrent] = useState<{ year: number; month: number } | null>(null);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (initialised) return;
    const params = new URLSearchParams(window.location.search);
    const yearParam = parseInt(params.get("year") ?? "", 10);
    const monthParam = parseInt(params.get("month") ?? "", 10);
    if (yearParam && monthParam >= 1 && monthParam <= 12) {
      setCurrent({ year: yearParam, month: monthParam });
      setInitialised(true);
      return;
    }
    if (meta?.last_activity) {
      const last = new Date(meta.last_activity);
      setCurrent({ year: last.getFullYear(), month: last.getMonth() + 1 });
      setInitialised(true);
    } else if (meta && !meta.last_activity) {
      setCurrent({ year: now.getFullYear(), month: now.getMonth() + 1 });
      setInitialised(true);
    }
  }, [meta, initialised]);

  const year = current?.year ?? now.getFullYear();
  const month = current?.month ?? now.getMonth() + 1;
  const { data, error, isLoading } = useMonth(athleteId, year, month);

  const goPrev = () => {
    setCurrent(
      month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 },
    );
  };

  const goNext = () => {
    setCurrent(
      month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 },
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center text-2xl font-bold">
            Calendar
            <InfoTip width="w-72" position="below">
              <p className="mb-1.5 font-semibold">How to read this calendar</p>
              <ul className="list-inside list-disc space-y-1">
                <li><strong>Week column</strong> - Weekly totals: time, distance, elevation, calories &amp; training load.</li>
                <li><strong>Day number</strong> - Click to view that day&apos;s activities.</li>
                <li><strong>Activity rows</strong> - Duration, distance, avg HR &amp; training load.</li>
                <li><strong>Sport dot</strong> - Colored by sport type.</li>
              </ul>
            </InfoTip>
          </h1>
          <p className="text-sm text-gray-500">Monthly stats with an interactive calendar</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">
            ←
          </button>
          <span className="min-w-[140px] text-center text-sm font-semibold">
            {data?.month_name ?? ""} {year}
          </span>
          <button onClick={goNext} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">
            →
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
            <StatCard label="Activities" value={formatNumber(data.totals.count)} accent />
            <StatCard label={`Distance (${data.unit_system === "imperial" ? "mi" : "km"})`} value={formatNumber(data.totals.distance, 1)} />
            <StatCard label="Elevation (m)" value={formatNumber(data.totals.elevation, 0)} />
            <StatCard label="Moving Time" value={formatHours(data.totals.moving_time_s)} />
          </div>

          <Card>
            <CalendarGrid days={data.days} firstWeekday={data.first_weekday} unitSystem={data.unit_system} activities={data.activities} />
          </Card>

          {data.per_sport.length > 0 && (
            <Card title="By sport type">
              <div className="mb-1 flex items-center justify-between border-b border-gray-100 pb-1 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:border-gray-700">
                <span className="pl-5">Sport</span>
                <span className="flex">
                  <span className="w-12 text-right">Count</span>
                  <span className="w-20 text-right">{data.unit_system === "imperial" ? "Miles" : "Km"}</span>
                  <span className="w-16 text-right">Time</span>
                </span>
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.per_sport.map((sport) => {
                  const monthStr = String(month).padStart(2, "0");
                  const from = `${year}-${monthStr}-01`;
                  const to = `${year}-${monthStr}-${String(data.days_in_month).padStart(2, "0")}`;
                  const href = `/activities?sport=${encodeURIComponent(sport.sport_type)}&from=${from}&to=${to}`;
                  return (
                    <li key={sport.sport_type}>
                      <Link
                        href={href}
                        title={`View ${sport.label} activities in ${data.month_name} ${year}`}
                        className="flex items-center justify-between rounded-md py-2 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: colorForSportType(sport.sport_type) }}
                          />
                          <span className="font-medium text-brand hover:underline">{sport.label}</span>
                        </span>
                        <span className="flex text-gray-500">
                          <span className="w-12 text-right">{sport.count}</span>
                          <span className="w-20 text-right">{formatNumber(sport.distance, 1)}</span>
                          <span className="w-16 text-right">{formatHours(sport.moving_time_s)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function formatCompactTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

function CalendarGrid({
  days,
  firstWeekday,
  unitSystem,
  activities,
}: {
  days: MonthDay[];
  firstWeekday: number;
  unitSystem: string;
  activities: CalendarActivity[];
}) {
  const maxDistance = Math.max(1, ...days.map((d) => d.distance));
  const distUnit = unitSystem === "imperial" ? "mi" : "km";
  const elevUnit = unitSystem === "imperial" ? "ft" : "m";

  const activitiesByDate = new Map<string, CalendarActivity[]>();
  for (const act of activities) {
    const dateKey = act.start_date_time.split("T")[0];
    const list = activitiesByDate.get(dateKey) ?? [];
    list.push(act);
    activitiesByDate.set(dateKey, list);
  }

  const allCells: (MonthDay | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...days,
  ];
  while (allCells.length % 7 !== 0) allCells.push(null);

  const weeks: {
    weekNum: number;
    cells: (MonthDay | null)[];
    count: number;
    time_s: number;
    distance: number;
    elevation: number;
    calories: number;
    load: number;
  }[] = [];
  for (let i = 0; i < allCells.length; i += 7) {
    const cells = allCells.slice(i, i + 7);
    const firstDay = cells.find((d): d is MonthDay => d !== null);
    const weekNum = firstDay ? getISOWeek(parseISO(firstDay.date)) : 0;
    let count = 0;
    let time_s = 0;
    let distance = 0;
    let elevation = 0;
    let calories = 0;
    let load = 0;
    for (const d of cells) {
      if (d && d.count > 0) {
        count += d.count;
        time_s += d.moving_time_s;
        distance += d.distance;
        elevation += d.elevation;
        calories += d.calories;
        const dayActs = activitiesByDate.get(d.date) ?? [];
        for (const a of dayActs) load += a.load;
      }
    }
    weeks.push({ weekNum, cells, count, time_s, distance, elevation, calories, load });
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
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-[80px_repeat(7,1fr)] gap-1">
            <div
              className="flex flex-col items-center justify-center rounded-lg bg-gray-50 py-1 text-gray-400 dark:bg-gray-800/50"
              title={
                week.count > 0
                  ? `Week ${week.weekNum}: ${week.count} activities · ${formatHours(week.time_s)} · ${formatNumber(week.distance, 1)} ${distUnit} · ${formatNumber(week.elevation, 0)} ${elevUnit}${week.calories > 0 ? ` · ${formatNumber(week.calories, 0)} cal` : ""}${week.load > 0 ? ` · Load ${week.load}` : ""}`
                  : `Week ${week.weekNum}`
              }
            >
              <span className="text-xs font-bold text-gray-500 dark:text-gray-300">{week.weekNum}</span>
              {week.count > 0 && (
                <div className="mt-0.5 flex flex-col items-center text-[11px] leading-snug">
                  <span className="font-medium">{formatHours(week.time_s)}</span>
                  <span>{formatNumber(week.distance, 0)} {distUnit}</span>
                  {week.elevation > 0 && (
                    <span>{formatNumber(week.elevation, 0)} {elevUnit}</span>
                  )}
                  {week.calories > 0 && (
                    <span>{formatNumber(week.calories, 0)} cal</span>
                  )}
                  {week.load > 0 && (
                    <span className="font-medium text-brand">L {week.load}</span>
                  )}
                </div>
              )}
            </div>
            {week.cells.map((day, di) => {
              if (!day) return <div key={`blank-${wi}-${di}`} />;
              const dayActs = activitiesByDate.get(day.date) ?? [];
              return (
                <div
                  key={day.date}
                  className={clsx(
                    "flex min-h-[150px] flex-col rounded-lg border p-1.5 text-xs",
                    day.count > 0 ? "border-brand/30" : "border-gray-100 dark:border-gray-700",
                  )}
                  style={
                    day.count > 0
                      ? { backgroundColor: `rgba(59, 130, 246, ${0.05 + (day.distance / maxDistance) * 0.15})` }
                      : undefined
                  }
                >
                  <Link
                    href={`/activities?from=${day.date}&to=${day.date}`}
                    className="mb-0.5 text-xl font-bold text-gray-400 transition-colors hover:text-brand"
                  >
                    {day.day}
                  </Link>
                  {dayActs.slice(0, 3).map((act) => {
                    const dist = unitSystem === "imperial" ? act.distance_mi : act.distance_km;
                    return (
                      <div
                        key={act.activity_id}
                        className="mt-px flex flex-wrap items-center gap-x-1 text-[15px] leading-snug text-gray-600 dark:text-gray-300"
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colorForSportType(act.sport_type) }}
                        />
                        <span className="font-medium">{formatCompactTime(act.moving_time_s)}</span>
                        {dist > 0.1 && <span>{formatNumber(dist, 1)} {distUnit}</span>}
                        {act.average_heart_rate != null && (
                          <span className="text-red-400">♥{Math.round(act.average_heart_rate)}</span>
                        )}
                        {act.load > 0 && (
                          <span className="text-brand">L{act.load}</span>
                        )}
                      </div>
                    );
                  })}
                  {dayActs.length > 3 && (
                    <span className="mt-px text-[10px] text-gray-400">+{dayActs.length - 3} more</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
