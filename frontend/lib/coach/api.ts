import useSWR from "swr"

import { ApiError } from "@/lib/api"

import {
  CoachConfigSchema,
  CoachInsightsSchema,
  CoachMemorySchema,
  CoachMessageSchema,
  CoachPlanResponseSchema,
  CoachSessionSchema,
  CoachSkillSchema,
  CoachStatusSchema,
  CoachVerifyResultSchema,
} from "./schemas"
import type {
  CoachChatContext,
  CoachConfig,
  CoachConfigInput,
  CoachInsights,
  CoachMemory,
  CoachMessage,
  CoachPlanResponse,
  CoachSession,
  CoachSkill,
  CoachStatus,
  CoachVerifyResult,
} from "./types"

/** Surface FastAPI's ``{"detail": "..."}`` message, falling back to the body. */
async function readDetail(response: Response, fallback: string): Promise<string> {
  const body = await response.text()
  if (!body) return fallback
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed.detail === "string") return parsed.detail
  } catch {
    // Not JSON - return the raw body.
  }
  return body
}

/**
 * Fetch coach status, treating a 404 as "plugin not installed" -> ``null``.
 * The whole coach UI hides itself when this resolves to ``null`` or a status
 * whose ``usable`` is false.
 */
async function fetchStatus(url: string): Promise<CoachStatus | null> {
  const response = await fetch(url)
  if (response.status === 404) return null
  if (!response.ok) throw new ApiError(response.status, `Request failed: ${response.status}`)
  return CoachStatusSchema.parse(await response.json())
}

export function useCoachStatus() {
  return useSWR<CoachStatus | null>("/api/coach/status", fetchStatus)
}

/** Fetch the coach config, tolerating ``null``/404 when none is configured. */
async function fetchConfig(url: string): Promise<CoachConfig | null> {
  const response = await fetch(url)
  if (response.status === 404) return null
  if (!response.ok) throw new ApiError(response.status, `Request failed: ${response.status}`)
  const text = await response.text()
  if (!text || text === "null") return null
  return CoachConfigSchema.parse(JSON.parse(text)) as CoachConfig
}

export function useCoachConfig() {
  return useSWR<CoachConfig | null>("/api/coach/config", fetchConfig)
}

export async function saveCoachConfig(input: CoachConfigInput): Promise<CoachConfig> {
  const response = await fetch("/api/coach/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readDetail(response, "Could not save coach settings"))
  }
  return CoachConfigSchema.parse(await response.json()) as CoachConfig
}

export async function deleteCoachConfig(): Promise<void> {
  const response = await fetch("/api/coach/config", { method: "DELETE" })
  if (!response.ok) {
    throw new ApiError(
      response.status,
      await readDetail(response, "Could not remove coach settings"),
    )
  }
}

/** Full wipe: delete the config plus all chats, messages, and memory. */
export async function resetCoachData(): Promise<void> {
  const response = await fetch("/api/coach/data", { method: "DELETE" })
  if (!response.ok) {
    throw new ApiError(response.status, await readDetail(response, "Could not reset coach data"))
  }
}

export async function verifyCoachConfig(
  input: Partial<CoachConfigInput>,
): Promise<CoachVerifyResult> {
  const response = await fetch("/api/coach/config/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readDetail(response, "Verification request failed"))
  }
  return CoachVerifyResultSchema.parse(await response.json())
}

// -- Chat sessions ----------------------------------------------------------

function athleteQuery(athleteId: string | null): string {
  return athleteId ? `?athlete=${encodeURIComponent(athleteId)}` : ""
}

async function fetchSessions(url: string): Promise<CoachSession[]> {
  const response = await fetch(url)
  if (!response.ok) throw new ApiError(response.status, `Request failed: ${response.status}`)
  return CoachSessionSchema.array().parse(await response.json())
}

export function useCoachSessions(athleteId: string | null, enabled: boolean) {
  return useSWR<CoachSession[]>(
    enabled && athleteId ? `/api/coach/sessions${athleteQuery(athleteId)}` : null,
    fetchSessions,
  )
}

export async function createSession(athleteId: string | null): Promise<CoachSession> {
  const response = await fetch(`/api/coach/sessions${athleteQuery(athleteId)}`, { method: "POST" })
  if (!response.ok)
    throw new ApiError(response.status, await readDetail(response, "Could not create chat"))
  return CoachSessionSchema.parse(await response.json())
}

export async function renameSession(
  id: number,
  title: string,
  athleteId: string | null,
): Promise<CoachSession> {
  const response = await fetch(`/api/coach/sessions/${id}${athleteQuery(athleteId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  })
  if (!response.ok)
    throw new ApiError(response.status, await readDetail(response, "Could not rename chat"))
  return CoachSessionSchema.parse(await response.json())
}

export async function deleteSession(id: number, athleteId: string | null): Promise<void> {
  const response = await fetch(`/api/coach/sessions/${id}${athleteQuery(athleteId)}`, {
    method: "DELETE",
  })
  if (!response.ok)
    throw new ApiError(response.status, await readDetail(response, "Could not delete chat"))
}

/** Batch-delete chats by id; backs the multi-select delete and "Clear all". */
export async function deleteSessions(ids: number[], athleteId: string | null): Promise<void> {
  const response = await fetch(`/api/coach/sessions${athleteQuery(athleteId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  })
  if (!response.ok)
    throw new ApiError(response.status, await readDetail(response, "Could not delete chats"))
}

export async function fetchSessionMessages(
  id: number,
  athleteId: string | null,
): Promise<CoachMessage[]> {
  const response = await fetch(`/api/coach/sessions/${id}/messages${athleteQuery(athleteId)}`)
  if (!response.ok) throw new ApiError(response.status, `Request failed: ${response.status}`)
  return CoachMessageSchema.array().parse(await response.json())
}

// -- Streaming chat ---------------------------------------------------------

export interface ChatHandlers {
  onSession?: (sessionId: number, title: string) => void
  onDelta?: (text: string) => void
  onDone?: () => void
  onError?: (message: string) => void
}

/**
 * POST a message and stream the reply via Server-Sent Events, dispatching
 * ``session`` / ``delta`` / ``done`` / ``error`` events to the handlers.
 */
export async function streamChat(
  input: {
    message: string
    session_id?: number | null
    context?: CoachChatContext
    // Skill id chosen from the "/" menu; applied to this message only.
    skill?: string | null
    // When true, enable free web search + page fetch for this message.
    web?: boolean
  },
  athleteId: string | null,
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/coach/chat${athleteQuery(athleteId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok || !response.body) {
    handlers.onError?.(await readDetail(response, "Chat request failed"))
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  const processChunk = (chunk: string): void => {
    const line = chunk.trim()
    if (!line.startsWith("data:")) return
    let event: { type: string; [key: string]: unknown }
    try {
      event = JSON.parse(line.slice(5).trim())
    } catch {
      return
    }
    if (event.type === "session") {
      handlers.onSession?.(event.session_id as number, event.title as string)
    } else if (event.type === "delta") {
      handlers.onDelta?.(event.text as string)
    } else if (event.type === "done") {
      handlers.onDone?.()
    } else if (event.type === "error") {
      handlers.onError?.(event.message as string)
    }
  }

  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split("\n\n")
    buffer = chunks.pop() ?? ""
    for (const chunk of chunks) processChunk(chunk)
  }
  // Flush a trailing event that arrived without its terminating blank line
  // (e.g. a stream cut short), so a truncated done/error isn't dropped and the
  // UI is not left stuck in the streaming state.
  buffer += decoder.decode()
  if (buffer.trim()) processChunk(buffer)
}

// -- Today's insights -------------------------------------------------------

/** Fetch the deterministic training-load snapshot for the empty-state chip. */
export async function fetchCoachInsights(athleteId: string | null): Promise<CoachInsights> {
  const response = await fetch(`/api/coach/insights${athleteQuery(athleteId)}`)
  if (!response.ok) {
    throw new ApiError(response.status, await readDetail(response, "Could not load insights"))
  }
  return CoachInsightsSchema.parse(await response.json())
}

// -- Long-term memory -------------------------------------------------------

async function fetchMemory(url: string): Promise<CoachMemory[]> {
  const response = await fetch(url)
  if (!response.ok) throw new ApiError(response.status, `Request failed: ${response.status}`)
  return CoachMemorySchema.array().parse(await response.json())
}

export function useCoachMemory(athleteId: string | null, enabled: boolean) {
  return useSWR<CoachMemory[]>(
    enabled && athleteId ? `/api/coach/memory${athleteQuery(athleteId)}` : null,
    fetchMemory,
  )
}

export async function deleteMemory(id: number, athleteId: string | null): Promise<void> {
  const response = await fetch(`/api/coach/memory/${id}${athleteQuery(athleteId)}`, {
    method: "DELETE",
  })
  if (!response.ok)
    throw new ApiError(response.status, await readDetail(response, "Could not forget"))
}

// -- Skills (per-sport instruction sets) ------------------------------------

async function fetchSkills(url: string): Promise<CoachSkill[]> {
  const response = await fetch(url)
  if (!response.ok) throw new ApiError(response.status, `Request failed: ${response.status}`)
  return CoachSkillSchema.array().parse(await response.json())
}

/**
 * Fetch the skill catalog, only when ``enabled`` (the drawer is open, which only
 * mounts when the coach is usable). SWR caches it, so the "/" menu reads it
 * instantly without re-fetching or blocking the app.
 */
export function useCoachSkills(enabled: boolean) {
  return useSWR<CoachSkill[]>(enabled ? "/api/coach/skills" : null, fetchSkills)
}

// -- Training plan ----------------------------------------------------------

export async function generatePlan(
  input: { goal: string; weeks: number; context?: CoachChatContext },
  athleteId: string | null,
): Promise<CoachPlanResponse> {
  const response = await fetch(`/api/coach/plan${athleteQuery(athleteId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readDetail(response, "Could not generate plan"))
  }
  return CoachPlanResponseSchema.parse(await response.json())
}
