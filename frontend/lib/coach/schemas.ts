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
