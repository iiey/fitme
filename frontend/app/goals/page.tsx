"use client"

import { useCallback, useState } from "react"

import { Card } from "@/components/ui/Card"
import { NoteField } from "@/components/ui/NoteField"
import { ErrorState, Spinner } from "@/components/ui/States"
import { createGoal, deleteGoal, updateGoal, useGoalsProgress, useMeta } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { formatDate, formatDuration, formatNumber } from "@/lib/format"
import type { GoalCreate, GoalProgressResponse } from "@/lib/types"

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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function endOfYearISO(): string {
  return `${new Date().getFullYear()}-12-31`
}

export default function GoalsPage() {
  const { athleteId } = useAthleteContext()
  const { data: meta } = useMeta(athleteId)
  const { data: goals, error, isLoading, mutate: mutateGoals } = useGoalsProgress(athleteId)

  const [showForm, setShowForm] = useState(false)

  if (isLoading) return <Spinner label="Loading goals…" />
  if (error) return <ErrorState message="Could not load goals." />

  const activeGoals = (goals ?? []).filter((g) => g.end_date >= todayISO())
  const pastGoals = (goals ?? []).filter((g) => g.end_date < todayISO())

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Goals</h1>
          <p className="text-sm text-gray-500">Set targets and track your progress.</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors"
        >
          {showForm ? "Cancel" : "New Goal"}
        </button>
      </header>

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
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Active</h2>
          {activeGoals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              athleteId={athleteId}
              sportTypes={meta?.sport_types ?? []}
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
              onMutate={() => void mutateGoals()}
            />
          ))}
        </section>
      )}

      {(goals ?? []).length === 0 && !showForm && (
        <Card>
          <div className="py-8 text-center text-gray-400">
            <p className="text-lg">No goals yet</p>
            <p className="mt-1 text-sm">Create your first goal to start tracking progress.</p>
          </div>
        </Card>
      )}
    </div>
  )
}

function GoalCard({
  goal,
  athleteId,
  sportTypes,
  onMutate,
}: {
  goal: GoalProgressResponse
  athleteId: string | null
  sportTypes: { value: string; label: string }[]
  onMutate: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)

  const pct = Math.min(goal.percentage, 100)
  const isComplete = pct >= 100
  const barColor = isComplete ? "bg-green-500" : "bg-brand"

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

  if (editing) {
    return (
      <EditGoalForm
        goal={goal}
        athleteId={athleteId!}
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
    <Card>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                {metricLabel(goal.metric)}
                {goal.sport_type && (
                  <span className="ml-1.5 text-sm font-normal text-gray-400">
                    ({goal.sport_type})
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
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${Math.max(pct, 1)}%` }}
            />
          </div>
          <span className="w-12 text-right text-sm font-medium tabular-nums">
            {formatNumber(pct, 0)}%
          </span>
        </div>

        <div className="flex justify-end gap-3">
          {athleteId && (
            <button
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
                onClick={handleDelete}
                disabled={busy}
                className="font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="text-gray-400 hover:text-gray-600"
              >
                No
              </button>
            </span>
          ) : (
            <button
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
  const [sportType, setSportType] = useState(goal.sport_type ?? "")
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
    if (isNaN(raw) || raw <= 0) {
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
        sport_type: sportType || null,
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

          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Sport <span className="font-normal text-gray-400">(optional)</span>
            </span>
            <select
              value={sportType}
              onChange={(e) => setSportType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="">All sports</option>
              {sportTypes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

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
  const [sportType, setSportType] = useState("")
  const [startDate, setStartDate] = useState(todayISO)
  const [endDate, setEndDate] = useState(endOfYearISO)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetForApi = useCallback((): number => {
    const raw = parseFloat(targetValue)
    if (isNaN(raw) || raw <= 0) return 0
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
        sport_type: sportType || null,
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

          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Sport <span className="font-normal text-gray-400">(optional)</span>
            </span>
            <select
              value={sportType}
              onChange={(e) => setSportType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="">All sports</option>
              {sportTypes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

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
