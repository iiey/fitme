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
        className="fixed bottom-5 right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-lg transition-colors hover:bg-brand-dark"
      >
        <Sparkles className="h-5 w-5" />
      </button>
      <CoachDrawer open={open} onClose={() => setOpen(false)} status={status} />
    </>
  )
}
