// Types for the FitBuddy plugin. Kept inside lib/coach (not the shared
// lib/types.ts) so the whole feature stays self-contained and removable.

export type CoachProvider = "openai" | "anthropic" | "ollama" | "openai_compatible"

export interface CoachConfig {
  provider: CoachProvider
  model: string
  has_api_key: boolean
  base_url: string | null
  enabled: boolean
  last_status: string | null
  last_message: string | null
  updated_on?: string | null
}

export interface CoachStatus {
  configured: boolean
  enabled: boolean
  // usable = configured and enabled and last verification ok. The launcher
  // icon is shown only when this is true.
  usable: boolean
  provider: string | null
  model: string | null
  last_status: string | null
  last_message: string | null
}

export interface CoachVerifyResult {
  ok: boolean
  message: string
}

export interface CoachConfigInput {
  provider: CoachProvider
  model: string
  // Blank means "keep the stored key" on an existing config.
  api_key: string
  base_url?: string | null
  enabled: boolean
}

export interface CoachSession {
  id: number
  title: string
  created_on: string
  updated_on: string
}

export type ChatRole = "user" | "assistant"

export interface CoachMessage {
  id: number
  role: ChatRole
  content: string
  created_on: string
}

// What the user is currently viewing, derived from the route by the UI.
export interface CoachChatContext {
  view?: string | null
  activity_id?: string | null
}

// A message held in the drawer (server messages have an id; an in-flight
// streaming assistant message does not yet).
export interface ChatMessage {
  id?: number
  role: ChatRole
  content: string
}

export interface CoachMemory {
  id: number
  content: string
  created_on: string
}

// A selectable coaching skill, surfaced in the chat "/" menu.
export interface CoachSkill {
  id: string
  name: string
  description: string
}

export interface PlannedSession {
  day: string
  sport: string
  workout_type: string
  description: string
  target_distance_km?: number | null
  target_duration_min?: number | null
  intensity?: string | null
}

export interface PlannedWeek {
  week: number
  focus: string
  sessions: PlannedSession[]
}

export interface TrainingPlan {
  title: string
  summary: string
  weeks: PlannedWeek[]
}

export interface CoachPlanResponse {
  plan: TrainingPlan | null
  message: string | null
}

// A rendered item in the chat thread: a text message or a generated plan card.
export type ThreadItem =
  | { kind: "msg"; id?: number; role: ChatRole; content: string }
  | { kind: "plan"; plan: TrainingPlan }
