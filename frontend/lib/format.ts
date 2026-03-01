import { format, parseISO } from "date-fns"

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "-"
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`
}

export function formatHours(seconds: number | null | undefined): string {
  if (!seconds) return "0h"
  const hours = seconds / 3600
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`
}

export const KM_PER_MILE = 1.609344

export function formatPace(secondsPerKm: number | null | undefined, unit: string): string {
  if (!secondsPerKm || secondsPerKm <= 0) return "-"
  const minutes = Math.floor(secondsPerKm / 60)
  const seconds = Math.round(secondsPerKm % 60)
  return `${minutes}:${String(seconds).padStart(2, "0")} ${unit}`
}

/** Format a km/h speed as km/h (metric) or mph (imperial). */
export function formatSpeed(kmh: number | null | undefined, distanceUnit: string): string {
  if (!kmh) return "-"
  return distanceUnit === "mi" ? `${(kmh / KM_PER_MILE).toFixed(1)} mph` : `${kmh.toFixed(1)} km/h`
}

/**
 * Format an activity's pace/speed for display, respecting both its sport
 * preference and the unit system: running/walking show min/km (or min/mi),
 * swimming min/100m (pools stay metric), everything else km/h (or mph).
 */
export function formatActivityPace(
  activity: {
    pace_unit: string
    average_pace_s_per_km: number | null
    average_speed_kmh: number | null
  },
  distanceUnit: string = "km",
): string {
  if (activity.pace_unit === "km/h") {
    return formatSpeed(activity.average_speed_kmh, distanceUnit)
  }
  if (activity.pace_unit === "/100m") {
    // Convert per-km pace to per-100m; pool distances stay metric.
    return formatPace((activity.average_pace_s_per_km ?? 0) / 10, "/100m")
  }
  if (distanceUnit === "mi") {
    const perKm = activity.average_pace_s_per_km
    return formatPace(perKm == null ? null : perKm * KM_PER_MILE, "/mi")
  }
  return formatPace(activity.average_pace_s_per_km, "/km")
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "-"
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatDate(iso: string, pattern = "yyyy-MM-dd"): string {
  try {
    return format(parseISO(iso), pattern)
  } catch {
    return iso
  }
}

export function formatDateTime(iso: string): string {
  return formatDate(iso, "yyyy-MM-dd HH:mm")
}

// Distinct, stable colours per broad activity type for charts and maps.
const ACTIVITY_TYPE_COLORS: Record<string, string> = {
  Ride: "#f59e0b",
  Run: "#2563eb",
  Walk: "#16a34a",
  WaterSports: "#0891b2",
  WinterSports: "#7c3aed",
  Skating: "#db2777",
  RacquetPaddleSports: "#ca8a04",
  Fitness: "#dc2626",
  MindBodySports: "#65a30d",
  OutdoorSports: "#0d9488",
  TeamSports: "#9333ea",
  AdaptiveInclusiveSports: "#e11d48",
  Other: "#6b7280",
}

export function colorForActivityType(activityType: string): string {
  return ACTIVITY_TYPE_COLORS[activityType] ?? ACTIVITY_TYPE_COLORS.Other
}

const SPORT_TYPE_COLORS: Record<string, string> = {
  Ride: "#f59e0b",
  Run: "#2563eb",
  Walk: "#16a34a",
  GravelRide: "#d97706",
  MountainBikeRide: "#b45309",
  TrailRun: "#1d4ed8",
}

export function colorForSportType(sportType: string, activityType?: string): string {
  return (
    SPORT_TYPE_COLORS[sportType] ??
    (activityType ? colorForActivityType(activityType) : ACTIVITY_TYPE_COLORS.Other)
  )
}
