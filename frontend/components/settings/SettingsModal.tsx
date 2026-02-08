"use client"

import clsx from "clsx"
import { Bot, type LucideIcon, RefreshCw, X } from "lucide-react"
import { useEffect, useState } from "react"

import { CoachSettingsSection } from "@/components/coach/CoachSettingsSection"
import { IntervalsSettingsSection } from "@/components/settings/IntervalsSettingsSection"
import { useCoachStatus } from "@/lib/coach/api"

type SectionId = "intervals" | "fitbuddy"

type Section = { id: SectionId; label: string; icon: LucideIcon }

export function SettingsModal({ onClose }: { onClose: () => void }) {
  // The coach is an optional plugin: only offer its tab when its backend is up.
  const { data: coachStatus } = useCoachStatus()
  const [active, setActive] = useState<SectionId>("intervals")

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const sections: Section[] = [
    { id: "intervals", label: "Intervals.icu", icon: RefreshCw },
    ...(coachStatus ? [{ id: "fitbuddy" as const, label: "Fit Buddy", icon: Bot }] : []),
  ]

  // Guard against an active tab that is no longer available (coach went away).
  const activeSection = sections.some((s) => s.id === active) ? active : "intervals"
  const activeLabel = sections.find((s) => s.id === activeSection)?.label ?? ""

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="card flex h-[800px] max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <nav className="w-44 shrink-0 space-y-1 overflow-y-auto border-r border-gray-200 p-2 dark:border-gray-700">
            {sections.map((section) => {
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActive(section.id)}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm",
                    activeSection === section.id
                      ? "bg-brand/10 font-medium text-brand"
                      : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{section.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="flex-1 overflow-y-auto p-5">
            <h3 className="mb-4 text-base font-semibold">{activeLabel}</h3>
            {activeSection === "intervals" && <IntervalsSettingsSection />}
            {activeSection === "fitbuddy" && <CoachSettingsSection />}
          </div>
        </div>
      </div>
    </div>
  )
}
