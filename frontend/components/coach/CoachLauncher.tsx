"use client"

import { Sparkles } from "lucide-react"
import { useState } from "react"

import { useCoachStatus } from "@/lib/coach/api"

import { CoachDrawer } from "./CoachDrawer"

/**
 * Global FitBuddy launcher, mounted once in the root layout. Renders nothing
 * until the backend coach is configured, enabled, and verified (status.usable),
 * so the icon stays hidden when the plugin is absent or not set up.
 */
export function CoachLauncher() {
  const { data: status } = useCoachStatus()
  const [open, setOpen] = useState(false)

  if (!status?.usable) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open FitBuddy"
        title="FitBuddy"
        className="fixed bottom-20 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-brand/80 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-brand"
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <CoachDrawer open={open} onClose={() => setOpen(false)} status={status} />
    </>
  )
}
