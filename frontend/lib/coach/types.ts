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
