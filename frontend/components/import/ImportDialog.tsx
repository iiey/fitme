"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { mutate } from "swr"

import { getImportRun, previewImport, startImport } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import type { ImportPreview, ImportRunStatus } from "@/lib/types"

type Mode = "upload" | "path"
type Phase = "select" | "confirm" | "importing"
type MergeChoice = "new" | "merge"

const POLL_INTERVAL_MS = 1500

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { athletes } = useAthleteContext()
  const [phase, setPhase] = useState<Phase>("select")
  const [mode, setMode] = useState<Mode>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [path, setPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mergeChoice, setMergeChoice] = useState<MergeChoice>("new")
  const [targetAthleteId, setTargetAthleteId] = useState("")
  const [status, setStatus] = useState<ImportRunStatus | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  const refreshData = useCallback(() => {
    // Revalidate every cached endpoint so the UI reflects the new import.
    mutate((key) => typeof key === "string" && key.startsWith("/api/"), undefined, {
      revalidate: true,
    })
  }, [])

  // Existing athletes this import could merge into (excluding the export's own).
  const mergeTargets = useMemo(
    () => athletes.filter((a) => a.athlete_id !== preview?.source_athlete_id),
    [athletes, preview],
  )

  // Poll the run while it imports in the background. Each tick refreshes the
  // app's data so newly imported activities appear gradually, and stops once
  // the import finishes or fails.
  useEffect(() => {
    if (!status || status.status !== "running") return
    const runId = status.id
    const timer = setInterval(async () => {
      try {
        const next = await getImportRun(runId)
        setStatus(next)
        refreshData()
        if (next.status === "ok" && (next.added > 0 || next.updated > 0)) {
          closeTimer.current = setTimeout(onClose, 1500)
        }
      } catch {
        // Transient polling error - keep trying on the next tick.
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [status, refreshData, onClose])

  const continueToPreview = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result =
        mode === "upload" && file
          ? await previewImport({ file })
          : await previewImport({ source: path.trim() })
      setPreview(result)
      // Default to the suggested merge target when one is offered, else import
      // as a new (own) athlete.
      if (result.suggested_athlete_id) {
        setMergeChoice("merge")
        setTargetAthleteId(result.suggested_athlete_id)
      } else {
        setMergeChoice("new")
        setTargetAthleteId("")
      }
      setPhase("confirm")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read export")
    } finally {
      setBusy(false)
    }
  }, [mode, file, path])

  const runImport = useCallback(async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      // "merge" targets the chosen athlete; "new" pins the export's own id so a
      // remembered mapping can't silently re-merge it.
      const target =
        mergeChoice === "merge" && targetAthleteId ? targetAthleteId : preview.source_athlete_id
      const started = await startImport(preview.source, target)
      setStatus(started)
      setPhase("importing")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed")
    } finally {
      setBusy(false)
    }
  }, [preview, mergeChoice, targetAthleteId])

  const handleClose = useCallback(() => {
    // The import keeps running server-side; pull the latest data on the way out.
    if (status?.status === "running") refreshData()
    onClose()
  }, [status, refreshData, onClose])

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) setFile(dropped)
  }, [])

  const canContinue = mode === "upload" ? !!file : path.trim().length > 0
  const running = status?.status === "running"
  const done = status?.status === "ok"
  const failed = status?.status === "error"
  const percent =
    status && status.total
      ? Math.min(100, Math.round((status.processed / status.total) * 100))
      : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-surface p-6 text-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Import activity data</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {phase === "select" && (
          <>
            <div className="mb-4 flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
              <button onClick={() => setMode("upload")} className={tabClass(mode === "upload")}>
                Upload .zip
              </button>
              <button onClick={() => setMode("path")} className={tabClass(mode === "path")}>
                Server path
              </button>
            </div>

            {mode === "upload" ? (
              <div
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                  dragOver
                    ? "border-brand bg-brand/5"
                    : "border-gray-300 hover:border-brand dark:border-gray-600"
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <span className="text-3xl">📦</span>
                <p className="mt-2 text-sm font-medium">
                  {file ? file.name : "Drop your export_*.zip here or click to choose"}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  A bulk export (.zip) from Strava or Garmin
                </p>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                  Path to export (.zip or folder) on the server
                </label>
                <input
                  type="text"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="/data/export_12345.zip"
                  className="w-full rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-gray-400 focus:border-brand focus:outline-none dark:border-gray-600"
                />
              </div>
            )}
          </>
        )}

        {phase === "confirm" && preview && (
          <div className="space-y-4">
            <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
              Detected a <strong>{preview.provider === "garmin" ? "Garmin" : "Strava"}</strong>{" "}
              export
              {preview.athlete_name ? (
                <>
                  {" "}
                  for <strong>{preview.athlete_name}</strong>
                </>
              ) : null}{" "}
              with <strong>{preview.activity_count}</strong> activities.
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Import these activities as</legend>

              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                <input
                  type="radio"
                  name="merge-choice"
                  className="mt-0.5"
                  checked={mergeChoice === "new"}
                  onChange={() => setMergeChoice("new")}
                />
                <span>
                  <span className="font-medium">A separate athlete</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {preview.is_existing_athlete
                      ? "Updates the existing import for this account."
                      : "Keeps this export's own profile, on its own."}
                  </span>
                </span>
              </label>

              {mergeTargets.length > 0 && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                  <input
                    type="radio"
                    name="merge-choice"
                    className="mt-0.5"
                    checked={mergeChoice === "merge"}
                    onChange={() => {
                      setMergeChoice("merge")
                      if (!targetAthleteId) {
                        setTargetAthleteId(mergeTargets[0].athlete_id)
                      }
                    }}
                  />
                  <span className="flex-1">
                    <span className="font-medium">Merge into</span>
                    <select
                      value={targetAthleteId}
                      onChange={(event) => setTargetAthleteId(event.target.value)}
                      onClick={() => setMergeChoice("merge")}
                      className="mt-1 block w-full rounded-lg border border-gray-300 bg-surface px-2 py-1.5 text-sm text-foreground focus:border-brand focus:outline-none dark:border-gray-600"
                    >
                      {mergeTargets.map((a) => (
                        <option key={a.athlete_id} value={a.athlete_id}>
                          {a.name || `Athlete ${a.athlete_id}`}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                      Combines both services under one athlete; workouts you recorded on both are
                      matched and not duplicated.
                    </span>
                  </span>
                </label>
              )}
            </fieldset>

            {preview.suggested_athlete_name && mergeChoice === "merge" && (
              <p className="rounded-lg bg-brand/5 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                Suggested merge into <strong>{preview.suggested_athlete_name}</strong> (matching
                name). Choose &ldquo;a separate athlete&rdquo; if this is a different person.
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        {running && (
          <div className="mt-1">
            <div className="mb-2 flex items-center justify-between text-sm font-medium">
              <span>Importing your activities…</span>
              {percent !== null && <span className="text-gray-500">{percent}%</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full bg-brand transition-all duration-500"
                style={{ width: `${percent ?? 8}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {status && status.total
                ? `${status.processed} of ${status.total} activities · ${status.files_parsed} files parsed`
                : "Reading your export…"}
            </p>
            <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
              Large Garmin exports take a little while. You can close this and keep using FitMe -
              the import continues in the background and your activities appear gradually.
            </p>
          </div>
        )}

        {done && status && (
          <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300">
            Import complete - added <strong>{status.added}</strong>, updated{" "}
            <strong>{status.updated}</strong>, skipped <strong>{status.skipped}</strong>
            {status.deduped > 0 && (
              <>
                , de-duplicated <strong>{status.deduped}</strong>
              </>
            )}
            .
          </div>
        )}

        {failed && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
            {status?.message || "Import failed."}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          {phase === "confirm" ? (
            <button
              onClick={() => {
                setPhase("select")
                setPreview(null)
                setError(null)
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              Back
            </button>
          ) : (
            <button
              onClick={handleClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              {phase === "importing" ? "Close" : "Cancel"}
            </button>
          )}

          {phase === "select" && (
            <button
              onClick={continueToPreview}
              disabled={!canContinue || busy}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              {busy ? "Reading…" : "Continue"}
            </button>
          )}

          {phase === "confirm" && (
            <button
              onClick={runImport}
              disabled={busy || (mergeChoice === "merge" && !targetAthleteId)}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              {busy ? "Starting…" : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function tabClass(active: boolean): string {
  return active
    ? "flex-1 rounded-md bg-surface px-3 py-1.5 font-medium shadow-sm"
    : "flex-1 rounded-md px-3 py-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
}
