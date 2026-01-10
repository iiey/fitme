"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { ErrorState, Spinner } from "@/components/ui/States";
import { useMeta, useMonth } from "@/lib/api";
import { colorForSportType, formatHours, formatNumber } from "@/lib/format";
import type { MonthDay } from "@/lib/types";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const now = new Date();

export default function CalendarPage() {
  const { data: meta } = useMeta();
  // Default to the month of the most recent activity (the export may be historical).
  const [current, setCurrent] = useState<{ year: number; month: number } | null>(null);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (initialised) return;
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
  const { data, error, isLoading } = useMonth(year, month);

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
          <h1 className="text-2xl font-bold">Monthly View</h1>
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
            <CalendarGrid days={data.days} firstWeekday={data.first_weekday} />
          </Card>

          {data.per_sport.length > 0 && (
            <Card title="By sport type">
              <ul className="divide-y divide-gray-100">
                {data.per_sport.map((sport) => (
                  <li key={sport.sport_type} className="flex items-center justify-between py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: colorForSportType(sport.sport_type) }}
                      />
                      {sport.label}
                    </span>
                    <span className="text-gray-500">
                      {sport.count} · {formatNumber(sport.distance, 1)} · {formatHours(sport.moving_time_s)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function CalendarGrid({ days, firstWeekday }: { days: MonthDay[]; firstWeekday: number }) {
  const maxDistance = Math.max(1, ...days.map((d) => d.distance));
  const leadingBlanks = Array.from({ length: firstWeekday });

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-400">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {leadingBlanks.map((_, index) => (
          <div key={`blank-${index}`} />
        ))}
        {days.map((day) => {
          const intensity = day.distance / maxDistance;
          const active = day.count > 0;
          return (
            <div
              key={day.date}
              className={clsx(
                "flex min-h-[64px] flex-col rounded-lg border p-1.5 text-xs",
                active ? "border-brand/30" : "border-gray-100",
              )}
              style={active ? { backgroundColor: `rgba(252, 76, 2, ${0.08 + intensity * 0.25})` } : undefined}
              title={active ? `${day.count} activities · ${formatNumber(day.distance, 1)}` : undefined}
            >
              <span className="font-semibold text-gray-500">{day.day}</span>
              {active && (
                <span className="mt-auto text-[11px] font-medium text-brand">
                  {formatNumber(day.distance, 1)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
