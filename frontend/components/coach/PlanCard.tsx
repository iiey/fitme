"use client"

import type { PlannedSession, TrainingPlan } from "@/lib/coach/types"

function sessionMeta(session: PlannedSession): string {
  const parts: string[] = []
  if (session.intensity) parts.push(session.intensity)
  if (session.target_distance_km) parts.push(`${session.target_distance_km} km`)
  if (session.target_duration_min) parts.push(`${session.target_duration_min} min`)
  return parts.join(" · ")
}

export function PlanCard({ plan }: { plan: TrainingPlan }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800/50">
      <p className="font-semibold">{plan.title}</p>
      {plan.summary && <p className="mb-2 text-xs text-gray-500">{plan.summary}</p>}
      <div className="space-y-3">
        {plan.weeks.map((week) => (
          <div key={week.week}>
            <p className="text-xs font-semibold text-brand">
              Week {week.week} — {week.focus}
            </p>
            <ul className="mt-1 space-y-1">
              {week.sessions.map((session) => {
                const meta = sessionMeta(session)
                return (
                  <li
                    key={`${session.day}-${session.sport}-${session.workout_type}`}
                    className="rounded-md bg-white px-2 py-1 text-xs dark:bg-gray-900"
                  >
                    <span className="font-medium">
                      {session.day}: {session.workout_type}
                    </span>
                    {meta && <span className="text-gray-500"> · {meta}</span>}
                    {session.description && (
                      <span className="block text-gray-500">{session.description}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
