import useSWR, { mutate } from "swr";
import type { ZodType } from "zod";

import type {
  ActivityDetail,
  Dashboard,
  EddingtonResponse,
  HeatmapResponse,
  ImportResult,
  Meta,
  MilestonesResponse,
  MonthResponse,
  PaginatedActivities,
  RewindResponse,
} from "./types";
import {
  ActivityDetailSchema,
  DashboardSchema,
  ImportResultSchema,
  MetaSchema,
  PaginatedActivitiesSchema,
} from "./schemas";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function validated<T>(schema: ZodType) {
  return async (url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new ApiError(response.status, `Request failed: ${response.status}`);
    }
    const json = await response.json();
    return schema.parse(json) as T;
  };
}

export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => search.append(key, String(entry)));
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function useMeta(athleteId: string | null) {
  const query = buildQuery({ athlete: athleteId ?? undefined });
  return useSWR<Meta>(`/api/meta${query}`, validated(MetaSchema));
}

export interface DashboardFilters {
  sport_type?: string[];
  start?: string;
  end?: string;
  hr_window?: number;
  power_window?: number;
}

export function useDashboard(athleteId: string | null, filters: DashboardFilters = {}) {
  const query = buildQuery({ athlete: athleteId ?? undefined, ...filters as Record<string, unknown> });
  return useSWR<Dashboard>(`/api/dashboard${query}`, validated(DashboardSchema), {
    keepPreviousData: true,
  });
}

export interface ActivityFilters {
  sport_type?: string[];
  activity_type?: string[];
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
  start?: string;
  end?: string;
  distance_min?: number;
  distance_max?: number;
}

export function useActivities(athleteId: string | null, filters: ActivityFilters) {
  const query = buildQuery({ athlete: athleteId ?? undefined, ...filters as Record<string, unknown> });
  return useSWR<PaginatedActivities>(`/api/activities${query}`, validated(PaginatedActivitiesSchema), {
    keepPreviousData: true,
  });
}

export function useActivity(athleteId: string | null, activityId: string | null) {
  const query = buildQuery({ athlete: athleteId ?? undefined });
  return useSWR<ActivityDetail>(
    activityId ? `/api/activities/${activityId}${query}` : null,
    validated(ActivityDetailSchema),
  );
}

export function useEddington(athleteId: string | null, unit?: string) {
  const query = buildQuery({ athlete: athleteId ?? undefined, unit });
  return useSWR<EddingtonResponse>(`/api/eddington${query}`, fetcher);
}

export function useMonth(athleteId: string | null, year: number, month: number) {
  const query = buildQuery({ athlete: athleteId ?? undefined });
  return useSWR<MonthResponse>(`/api/calendar/${year}/${month}${query}`, fetcher);
}

export function useHeatmap(athleteId: string | null, filters: { sport_type?: string[]; commute?: boolean }) {
  const query = buildQuery({ athlete: athleteId ?? undefined, ...filters as Record<string, unknown> });
  return useSWR<HeatmapResponse>(`/api/heatmap/routes${query}`, fetcher);
}

export function useMilestones(athleteId: string | null) {
  const query = buildQuery({ athlete: athleteId ?? undefined });
  return useSWR<MilestonesResponse>(`/api/milestones${query}`, fetcher);
}

export function useRewind(athleteId: string | null, year: number | null, days: number | null = null) {
  const query = buildQuery({ athlete: athleteId ?? undefined, year: year ?? undefined, days: days ?? undefined });
  return useSWR<RewindResponse>(`/api/rewind${query}`, fetcher);
}

export async function deleteAthlete(athleteId: string): Promise<void> {
  const response = await fetch(`/api/athletes/${athleteId}`, { method: "DELETE" });
  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, detail || "Delete failed");
  }
}

export async function uploadExport(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/import/upload", { method: "POST", body: form });
  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, detail || "Upload failed");
  }
  return ImportResultSchema.parse(await response.json());
}

export async function importFromPath(source: string): Promise<ImportResult> {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, detail || "Import failed");
  }
  return ImportResultSchema.parse(await response.json());
}

export function revalidateAll() {
  mutate(() => true);
}
