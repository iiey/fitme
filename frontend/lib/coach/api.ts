import useSWR from "swr"

import { ApiError } from "@/lib/api"

import { CoachConfigSchema, CoachStatusSchema, CoachVerifyResultSchema } from "./schemas"
import type { CoachConfig, CoachConfigInput, CoachStatus, CoachVerifyResult } from "./types"

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
