import { z } from "zod"

export const CoachStatusSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  usable: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  last_status: z.string().nullable(),
  last_message: z.string().nullable(),
})

export const CoachConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  has_api_key: z.boolean(),
  base_url: z.string().nullable(),
  enabled: z.boolean(),
  last_status: z.string().nullable(),
  last_message: z.string().nullable(),
  updated_on: z.string().nullable().optional(),
})

export const CoachVerifyResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
})

export const CoachSessionSchema = z.object({
  id: z.number(),
  title: z.string(),
  created_on: z.string(),
  updated_on: z.string(),
})

export const CoachMessageSchema = z.object({
  id: z.number(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  created_on: z.string(),
})

export const CoachMemorySchema = z.object({
  id: z.number(),
  content: z.string(),
  created_on: z.string(),
})

export const CoachSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
})

const PlannedSessionSchema = z.object({
  day: z.string(),
  sport: z.string(),
  workout_type: z.string(),
  description: z.string(),
  target_distance_km: z.number().nullable().optional(),
  target_duration_min: z.number().nullable().optional(),
  intensity: z.string().nullable().optional(),
})

const PlannedWeekSchema = z.object({
  week: z.number(),
  focus: z.string(),
  sessions: z.array(PlannedSessionSchema),
})

export const TrainingPlanSchema = z.object({
  title: z.string(),
  summary: z.string(),
  weeks: z.array(PlannedWeekSchema),
})

export const CoachPlanResponseSchema = z.object({
  plan: TrainingPlanSchema.nullable(),
  message: z.string().nullable(),
})
