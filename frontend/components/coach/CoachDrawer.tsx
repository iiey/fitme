"use client"

import { Sparkles, X } from "lucide-react"
import { useEffect } from "react"

import type { CoachStatus } from "@/lib/coach/types"

interface CoachDrawerProps {
  open: boolean
  onClose: () => void
  status: CoachStatus
}

/**
 * Right-side slide-over panel for the FitBuddy. Phase 1 renders the shell
 * (header + empty state); the message list, input, and session switcher are
 * added in the next step.
 */
export function CoachDrawer({ open, onClose, status }: CoachDrawerProps) {
  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-label="FitBuddy"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-gray-200 bg-surface shadow-xl transition-transform duration-200 dark:border-gray-700 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand" />
            <div className="leading-tight">
              <p className="text-sm font-semibold">Coach</p>
              {status.model && <p className="text-xs text-gray-400">{status.model}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Sparkles className="h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium">Your coach is connected</p>
          <p className="max-w-xs text-xs text-gray-400">
            Chat about your training, recent activities, and training plans is arriving in the next
            update.
          </p>
        </div>
      </aside>
    </>
  )
}
