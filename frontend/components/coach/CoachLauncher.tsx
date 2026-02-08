"use client"

import clsx from "clsx"
import { Sparkles } from "lucide-react"
import { useState } from "react"

import { useCoachStatus } from "@/lib/coach/api"
import { useSidebar } from "@/lib/sidebar-context"

import { CoachDrawer } from "./CoachDrawer"

/**
 * Global FitBuddy launcher, mounted once in the root layout. Renders nothing
 * until the backend coach is configured, enabled, and verified (status.usable),
 * so the icon stays hidden when the plugin is absent or not set up.
 */
export function CoachLauncher() {
  const { data: status } = useCoachStatus()
  const { profileMenuOpen } = useSidebar()
  const [open, setOpen] = useState(false)

  if (!status?.usable) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open FitBuddy"
        title="FitBuddy"
        // The launcher sits just above the sidebar profile; while the profile
        // menu is open it expands over the launcher, so step aside for it.
        className={clsx(
          "fixed bottom-20 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-brand/80 text-white shadow-lg backdrop-blur-sm transition-all hover:bg-brand",
          profileMenuOpen && "pointer-events-none opacity-0",
        )}
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <CoachDrawer open={open} onClose={() => setOpen(false)} status={status} />
    </>
  )
}
