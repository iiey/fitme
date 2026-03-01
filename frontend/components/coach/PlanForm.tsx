"use client"

import { useState } from "react"

interface PlanFormProps {
  busy: boolean
  onGenerate: (goal: string, weeks: number) => void
}

const WEEK_OPTIONS = [2, 4, 6, 8, 12]

export function PlanForm({ busy, onGenerate }: PlanFormProps) {
  const [goal, setGoal] = useState("")
  const [weeks, setWeeks] = useState(4)

  return (
    <div className="space-y-2 border-b border-gray-200 bg-surface p-4 dark:border-gray-700">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
        Build a training plan
      </div>
      <input
        type="text"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="Your goal, e.g. run a sub-25 minute 5k"
        disabled={busy}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
      />
      <div className="flex items-center gap-2">
        <label htmlFor="plan-weeks" className="text-xs text-gray-500">
          Weeks
        </label>
        <select
          id="plan-weeks"
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          disabled={busy}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          {WEEK_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !goal.trim()}
          onClick={() => onGenerate(goal.trim(), weeks)}
          className="ml-auto rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? "Generating…" : "Generate"}
        </button>
      </div>
    </div>
  )
}
