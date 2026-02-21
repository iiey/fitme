"use client"

import type { CoachInsights } from "@/lib/coach/types"

export function InsightsCard({ insights }: { insights: CoachInsights }) {
  const rows: { label: string; value: string; note?: string }[] = [
    { label: "Form (TSB)", value: insights.tsb.toFixed(1), note: insights.tsb_status },
    { label: "Fitness (CTL)", value: insights.ctl.toFixed(1) },
    { label: "Fatigue (ATL)", value: insights.atl.toFixed(1) },
    { label: "Acute:chronic", value: insights.ac_ratio.toFixed(2), note: insights.ac_status },
    { label: "Weekly load", value: Math.round(insights.weekly_trimp).toString() },
    { label: "Rest days (last 7)", value: insights.rest_days.toString() },
  ]
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800/50">
      <p className="mb-2 font-semibold">{"Today's insights"}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-baseline justify-between gap-2 rounded-md bg-white px-2 py-1 text-xs dark:bg-gray-900"
          >
            <span className="text-gray-500">{row.label}</span>
            <span className="text-right">
              <span className="font-medium">{row.value}</span>
              {row.note && <span className="block text-gray-500">{row.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
