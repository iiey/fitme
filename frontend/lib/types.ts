// Shared API response types, mirroring the FastAPI Pydantic schemas.

export interface AthleteListItem {
  athlete_id: string
  name: string | null
  location: string | null
  activity_count: number
  profile_url: string | null
}

export interface Meta {
  app_name: string
  app_subtitle: string
  unit_system: "metric" | "imperial"
  distance_unit: string
  elevation_unit: string
  sport_types: SportTypeOption[]
  activity_count: number
  first_activity: string | null
  last_activity: string | null
  athlete: AthleteInfo | null
  athletes: AthleteListItem[]
}

export interface AthleteInfo {
  athlete_id: string | null
  name: string | null
  location: string | null
  profile_url: string | null
}

export interface ImportRunStatus {
  id: number
  status: string // running | ok | error
  source: string | null
  added: number
  updated: number
  skipped: number
  deduped: number
  gear_upserted: number
  files_parsed: number
  parse_errors: number
  total: number | null
  processed: number
  finished_at: string | null
  message: string | null
}

export interface ImportPreview {
  source: string
  provider: string // strava | garmin
  athlete_name: string | null
  source_athlete_id: string | null
  activity_count: number
  is_existing_athlete: boolean
  suggested_athlete_id: string | null
  suggested_athlete_name: string | null
}

export interface SyncConfig {
  provider: string
  athlete_id: string
  athlete_name: string | null
  icu_athlete_id: string
  enabled: boolean
  has_api_key: boolean
  synced_through: string | null
  last_run_at: string | null
  last_status: string | null
  last_message: string | null
}

export interface SyncStatus {
  configured: boolean
  enabled: boolean
  running: boolean
  synced_through: string | null
  last_run_at: string | null
  last_status: string | null
  last_message: string | null
}

export interface SyncRunResult {
  status: string // ok | error
  listed: number
  added: number
  updated: number
  skipped: number
  deduped: number
  enriched: number
  message: string | null
}

export interface SportTypeOption {
  value: string
  label: string
  activity_type: string
}

export interface ActivitySummary {
  activity_id: string
  name: string
  start_date_time: string
  sport_type: string
  sport_label: string
  activity_type: string
  distance_km: number
  distance_mi: number
  elevation_m: number
  moving_time_s: number
  elapsed_time_s: number
  average_speed_kmh: number | null
  average_pace_s_per_km: number | null
  pace_unit: string
  /** Whether distance is a meaningful primary metric (mirrors backend SportType). */
  is_distance_based: boolean
  average_heart_rate: number | null
  max_heart_rate: number | null
  average_power: number | null
  calories: number | null
  is_commute: boolean
  gear_name: string | null
  has_map: boolean
}

export interface BestEffortItem {
  distance_m: number
  label: string
  time_s: number
}

export interface HrZoneItem {
  zone: number
  label: string
  lower_bpm: number
  upper_bpm: number | null
  seconds: number
  percentage: number
}

export interface PaceZoneItem {
  zone: number
  label: string
  slow_pace: number | null
  fast_pace: number | null
  seconds: number
  percentage: number
}

export interface HrCurvePoint {
  duration_s: number
  bpm: number
}

export interface ActivityDetail extends ActivitySummary {
  description: string | null
  user_note: string | null
  max_speed_kmh: number | null
  average_cadence: number | null
  max_cadence: number | null
  max_power: number | null
  normalized_power: number | null
  device_name: string | null
  polyline: string | null
  start_latitude: number | null
  start_longitude: number | null
  streams: Record<string, (number | null)[]>
  best_efforts: BestEffortItem[]
  hr_zones: HrZoneItem[] | null
  pace_zones: PaceZoneItem[] | null
  hr_curve: HrCurvePoint[] | null
}

export interface PaginatedActivities {
  total: number
  limit: number
  offset: number
  items: ActivitySummary[]
}

export interface Totals {
  count: number
  distance: number
  elevation: number
  moving_time_s: number
  calories: number
}

export interface PeriodTotals extends Totals {
  period: string
}

export interface LabeledTotals extends Totals {
  label: string
  average_heart_rate?: number | null
}

export interface Dashboard {
  empty: boolean
  filtered_empty?: boolean
  available_years?: number[]
  unit_system: string
  totals: Totals
  recent_activities: ActivitySummary[]
  weekly_stats: PeriodTotals[]
  monthly_stats: PeriodTotals[]
  yearly_stats: PeriodTotals[]
  activity_calendar: CalendarPoint[]
  streaks: { current: number; longest: number; current_start: string | null }
  eddington: EddingtonSummary[]
  weekday_stats: LabeledTotals[]
  daytime_stats: LabeledTotals[]
  distance_breakdown: LabeledTotals[]
  hr_zones: { zones: number[]; window_days: number } | null
  peak_power: {
    durations: number[]
    outputs: { duration_s: number; watts: number | null }[]
    window_days: number
  } | null
  training_load: { date: string; load: number }[]
  training_load_analysis: TrainingLoadAnalysis | null
  vo2max_trend: { date: string; vo2max: number }[]
  recent_milestones: Milestone[]
  gear_stats: GearItem[]
}

export interface TrainingLoadActivity extends ActivitySummary {
  load: number
  intensity: number
}

export interface TrainingLoadPoint {
  date: string
  load: number
  ctl: number
  atl: number
  tsb: number
  activities?: TrainingLoadActivity[]
}

export interface TrainingLoadAnalysis {
  ctl: number
  atl: number
  tsb: number
  tsb_status: string
  tsb_color: string
  ac_ratio: number
  ac_status: string
  ac_color: string
  rest_days: number
  monotony: number
  strain: number
  weekly_trimp: number
  series: TrainingLoadPoint[]
  display_days: number
}

export interface CalendarPoint {
  date: string
  count: number
  distance: number
  moving_time_s: number
  training_load: number
}

export interface EddingtonSummary {
  activity_type: string
  number: number
  longest_day: number
  next: number
  days_to_next: number | null
}

export interface GearItem {
  gear_id: string
  name: string
  gear_type: string
  distance_km: number
  is_retired: boolean
}

export interface EddingtonResult {
  activity_type: string
  number: number
  unit: string
  longest_day: number
  times_completed: { distance: number; count: number }[]
  days_to_next: { distance: number; days_needed: number }[]
  history: { number: number; date: string }[]
}

export interface EddingtonResponse {
  unit: string
  unit_system: string
  results: EddingtonResult[]
}

export interface MonthResponse {
  year: number
  month: number
  month_name: string
  first_weekday: number
  days_in_month: number
  unit_system: string
  totals: { count: number; distance: number; elevation: number; moving_time_s: number }
  per_sport: {
    sport_type: string
    label: string
    count: number
    distance: number
    moving_time_s: number
  }[]
  days: MonthDay[]
  activities: CalendarActivity[]
}

export interface CalendarActivity extends ActivitySummary {
  load: number
}

export interface MonthDay {
  date: string
  day: number
  weekday: number
  count: number
  distance: number
  moving_time_s: number
  elevation: number
  calories: number
  sport_types: string[]
}

export interface HeatmapRoute {
  activity_id: string
  name: string
  sport_type: string
  activity_type: string
  polyline: string
  start_date: string
}

export interface HeatmapResponse {
  count: number
  country_count: number
  routes: HeatmapRoute[]
}

export interface Milestone {
  achieved_on: string
  group: string
  title: string
  description: string
  icon: string
  sport_type: string | null
  activity_id: string | null
  fun_comparison: string | null
}

export interface MilestonesResponse {
  groups: string[]
  total: number
  timeline: { year: number; milestones: Milestone[] }[]
}

export interface RewindResponse {
  available_years: number[]
  selected_year: number | null
  rewind: Rewind
}

export interface Rewind {
  year: number | null
  unit: string
  summary: { count: number; distance: number; elevation_m: number; moving_time_s: number }
  totals_per_month: { month: string; distance: number; count: number; moving_time_s: number }[]
  per_sport: { sport_type: string; label: string; moving_time_s: number; distance: number }[]
  achievements: {
    highlights: {
      label: string
      icon: string
      value: number
      unit: string
      activity_id: string
      name: string
      date: string
    }[]
    personal_records: {
      distance_m: number
      label: string
      time_s: number
      activity_id: string
      date: string
    }[]
  }
  start_times: number[]
  locations: { lat: number; lng: number; sport_type: string }[]
  biggest_activity: {
    activity_id: string
    name: string
    date: string
    distance: number
    elevation_m: number
    moving_time_s: number
    polyline: string | null
  } | null
  calories: { total: number; pizza_slices: number; bananas: number }
  carbon_saved: { co2_kg: number; google_searches: number; plastic_bottles: number }
  active_vs_rest: { active_days: number; rest_days: number; total_days: number }
  longest_streak: { length: number; start: string; end: string } | null
}

// -- Goals ------------------------------------------------------------------

export interface GoalResponse {
  id: number
  athlete_id: string
  start_date: string
  end_date: string
  /** Sports the goal counts toward; an empty array means "all sports". */
  sport_types: string[]
  metric: string
  target_value: number
  note: string | null
  created_on: string
  updated_on: string
}

export interface GoalProgressResponse extends GoalResponse {
  current_value: number
  percentage: number
}

export interface GoalCreate {
  start_date: string
  end_date: string
  /** Sports the goal counts toward; an empty array means "all sports". */
  sport_types: string[]
  metric: string
  target_value: number
  note?: string | null
}

// -- Athlete config ---------------------------------------------------------

export interface AthleteConfig {
  birthday: string | null
  weight_kg: number | null
  ftp: number | null
  max_heart_rate: number | null
  resting_heart_rate: number | null
  unit_system: string
  threshold_pace: number | null
  heart_rate_zones: number[] | null
  power_zones: number[] | null
  pace_zones: number[] | null
}
