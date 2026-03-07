"use client"

import Link from "next/link"
import { useCallback, useState } from "react"

import { Card } from "@/components/ui/Card"
import { NoteField } from "@/components/ui/NoteField"
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States"
import {
  createGoal,
  deleteGoal,
  updateGoal,
  useActivities,
  useGoalsProgress,
  useMeta,
} from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { formatDate, formatDuration, formatNumber } from "@/lib/format"
import type { ActivitySummary, GoalCreate, GoalProgressResponse } from "@/lib/types"

const METRIC_OPTIONS: { value: string; label: string; unit: string }[] = [
  { value: "count", label: "Activities", unit: "" },
  { value: "distance_m", label: "Distance", unit: "km" },
  { value: "elevation_m", label: "Elevation", unit: "m" },
  { value: "moving_time_s", label: "Moving Time", unit: "" },
  { value: "calories", label: "Calories", unit: "kcal" },
]

function metricLabel(metric: string): string {
  return METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? metric
}

function formatMetricValue(metric: string, value: number): string {
  if (metric === "distance_m") return `${formatNumber(value / 1000, 1)} km`
  if (metric === "elevation_m") return `${formatNumber(value, 0)} m`
  if (metric === "moving_time_s") return formatDuration(value)
  if (metric === "calories") return `${formatNumber(value, 0)} kcal`
  return formatNumber(value, 0)
}

/** Human-readable, comma-separated labels for a goal's selected sports. */
function sportSummary(values: string[], options: { value: string; label: string }[]): string {
  return values.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ")
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Whole days from today until a goal's end date; ``null`` once it has passed. */
function daysLeftLabel(endDateISO: string): string | null {
  const end = new Date(`${endDateISO}T00:00:00`)
  const today = new Date(`${todayISO()}T00:00:00`)
  const days = Math.round((end.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return null
  if (days === 0) return "Last day"
  return `${days} ${days === 1 ? "day" : "days"} left`
}

function endOfYearISO(): string {
  return `${new Date().getFullYear()}-12-31`
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp255(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)))
}

const GOAL_ORANGE = [252, 76, 2] // first third (Strava-like)
const GOAL_BLUE = [59, 130, 246] // middle third
const GOAL_GREEN = [34, 197, 94] // final third

// Progress is split into three equal phases at these boundaries. The blend
// between phases is kept narrow (half-width each side) so each phase reads as
// its own solid color instead of a long muddy in-between.
const PHASE_ONE = 1 / 3
const PHASE_TWO = 2 / 3
const BLEND_HALF_WIDTH = 0.04

/** Phase color at progress ``t`` (0-1): orange, blue, or green with a narrow blend. */
function phaseColor(t: number): number[] {
  if (t <= PHASE_ONE - BLEND_HALF_WIDTH) return GOAL_ORANGE
  if (t < PHASE_ONE + BLEND_HALF_WIDTH) {
    const u = (t - (PHASE_ONE - BLEND_HALF_WIDTH)) / (2 * BLEND_HALF_WIDTH)
    return GOAL_ORANGE.map((c, i) => lerp(c, GOAL_BLUE[i], u))
  }
  if (t <= PHASE_TWO - BLEND_HALF_WIDTH) return GOAL_BLUE
  if (t < PHASE_TWO + BLEND_HALF_WIDTH) {
    const u = (t - (PHASE_TWO - BLEND_HALF_WIDTH)) / (2 * BLEND_HALF_WIDTH)
    return GOAL_BLUE.map((c, i) => lerp(c, GOAL_GREEN[i], u))
  }
  return GOAL_GREEN
}

/**
 * Fill color for a progress bar. Progress is divided into three equal phases -
 * orange (first third), blue (middle third), green (final third) - with only a
 * narrow blend between them, so each phase shows its own solid color rather than
 * a long muddy transition. Shaded light-to-dark for a graded look. Returns a CSS
 * ``linear-gradient`` for ``backgroundImage``.
 */
function progressGradient(pct: number): string {
  const t = Math.min(Math.max(pct, 0), 100) / 100
  const [r, g, b] = phaseColor(t)
  const shade = (f: number): string =>
    `rgb(${clamp255(r * f)}, ${clamp255(g * f)}, ${clamp255(b * f)})`
  return `linear-gradient(90deg, ${shade(1.15)}, ${shade(0.85)})`
}

export default function GoalsPage() {
  const { athleteId } = useAthleteContext()
  const { data: meta } = useMeta(athleteId)
  const { data: goals, error, isLoading, mutate: mutateGoals } = useGoalsProgress(athleteId)

  const [showForm, setShowForm] = useState(false)
  const [selectedGoalId, setSelectedGoalId] = useState<number | null>(null)

  if (isLoading) return <Spinner label="Loading goals…" />
  if (error) return <ErrorState message="Could not load goals." />

  const allGoals = goals ?? []
  const activeGoals = allGoals.filter((g) => g.end_date >= todayISO())
  const pastGoals = allGoals.filter((g) => g.end_date < todayISO())
  const selectedGoal = allGoals.find((g) => g.id === selectedGoalId) ?? null

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Goals</h1>
          <p className="text-sm text-gray-500">Set targets and track your progress.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors"
        >
          {showForm ? "Cancel" : "New Goal"}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-7">
        {/* Left: goals list (5/7) */}
        <div className="space-y-6 lg:col-span-5">
          {showForm && athleteId && (
            <NewGoalForm
              athleteId={athleteId}
              sportTypes={meta?.sport_types ?? []}
              onCreated={() => {
                setShowForm(false)
                void mutateGoals()
              }}
            />
          )}

          {activeGoals.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Active
              </h2>
              {activeGoals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  athleteId={athleteId}
                  sportTypes={meta?.sport_types ?? []}
                  selected={goal.id === selectedGoalId}
                  onSelect={() => setSelectedGoalId(goal.id)}
                  onMutate={() => void mutateGoals()}
                />
              ))}
            </section>
          )}

          {pastGoals.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Completed / Past
              </h2>
              {pastGoals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  athleteId={athleteId}
                  sportTypes={meta?.sport_types ?? []}
                  selected={goal.id === selectedGoalId}
                  onSelect={() => setSelectedGoalId(goal.id)}
                  onMutate={() => void mutateGoals()}
                />
              ))}
            </section>
          )}

          {allGoals.length === 0 && !showForm && (
            <Card>
              <div className="py-8 text-center text-gray-400">
                <p className="text-lg">No goals yet</p>
                <p className="mt-1 text-sm">Create your first goal to start tracking progress.</p>
              </div>
            </Card>
          )}
        </div>

        {/* Right: contributing activities (2/7) */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-6">
            {selectedGoal ? (
              <GoalActivitiesPanel goal={selectedGoal} athleteId={athleteId} />
            ) : (
              <Card title="Contributing activities">
                <EmptyState message="Select a goal to see the activities that count toward it." />
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Per-activity contribution to a goal's metric, in the metric's base unit. */
function activityContribution(metric: string, a: ActivitySummary): number {
  switch (metric) {
    case "count":
      return 1
    case "distance_m":
      return a.distance_km * 1000
    case "elevation_m":
      return a.elevation_m
    case "moving_time_s":
      return a.moving_time_s
    case "calories":
      return a.calories ?? 0
    default:
      return 0
  }
}

function GoalActivitiesPanel({
  goal,
  athleteId,
}: {
  goal: GoalProgressResponse
  athleteId: string | null
}) {
  const { data, error, isLoading } = useActivities(athleteId, {
    start: goal.start_date,
    end: `${goal.end_date}T23:59:59`,
    sport_type: goal.sport_types.length > 0 ? goal.sport_types : undefined,
    sort: "start_date_time",
    order: "desc",
    limit: 1000,
  })

  const activities = data?.items ?? []

  return (
    <Card
      title={`Contributing activities (${activities.length})`}
      action={
        <span className="text-sm text-gray-400">
          {metricLabel(goal.metric)}
          {goal.sport_types.length > 0 ? ` · ${goal.sport_types.join(", ")}` : ""}
        </span>
      }
    >
      {isLoading ? (
        <Spinner label="Loading activities…" />
      ) : error ? (
        <ErrorState message="Could not load activities." />
      ) : activities.length === 0 ? (
        <EmptyState message="No activities contribute to this goal yet." />
      ) : (
        <ul className="-mx-1 max-h-[70vh] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
          {activities.map((a) => (
            <li key={a.activity_id}>
              <Link
                href={`/activities/${a.activity_id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-1 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-gray-400">
                    {formatDate(a.start_date_time, "MMM d, yyyy")} · {a.sport_label}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums text-gray-600 dark:text-gray-300">
                  {formatMetricValue(goal.metric, activityContribution(goal.metric, a))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function GoalCard({
  goal,
  athleteId,
  sportTypes,
  selected,
  onSelect,
  onMutate,
}: {
  goal: GoalProgressResponse
  athleteId: string | null
  sportTypes: { value: string; label: string }[]
  selected: boolean
  onSelect: () => void
  onMutate: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)

  const pct = Math.min(goal.percentage, 100)
  const isComplete = pct >= 100
  const daysLeft = daysLeftLabel(goal.end_date)

  async function handleDelete() {
    if (!athleteId) return
    setBusy(true)
    try {
      await deleteGoal(athleteId, goal.id)
      onMutate()
    } finally {
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  if (editing && athleteId) {
    return (
      <EditGoalForm
        goal={goal}
        athleteId={athleteId}
        sportTypes={sportTypes}
        onSaved={() => {
          setEditing(false)
          onMutate()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <Card
      className={`cursor-pointer transition-colors ${
        selected ? "ring-2 ring-brand" : "hover:border-gray-300 dark:hover:border-gray-600"
      }`}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: the card wraps nested interactive controls (edit/delete) so it cannot be a <button>; role="button" with keyboard handlers is used instead */}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onSelect()
          }
        }}
        className="space-y-3 outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                {metricLabel(goal.metric)}
                {goal.sport_types.length > 0 && (
                  <span className="ml-1.5 text-sm font-normal text-gray-400">
                    ({sportSummary(goal.sport_types, sportTypes)})
                  </span>
                )}
              </span>
              {isComplete && (
                <span className="rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                  Done
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {formatDate(goal.start_date, "MMM d, yyyy")} &ndash;{" "}
              {formatDate(goal.end_date, "MMM d, yyyy")}
              {daysLeft && <span className="ml-2 text-gray-400">&middot; {daysLeft}</span>}
            </p>
            {goal.note && <p className="mt-1 text-sm text-gray-500 italic">{goal.note}</p>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-bold tabular-nums">
              {formatMetricValue(goal.metric, goal.current_value)}
            </div>
            <div className="text-sm text-gray-400">
              of {formatMetricValue(goal.metric, goal.target_value)}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.max(pct, 1)}%`, backgroundImage: progressGradient(pct) }}
            />
          </div>
          <span className="w-12 text-right text-sm font-medium tabular-nums">
            {formatNumber(pct, 0)}%
          </span>
        </div>

        <div className="flex justify-end gap-3">
          {athleteId && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-sm text-gray-400 hover:text-brand transition-colors"
            >
              Edit
            </button>
          )}
          {confirmDelete ? (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-red-500">Delete this goal?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="text-gray-400 hover:text-gray-600"
              >
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-gray-400 hover:text-red-500 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

/** Checkbox group for picking zero or more sports; empty means "all sports". */
function SportMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value])
  }

  if (options.length === 0) {
    return <p className="text-sm text-gray-400">No sports available yet.</p>
  }

  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
      {options.map((s) => (
        <label
          key={s.value}
          className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <input
            type="checkbox"
            checked={selected.includes(s.value)}
            onChange={() => toggle(s.value)}
            className="rounded border-gray-300 text-brand focus:ring-brand"
          />
          {s.label}
        </label>
      ))}
    </div>
  )
}

function EditGoalForm({
  goal,
  athleteId,
  sportTypes,
  onSaved,
  onCancel,
}: {
  goal: GoalProgressResponse
  athleteId: string
  sportTypes: { value: string; label: string }[]
  onSaved: () => void
  onCancel: () => void
}) {
  const displayTarget = goal.metric === "distance_m" ? goal.target_value / 1000 : goal.target_value

  const [metric, setMetric] = useState(goal.metric)
  const [targetValue, setTargetValue] = useState(String(displayTarget))
  const [selectedSports, setSelectedSports] = useState<string[]>(goal.sport_types)
  const [startDate, setStartDate] = useState(goal.start_date)
  const [endDate, setEndDate] = useState(goal.end_date)
  const [note, setNote] = useState(goal.note ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetUnit = METRIC_OPTIONS.find((m) => m.value === metric)?.unit ?? ""

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const raw = parseFloat(targetValue)
    if (Number.isNaN(raw) || raw <= 0) {
      setError("Target must be a positive number.")
      return
    }
    if (endDate < startDate) {
      setError("End date must be after start date.")
      return
    }

    const apiTarget = metric === "distance_m" ? raw * 1000 : raw

    setSaving(true)
    try {
      await updateGoal(athleteId, goal.id, {
        start_date: startDate,
        end_date: endDate,
        sport_types: selectedSports,
        metric,
        target_value: apiTarget,
        note: note.trim() || null,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update goal")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Edit Goal">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Metric</span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Target{targetUnit ? ` (${targetUnit})` : ""}
            </span>
            <input
              type="number"
              step="any"
              min="0"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <div className="block">
            <span className="mb-1 block text-sm font-medium">
              Sports{" "}
              <span className="font-normal text-gray-400">(optional, empty = all sports)</span>
            </span>
            <SportMultiSelect
              options={sportTypes}
              selected={selectedSports}
              onChange={setSelectedSports}
            />
          </div>

          <div className="block">
            <span className="mb-1 block text-sm font-medium">Note</span>
            <NoteField value={note} onChange={setNote} />
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Start date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">End date</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Card>
  )
}

function NewGoalForm({
  athleteId,
  sportTypes,
  onCreated,
}: {
  athleteId: string
  sportTypes: { value: string; label: string }[]
  onCreated: () => void
}) {
  const [metric, setMetric] = useState("distance_m")
  const [targetValue, setTargetValue] = useState("")
  const [selectedSports, setSelectedSports] = useState<string[]>([])
  const [startDate, setStartDate] = useState(todayISO)
  const [endDate, setEndDate] = useState(endOfYearISO)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetForApi = useCallback((): number => {
    const raw = parseFloat(targetValue)
    if (Number.isNaN(raw) || raw <= 0) return 0
    if (metric === "distance_m") return raw * 1000
    return raw
  }, [targetValue, metric])

  const targetUnit = METRIC_OPTIONS.find((m) => m.value === metric)?.unit ?? ""

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const apiTarget = targetForApi()
    if (apiTarget <= 0) {
      setError("Target must be a positive number.")
      return
    }
    if (endDate < startDate) {
      setError("End date must be after start date.")
      return
    }

    setSaving(true)
    try {
      const goal: GoalCreate = {
        start_date: startDate,
        end_date: endDate,
        sport_types: selectedSports,
        metric,
        target_value: apiTarget,
        note: note.trim() || null,
      }
      await createGoal(athleteId, goal)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create goal")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="New Goal">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Metric</span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Target{targetUnit ? ` (${targetUnit})` : ""}
            </span>
            <input
              type="number"
              step="any"
              min="0"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              placeholder={
                metric === "distance_m"
                  ? "e.g. 1000"
                  : metric === "count"
                    ? "e.g. 300"
                    : "e.g. 5000"
              }
              required
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <div className="block">
            <span className="mb-1 block text-sm font-medium">
              Sports{" "}
              <span className="font-normal text-gray-400">(optional, empty = all sports)</span>
            </span>
            <SportMultiSelect
              options={sportTypes}
              selected={selectedSports}
              onChange={setSelectedSports}
            />
          </div>

          <div className="block">
            <span className="mb-1 block text-sm font-medium">Note</span>
            <NoteField value={note} onChange={setNote} />
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Start date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">End date</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50 transition-colors"
          >
            {saving ? "Creating…" : "Create Goal"}
          </button>
        </div>
      </form>
    </Card>
  )
}
