import { z } from "zod";

export const AthleteInfoSchema = z.object({
  athlete_id: z.string().nullable(),
  name: z.string().nullable(),
  location: z.string().nullable(),
  profile_url: z.string().nullable(),
});

export const AthleteListItemSchema = z.object({
  athlete_id: z.string(),
  name: z.string().nullable(),
  location: z.string().nullable(),
  activity_count: z.number(),
  profile_url: z.string().nullable(),
});

export const SportTypeOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  activity_type: z.string(),
});

export const MetaSchema = z.object({
  app_name: z.string(),
  app_subtitle: z.string(),
  unit_system: z.enum(["metric", "imperial"]),
  distance_unit: z.string(),
  elevation_unit: z.string(),
  sport_types: z.array(SportTypeOptionSchema),
  activity_count: z.number(),
  first_activity: z.string().nullable(),
  last_activity: z.string().nullable(),
  athlete: AthleteInfoSchema.nullable(),
  athletes: z.array(AthleteListItemSchema).default([]),
});

export const TotalsSchema = z.object({
  count: z.number(),
  distance: z.number(),
  elevation: z.number(),
  moving_time_s: z.number(),
  calories: z.number(),
});

export const ActivitySummarySchema = z.object({
  activity_id: z.string(),
  name: z.string(),
  start_date_time: z.string(),
  sport_type: z.string(),
  sport_label: z.string(),
  activity_type: z.string(),
  distance_km: z.number(),
  distance_mi: z.number(),
  elevation_m: z.number(),
  moving_time_s: z.number(),
  elapsed_time_s: z.number(),
  average_speed_kmh: z.number().nullable(),
  average_pace_s_per_km: z.number().nullable(),
  pace_unit: z.string(),
  average_heart_rate: z.number().nullable(),
  max_heart_rate: z.number().nullable(),
  average_power: z.number().nullable(),
  calories: z.number().nullable(),
  is_commute: z.boolean(),
  gear_name: z.string().nullable(),
  has_map: z.boolean(),
});

export const PaginatedActivitiesSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  items: z.array(ActivitySummarySchema),
});

const PeriodTotalsSchema = TotalsSchema.extend({ period: z.string() });
const LabeledTotalsSchema = TotalsSchema.extend({ label: z.string() });

const CalendarPointSchema = z.object({
  date: z.string(),
  count: z.number(),
  distance: z.number(),
  moving_time_s: z.number(),
  training_load: z.number(),
});

const EddingtonSummarySchema = z.object({
  activity_type: z.string(),
  number: z.number(),
  longest_day: z.number(),
  next: z.number(),
  days_to_next: z.number().nullable(),
});

const MilestoneSchema = z.object({
  achieved_on: z.string(),
  group: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string(),
  sport_type: z.string().nullable(),
  activity_id: z.string().nullable(),
  fun_comparison: z.string().nullable(),
});

const GearItemSchema = z.object({
  gear_id: z.string(),
  name: z.string(),
  gear_type: z.string(),
  distance_km: z.number(),
  is_retired: z.boolean(),
});

export const DashboardSchema = z.object({
  empty: z.boolean(),
  filtered_empty: z.boolean().optional(),
  available_years: z.array(z.number()).optional(),
  unit_system: z.string(),
  totals: TotalsSchema.optional(),
  recent_activities: z.array(ActivitySummarySchema).optional(),
  weekly_stats: z.array(PeriodTotalsSchema).optional(),
  monthly_stats: z.array(PeriodTotalsSchema).optional(),
  yearly_stats: z.array(PeriodTotalsSchema).optional(),
  activity_calendar: z.array(CalendarPointSchema).optional(),
  streaks: z.object({ current: z.number(), longest: z.number() }).optional(),
  eddington: z.array(EddingtonSummarySchema).optional(),
  weekday_stats: z.array(LabeledTotalsSchema).optional(),
  daytime_stats: z.array(LabeledTotalsSchema).optional(),
  distance_breakdown: z.array(LabeledTotalsSchema).optional(),
  hr_zones: z.object({ zones: z.array(z.number()), window_days: z.number() }).nullable().optional(),
  peak_power: z.object({
    durations: z.array(z.number()),
    outputs: z.array(z.object({ duration_s: z.number(), watts: z.number().nullable() })),
    window_days: z.number(),
  }).nullable().optional(),
  training_load: z.array(z.object({ date: z.string(), load: z.number() })).optional(),
  vo2max_trend: z.array(z.object({ date: z.string(), vo2max: z.number() })).optional(),
  training_load_analysis: z.object({
    ctl: z.number(),
    atl: z.number(),
    tsb: z.number(),
    tsb_status: z.string(),
    tsb_color: z.string(),
    ac_ratio: z.number(),
    ac_status: z.string(),
    ac_color: z.string(),
    rest_days: z.number(),
    monotony: z.number(),
    strain: z.number(),
    weekly_trimp: z.number(),
    series: z.array(z.object({
      date: z.string(),
      load: z.number(),
      ctl: z.number(),
      atl: z.number(),
      tsb: z.number(),
      activities: z.array(ActivitySummarySchema.extend({ load: z.number(), intensity: z.number() })).optional(),
    })),
    display_days: z.number(),
  }).nullable().optional(),
  recent_milestones: z.array(MilestoneSchema).optional(),
  gear_stats: z.array(GearItemSchema).optional(),
});

const HrZoneItemSchema = z.object({
  zone: z.number(),
  label: z.string(),
  lower_bpm: z.number(),
  upper_bpm: z.number().nullable(),
  seconds: z.number(),
  percentage: z.number(),
});

const PaceZoneItemSchema = z.object({
  zone: z.number(),
  label: z.string(),
  slow_pace: z.number().nullable(),
  fast_pace: z.number().nullable(),
  seconds: z.number(),
  percentage: z.number(),
});

export const ActivityDetailSchema = ActivitySummarySchema.extend({
  description: z.string().nullable(),
  max_speed_kmh: z.number().nullable(),
  average_cadence: z.number().nullable(),
  max_cadence: z.number().nullable(),
  max_power: z.number().nullable(),
  normalized_power: z.number().nullable(),
  device_name: z.string().nullable(),
  polyline: z.string().nullable(),
  start_latitude: z.number().nullable(),
  start_longitude: z.number().nullable(),
  streams: z.record(z.string(), z.array(z.number().nullable())),
  best_efforts: z.array(z.object({
    distance_m: z.number(),
    label: z.string(),
    time_s: z.number(),
  })),
  hr_zones: z.array(HrZoneItemSchema).nullable().default(null),
  pace_zones: z.array(PaceZoneItemSchema).nullable().default(null),
});

export const ImportRunStatusSchema = z.object({
  id: z.number(),
  status: z.string(),
  source: z.string().nullable(),
  added: z.number(),
  updated: z.number(),
  skipped: z.number(),
  deduped: z.number(),
  gear_upserted: z.number(),
  files_parsed: z.number(),
  parse_errors: z.number(),
  total: z.number().nullable(),
  processed: z.number(),
  finished_at: z.string().nullable(),
  message: z.string().nullable(),
});

export const ImportPreviewSchema = z.object({
  source: z.string(),
  provider: z.string(),
  athlete_name: z.string().nullable(),
  source_athlete_id: z.string().nullable(),
  activity_count: z.number(),
  is_existing_athlete: z.boolean(),
  suggested_athlete_id: z.string().nullable(),
  suggested_athlete_name: z.string().nullable(),
});
