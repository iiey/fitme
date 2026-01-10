"use client";

import { useMemo } from "react";

import type { CalendarPoint } from "@/lib/types";

// GitHub-style contribution grid driven by per-day training load.
const WEEKS = 53;
const DAY_MS = 24 * 60 * 60 * 1000;

function colorForLoad(load: number, max: number): string {
  if (load <= 0) return "#ebedf0";
  const intensity = Math.min(1, load / max);
  if (intensity < 0.25) return "#fcd9c4";
  if (intensity < 0.5) return "#fbae82";
  if (intensity < 0.75) return "#fc7e40";
  return "#fc4c02";
}

export function ActivityHeatmap({ points }: { points: CalendarPoint[] }) {
  const { cells, maxLoad } = useMemo(() => {
    const byDate = new Map(points.map((point) => [point.date, point]));
    const max = points.reduce((acc, point) => Math.max(acc, point.training_load), 1);

    const today = new Date();
    const start = new Date(today.getTime() - (WEEKS * 7 - 1) * DAY_MS);
    // Align the start to the preceding Monday.
    const offset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - offset);

    const grid: { date: string; load: number; count: number }[] = [];
    for (let i = 0; i < WEEKS * 7; i += 1) {
      const current = new Date(start.getTime() + i * DAY_MS);
      const iso = current.toISOString().slice(0, 10);
      const point = byDate.get(iso);
      grid.push({ date: iso, load: point?.training_load ?? 0, count: point?.count ?? 0 });
    }
    return { cells: grid, maxLoad: max };
  }, [points]);

  return (
    <div className="overflow-x-auto">
      <div
        className="grid grid-flow-col gap-[3px]"
        style={{ gridTemplateRows: "repeat(7, 11px)" }}
      >
        {cells.map((cell) => (
          <div
            key={cell.date}
            title={`${cell.date}: ${cell.count} activit${cell.count === 1 ? "y" : "ies"}`}
            className="h-[11px] w-[11px] rounded-[2px]"
            style={{ backgroundColor: colorForLoad(cell.load, maxLoad) }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-gray-400">
        <span>Less</span>
        {["#ebedf0", "#fcd9c4", "#fbae82", "#fc7e40", "#fc4c02"].map((color) => (
          <span key={color} className="h-[10px] w-[10px] rounded-[2px]" style={{ backgroundColor: color }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
