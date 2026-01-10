import useSWR from "swr";

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

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
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

export function useMeta() {
  return useSWR<Meta>("/api/meta", fetcher);
}

export interface DashboardFilters {
  sport_type?: string[];
  start?: string;
  end?: string;
}

export function useDashboard(filters: DashboardFilters = {}) {
  const query = buildQuery(filters as Record<string, unknown>);
  return useSWR<Dashboard>(`/api/dashboard${query}`, fetcher, {
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
}

export function useActivities(filters: ActivityFilters) {
  const query = buildQuery(filters as Record<string, unknown>);
  return useSWR<PaginatedActivities>(`/api/activities${query}`, fetcher, {
    keepPreviousData: true,
  });
}

export function useActivity(activityId: string | null) {
  return useSWR<ActivityDetail>(
    activityId ? `/api/activities/${activityId}` : null,
    fetcher,
  );
}

export function useEddington(unit?: string) {
  const query = buildQuery({ unit });
  return useSWR<EddingtonResponse>(`/api/eddington${query}`, fetcher);
}

export function useMonth(year: number, month: number) {
  return useSWR<MonthResponse>(`/api/calendar/${year}/${month}`, fetcher);
}

export function useHeatmap(filters: { sport_type?: string[]; commute?: boolean }) {
  const query = buildQuery(filters as Record<string, unknown>);
  return useSWR<HeatmapResponse>(`/api/heatmap/routes${query}`, fetcher);
}

export function useMilestones() {
  return useSWR<MilestonesResponse>("/api/milestones", fetcher);
}

export function useRewind(year: number | null, days: number | null = null) {
  const query = buildQuery({ year: year ?? undefined, days: days ?? undefined });
  return useSWR<RewindResponse>(`/api/rewind${query}`, fetcher);
}

export async function uploadExport(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/import/upload", { method: "POST", body: form });
  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, detail || "Upload failed");
  }
  return response.json() as Promise<ImportResult>;
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
  return response.json() as Promise<ImportResult>;
}
