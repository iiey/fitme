// Sport-oriented presentation profiles for the activity detail page.
//
// Each profile declares, per broad activity type, which top stat tiles and which
// detail sections are *appropriate* for that kind of sport. The detail page then
// renders a tile/section only when the profile allows it AND the data is present
// (the second gate is owned by each section component). This stops, e.g., a yoga
// session from showing a speed chart or a Distance/Pace/Elevation header.  // // The activity-type keys mirror ACTIVITY_TYPE_COLORS in lib/format.ts and the // backend `ActivityType` enum (backend/app/enums.py) - keep them in sync. The // `is_distance_based` flag used by the fallback is the authoritative backend // signal (SportType.is_distance_based), surfaced on the activity payload.
/** A detail-page section. Order within a profile's `sections` is the render order. */
export type ActivitySection =
  | "map"
  | "hrCurve"
  | "heartRate"
  | "hrZones"
  | "pace"
  | "paceZones"
  | "elevation"
  | "power"
  | "cadence"
  | "bestEfforts"
  | "details"

/** A tile in the primary stat grid at the top of the page. */
export type PrimaryStatKey =
  | "distance"
  | "movingTime"
  | "paceSpeed"
  | "elevation"
  | "avgHr"
  | "calories"
  | "power"

export interface ActivityProfile {
  /** Ordered top tiles; the first tile that has a value is accented. */
  primaryStats: PrimaryStatKey[]
  /** Ordered allow-list of sections; render = listed AND data present. */
  sections: ActivitySection[]
}

const DISTANCE_PRIMARY: PrimaryStatKey[] = ["distance", "movingTime", "paceSpeed", "elevation"]
const DURATION_PRIMARY: PrimaryStatKey[] = ["movingTime", "avgHr", "calories"]

// Full endurance section set; sports prune from this. Pairs the renderer groups
// into two-column rows (heartRate+hrZones, pace+paceZones, elevation+power) are
// kept adjacent so that layout can be derived from order alone.
const ENDURANCE_SECTIONS: ActivitySection[] = [
  "map",
  "hrCurve",
  "heartRate",
  "hrZones",
  "pace",
  "paceZones",
  "elevation",
  "power",
  "cadence",
  "bestEfforts",
  "details",
]

export const ACTIVITY_PROFILES: Record<string, ActivityProfile> = {
  Run: {
    primaryStats: DISTANCE_PRIMARY,
    sections: ENDURANCE_SECTIONS,
  },
  Ride: {
    primaryStats: DISTANCE_PRIMARY,
    // No pace zones for rides (run-threshold model); power is the intensity metric.
    sections: [
      "map",
      "hrCurve",
      "heartRate",
      "hrZones",
      "pace",
      "elevation",
      "power",
      "cadence",
      "bestEfforts",
      "details",
    ],
  },
  Walk: {
    primaryStats: DISTANCE_PRIMARY,
    sections: ["map", "heartRate", "hrZones", "pace", "elevation", "cadence", "details"],
  },
  WaterSports: {
    // Non-swim water sports (kayak/row/SUP/surf): GPS speed in km/h, flat water.
    primaryStats: ["distance", "movingTime", "paceSpeed"],
    sections: ["map", "heartRate", "hrZones", "pace", "cadence", "details"],
  },
  WinterSports: {
    primaryStats: DISTANCE_PRIMARY,
    sections: ["map", "heartRate", "hrZones", "pace", "elevation", "cadence", "details"],
  },
  Skating: {
    primaryStats: DISTANCE_PRIMARY,
    sections: ["map", "heartRate", "hrZones", "pace", "elevation", "cadence", "details"],
  },
  RacquetPaddleSports: {
    primaryStats: DURATION_PRIMARY,
    sections: ["hrCurve", "heartRate", "hrZones", "details"],
  },
  Fitness: {
    // Strength / crossfit / HIIT / elliptical / rower: effort is HR (and power on
    // indoor bikes/rowers); no distance, pace, elevation or GPS.
    primaryStats: ["movingTime", "avgHr", "calories", "power"],
    sections: ["hrCurve", "heartRate", "hrZones", "power", "cadence", "details"],
  },
  MindBodySports: {
    // Yoga / pilates / physical therapy: duration and HR only.
    primaryStats: DURATION_PRIMARY,
    sections: ["heartRate", "hrZones", "details"],
  },
  OutdoorSports: {
    // Golf / climbing / sail: outdoor, may have a GPS track and elevation.
    primaryStats: DURATION_PRIMARY,
    sections: ["map", "heartRate", "hrZones", "elevation", "details"],
  },
  TeamSports: {
    primaryStats: DURATION_PRIMARY,
    sections: ["hrCurve", "heartRate", "hrZones", "details"],
  },
  AdaptiveInclusiveSports: {
    primaryStats: DURATION_PRIMARY,
    sections: ["map", "heartRate", "hrZones", "cadence", "details"],
  },
  Other: {
    primaryStats: DURATION_PRIMARY,
    sections: ["map", "heartRate", "hrZones", "elevation", "cadence", "details"],
  },
}

// Swim is `WaterSports` by activity type but distance-based with a /100m pace and
// no GPS/elevation - it needs its own profile, resolved ahead of the registry.
const SWIM_PROFILE: ActivityProfile = {
  primaryStats: ["distance", "movingTime", "paceSpeed"],
  sections: ["heartRate", "hrZones", "pace", "cadence", "details"],
}

// Fallback for an activity type not in the registry (e.g. a sport added to the
// backend later). Driven by the authoritative `is_distance_based` flag so a new
// distance sport still gets a sensible distance-oriented layout.
const UNKNOWN_DISTANCE_PROFILE: ActivityProfile = {
  primaryStats: DISTANCE_PRIMARY,
  sections: ["map", "heartRate", "hrZones", "pace", "elevation", "cadence", "details"],
}
const UNKNOWN_DURATION_PROFILE: ActivityProfile = ACTIVITY_PROFILES.Other

export function resolveActivityProfile(activity: {
  activity_type: string
  sport_type: string
  pace_unit: string
  is_distance_based: boolean
}): ActivityProfile {
  if (activity.sport_type === "Swim" || activity.pace_unit === "/100m") return SWIM_PROFILE
  return (
    ACTIVITY_PROFILES[activity.activity_type] ??
    (activity.is_distance_based ? UNKNOWN_DISTANCE_PROFILE : UNKNOWN_DURATION_PROFILE)
  )
}
