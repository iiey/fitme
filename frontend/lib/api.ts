import useSWR, { mutate, type SWRConfiguration } from "swr"
import type { ZodType } from "zod"
import {
  ActivityDetailSchema,
  AthleteConfigSchema,
  DashboardSchema,
  GoalProgressResponseSchema,
  ImportPreviewSchema,
  ImportRunStatusSchema,
  MetaSchema,
  PaginatedActivitiesSchema,
  SyncConfigSchema,
  SyncRunResultSchema,
  SyncStatusSchema,
} from "./schemas"
import type {
  ActivityDetail,
  AthleteConfig,
  Dashboard,
  EddingtonResponse,
  GoalCreate,
  GoalProgressResponse,
  HeatmapResponse,
  ImportPreview,
  ImportRunStatus,
  Meta,
  MilestonesResponse,
  MonthResponse,
  PaginatedActivities,
  RewindResponse,
  SyncConfig,
  SyncRunResult,
  SyncStatus,
} from "./types"

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/**
 * Extract a human-readable message from an error response. FastAPI returns
 * ``{"detail": "..."}``; we surface that ``detail`` rather than the raw JSON
 * envelope, falling back to the body text or a default message.
 */
async function readErrorDetail(response: Response, fallback: string): Promise<string> {
  const body = await response.text()
  if (!body) return fallback
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed.detail === "string") return parsed.detail
  } catch {
    // Body is not JSON - fall through to returning it verbatim.
  }
  return body
}

function validated<T>(schema: ZodType) {
  return async (url: string): Promise<T> => {
    const response = await fetch(url)
    if (!response.ok) {
      throw new ApiError(response.status, `Request failed: ${response.status}`)
    }
    const json = await response.json()
    return schema.parse(json) as T
  }
}

export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        search.append(key, String(entry))
      })
    } else {
      search.append(key, String(value))
    }
  }
  const query = search.toString()
  return query ? `?${query}` : ""
}

const RETRY_INTERVAL_MS = 2000

/**
 * Whether a failed request is worth retrying. A backend that is still starting
 * up (or briefly unreachable) surfaces as a network ``TypeError`` with no status
 * or as a 5xx from the proxy - both are transient. A 4xx means the request
 * itself is wrong, so retrying would just loop forever.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500
  return true
}

/**
 * SWR options that keep retrying transient failures at a steady interval so the
 * UI recovers on its own once the backend finishes starting up, instead of
 * giving up after a few attempts and getting stuck on an error screen. Retrying
 * is paused while the tab is hidden; SWR revalidates again on focus.
 */
const resilientConfig: SWRConfiguration = {
  keepPreviousData: true,
  onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
    if (!isTransientError(error)) return
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    setTimeout(() => revalidate({ retryCount }), RETRY_INTERVAL_MS)
  },
}

export function useMeta(athleteId: string | null) {
  const query = buildQuery({ athlete: athleteId ?? undefined })
  return useSWR<Meta>(`/api/meta${query}`, validated(MetaSchema), resilientConfig)
}

export interface DashboardFilters {
  sport_type?: string[]
  start?: string
  end?: string
  hr_window?: number
  power_window?: number
}

export function useDashboard(athleteId: string | null, filters: DashboardFilters = {}) {
  const query = buildQuery({
    athlete: athleteId ?? undefined,
    ...(filters as Record<string, unknown>),
  })
  return useSWR<Dashboard>(`/api/dashboard${query}`, validated(DashboardSchema), resilientConfig)
}

export interface ActivityFilters {
  sport_type?: string[]
  activity_type?: string[]
  search?: string
  sort?: string
  order?: "asc" | "desc"
  limit?: number
  offset?: number
  start?: string
  end?: string
  distance_min?: number
  distance_max?: number
}

export function useActivities(athleteId: string | null, filters: ActivityFilters) {
  const query = buildQuery({
    athlete: athleteId ?? undefined,
    ...(filters as Record<string, unknown>),
  })
  return useSWR<PaginatedActivities>(
    `/api/activities${query}`,
    validated(PaginatedActivitiesSchema),
    {
      keepPreviousData: true,
    },
  )
}

export function useActivity(athleteId: string | null, activityId: string | null) {
  const query = buildQuery({ athlete: athleteId ?? undefined })
  return useSWR<ActivityDetail>(
    activityId ? `/api/activities/${activityId}${query}` : null,
    validated(ActivityDetailSchema),
  )
}

export function useEddington(athleteId: string | null, unit?: string) {
  const query = buildQuery({ athlete: athleteId ?? undefined, unit })
  return useSWR<EddingtonResponse>(`/api/eddington${query}`, fetcher)
}

export function useMonth(athleteId: string | null, year: number, month: number) {
  const query = buildQuery({ athlete: athleteId ?? undefined })
  return useSWR<MonthResponse>(`/api/calendar/${year}/${month}${query}`, fetcher)
}

export function useHeatmap(
  athleteId: string | null,
  filters: { sport_type?: string[]; commute?: boolean },
) {
  const query = buildQuery({
    athlete: athleteId ?? undefined,
    ...(filters as Record<string, unknown>),
  })
  return useSWR<HeatmapResponse>(`/api/heatmap/routes${query}`, fetcher)
}

export function useMilestones(athleteId: string | null) {
  const query = buildQuery({ athlete: athleteId ?? undefined })
  return useSWR<MilestonesResponse>(`/api/milestones${query}`, fetcher)
}

export function useRewind(
  athleteId: string | null,
  year: number | null,
  days: number | null = null,
  sportType?: string[],
) {
  const query = buildQuery({
    athlete: athleteId ?? undefined,
    year: year ?? undefined,
    days: days ?? undefined,
    sport_type: sportType,
  })
  return useSWR<RewindResponse>(`/api/rewind${query}`, fetcher)
}

export async function deleteAthlete(athleteId: string): Promise<void> {
  const response = await fetch(`/api/athletes/${athleteId}`, { method: "DELETE" })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response, "Delete failed"))
  }
}

export async function previewImport(input: {
  file?: File
  source?: string
}): Promise<ImportPreview> {
  const form = new FormData()
  if (input.file) form.append("file", input.file)
  if (input.source) form.append("source", input.source)
  const response = await fetch("/api/import/preview", { method: "POST", body: form })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response, "Preview failed"))
  }
  return ImportPreviewSchema.parse(await response.json())
}

export async function startImport(
  source: string,
  athleteId?: string | null,
): Promise<ImportRunStatus> {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, athlete_id: athleteId ?? null }),
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response, "Import failed"))
  }
  return ImportRunStatusSchema.parse(await response.json())
}

export async function getImportRun(id: number): Promise<ImportRunStatus> {
  const response = await fetch(`/api/import/runs/${id}`)
  if (!response.ok) {
    throw new ApiError(
      response.status,
      await readErrorDetail(response, "Failed to fetch import status"),
    )
  }
  return ImportRunStatusSchema.parse(await response.json())
}

export function revalidateAll() {
  mutate(() => true)
}

// -- Intervals.icu sync -----------------------------------------------------

/** Fetch the sync config, tolerating a ``null`` body when none is configured. */
async function fetchSyncConfig(url: string): Promise<SyncConfig | null> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status}`)
  }
  const text = await response.text()
  if (!text || text === "null") return null
  return SyncConfigSchema.parse(JSON.parse(text))
}

export function useSyncConfig() {
  return useSWR<SyncConfig | null>("/api/sync/config", fetchSyncConfig)
}

export function useSyncStatus(poll: boolean) {
  return useSWR<SyncStatus>("/api/sync/status", validated(SyncStatusSchema), {
    refreshInterval: poll ? 2000 : 0,
  })
}

export interface SyncConfigInput {
  athlete_id: string
  api_key: string
  icu_athlete_id?: string
  enabled?: boolean
}

export async function saveSyncConfig(input: SyncConfigInput): Promise<SyncConfig> {
  const response = await fetch("/api/sync/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new ApiError(
      response.status,
      await readErrorDetail(response, "Could not save sync settings"),
    )
  }
  return SyncConfigSchema.parse(await response.json())
}

export async function deleteSyncConfig(): Promise<void> {
  const response = await fetch("/api/sync/config", { method: "DELETE" })
  if (!response.ok) {
    throw new ApiError(
      response.status,
      await readErrorDetail(response, "Could not remove sync settings"),
    )
  }
}

/** A bounded full-resync window. `newest` omitted means "up to now". */
export interface ResyncWindow {
  oldest: string // YYYY-MM-DD
  newest?: string // YYYY-MM-DD
}

export async function triggerSync(
  fullResync = false,
  resyncWindow?: ResyncWindow,
): Promise<SyncRunResult> {
  const body: Record<string, unknown> = { full_resync: fullResync }
  if (resyncWindow) {
    body.oldest = resyncWindow.oldest
    if (resyncWindow.newest) body.newest = resyncWindow.newest
  }
  const response = await fetch("/api/sync/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response, "Could not start sync"))
  }
  return SyncRunResultSchema.parse(await response.json())
}

// -- Activity notes ---------------------------------------------------------

export async function updateActivityNote(
  athleteId: string,
  activityId: string,
  note: string | null,
): Promise<void> {
  const query = buildQuery({ athlete: athleteId })
  const response = await fetch(`/api/activities/${activityId}/note${query}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response, "Could not save note"))
  }
}

export async function deleteActivities(athleteId: string, activityIds: string[]): Promise<number> {
  const query = buildQuery({ athlete: athleteId })
  const response = await fetch(`/api/activities${query}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activity_ids: activityIds }),
  })
  if (!response.ok) {
    throw new ApiError(
      response.status,
      await readErrorDetail(response, "Could not delete activities"),
    )
  }
  const result = (await response.json()) as { deleted: number }
  return result.deleted
}

// -- Goals ------------------------------------------------------------------

export function useGoalsProgress(athleteId: string | null, activeOn?: string) {
  const query = buildQuery({ athlete: athleteId ?? undefined, active_on: activeOn })
  return useSWR<GoalProgressResponse[]>(
    `/api/goals/progress${query}`,
    validated(GoalProgressResponseSchema.array()),
  )
}

export async function createGoal(athleteId: string, goal: GoalCreate): Promise<void> {
  const query = buildQuery({ athlete: athleteId })
  const response = await fetch(`/api/goals${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(goal),
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response, "Could not create goal"))
  }
}

export async function updateGoal(
  athleteId: string,
  goalId: number,
  updates: Partial<GoalCreate>,
): Promise<void> {
  const query = buildQuery({ athlete: athleteId })
  const response = await fetch(`/api/goals/${goalId}${query}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response, "Could not update goal"))
  }
}

export async function deleteGoal(athleteId: string, goalId: number): Promise<void> {
  const query = buildQuery({ athlete: athleteId })
  const response = await fetch(`/api/goals/${goalId}${query}`, { method: "DELETE" })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response, "Could not delete goal"))
  }
}

// -- Athlete config ---------------------------------------------------------

export function useAthleteConfig(athleteId: string | null) {
  const query = buildQuery({ athlete: athleteId ?? undefined })
  return useSWR<AthleteConfig>(
    athleteId ? `/api/athletes/config${query}` : null,
    validated(AthleteConfigSchema),
  )
}

export async function updateAthleteConfig(
  athleteId: string,
  config: Partial<AthleteConfig>,
): Promise<AthleteConfig> {
  const query = buildQuery({ athlete: athleteId })
  const response = await fetch(`/api/athletes/config${query}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response, "Could not save config"))
  }
  return AthleteConfigSchema.parse(await response.json())
}
