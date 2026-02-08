"use client"

import { usePathname } from "next/navigation"

import type { CoachChatContext } from "./types"

const VIEW_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  activities: "Activities",
  activity: "Activity",
  fitness: "Fitness",
  calendar: "Calendar",
  goals: "Goals",
  heatmap: "Heatmap",
  milestones: "Milestones",
  rewind: "Rewind",
  settings: "Settings",
}

/**
 * Derive what the user is currently viewing from the route alone, so pages do
 * not need to publish anything to the coach (keeps coupling one-way).
 */
export function useCoachContext(): CoachChatContext {
  const pathname = usePathname() || "/"
  if (pathname === "/") return { view: "dashboard" }

  const segments = pathname.split("/").filter(Boolean)
  const first = segments[0]
  if (first === "activities" && segments[1]) {
    return { view: "activity", activity_id: segments[1] }
  }
  return { view: first }
}

export function contextLabel(ctx: CoachChatContext): string {
  if (!ctx.view) return "FitMe"
  return VIEW_LABELS[ctx.view] ?? ctx.view
}
