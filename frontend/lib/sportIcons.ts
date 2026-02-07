import {
  Activity,
  Bike,
  createLucideIcon,
  Dumbbell,
  Footprints,
  type LucideIcon,
  Mountain,
  PersonStanding,
  Sailboat,
  Snowflake,
  Volleyball,
  Waves,
} from "lucide-react"

// lucide-react has no running-figure icon, only static people (PersonStanding,
// Accessibility). Define a stroke-style running person so it matches the outline
// aesthetic of the other icons. Path geometry from Tabler Icons "run" (MIT).
const PersonRunning: LucideIcon = createLucideIcon("person-running", [
  ["circle", { cx: "13", cy: "4", r: "1", key: "run-head" }],
  ["path", { d: "M4 17l5 1l.75 -1.5", key: "run-back-leg" }],
  ["path", { d: "M15 21l0 -4l-4 -3l1 -6", key: "run-body" }],
  ["path", { d: "M7 12l0 -3l5 -1l3 3l3 1", key: "run-arms" }],
])

// Icon per broad activity type. Keys mirror ACTIVITY_TYPE_COLORS in lib/format.ts
// so an activity's icon and colour stay in sync.
const ACTIVITY_TYPE_ICONS: Record<string, LucideIcon> = {
  Ride: Bike,
  Run: PersonRunning,
  Walk: Footprints,
  WaterSports: Waves,
  WinterSports: Snowflake,
  Skating: Footprints,
  RacquetPaddleSports: Volleyball,
  Fitness: Dumbbell,
  MindBodySports: PersonStanding,
  OutdoorSports: Mountain,
  TeamSports: Volleyball,
  AdaptiveInclusiveSports: Activity,
  Other: Activity,
}

export function iconForActivityType(activityType: string): LucideIcon {
  return ACTIVITY_TYPE_ICONS[activityType] ?? ACTIVITY_TYPE_ICONS.Other
}

// More specific Strava-style sport types that deserve a distinct icon from their
// broad activity-type fallback. Keys use the same identifiers as SPORT_TYPE_COLORS.
const SPORT_TYPE_ICONS: Record<string, LucideIcon> = {
  Ride: Bike,
  GravelRide: Bike,
  MountainBikeRide: Bike,
  EBikeRide: Bike,
  VirtualRide: Bike,
  Run: PersonRunning,
  TrailRun: PersonRunning,
  VirtualRun: PersonRunning,
  Walk: Footprints,
  Hike: Mountain,
  Swim: Waves,
  Surfing: Waves,
  Kayaking: Sailboat,
  Canoeing: Sailboat,
  Rowing: Sailboat,
  StandUpPaddling: Sailboat,
  Sail: Sailboat,
  Windsurf: Sailboat,
  WeightTraining: Dumbbell,
  Workout: Dumbbell,
  Crossfit: Dumbbell,
  Elliptical: Dumbbell,
  StairStepper: Dumbbell,
  Yoga: PersonStanding,
  Pilates: PersonStanding,
  AlpineSki: Snowflake,
  BackcountrySki: Snowflake,
  NordicSki: Snowflake,
  Snowboard: Snowflake,
  Snowshoe: Snowflake,
  IceSkate: Snowflake,
  RockClimbing: Mountain,
}

export function iconForSportType(sportType: string, activityType?: string): LucideIcon {
  return (
    SPORT_TYPE_ICONS[sportType] ??
    (activityType ? iconForActivityType(activityType) : ACTIVITY_TYPE_ICONS.Other)
  )
}
