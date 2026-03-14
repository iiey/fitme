"use client"

import Link from "next/link"
import { useEffect } from "react"

import { EmptyState } from "@/components/ui/States"
import {
  colorForSportType,
  formatActivityPace,
  formatDate,
  formatDuration,
  formatNumber,
} from "@/lib/format"
import { iconForSportType } from "@/lib/sportIcons"
import type { CalendarActivity } from "@/lib/types"

/**
 * In-place detail for a single calendar day. Opening this drawer keeps the user
 * on the calendar instead of navigating away to the activities list, while still
 * offering per-activity links for a deeper dive.
 */
export function DayDetailModal({
  date,
  activities,
  unitSystem,
  onClose,
}: {
  date: string
  activities: CalendarActivity[]
  unitSystem: string
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const distUnit = unitSystem === "imperial" ? "mi" : "km"
  const sorted = [...activities].sort((a, b) => a.start_date_time.localeCompare(b.start_date_time))

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss is a mouse convenience; Escape and the close button cover keyboard users
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is a mouse convenience; Escape and the close button cover keyboard users
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Activities on ${formatDate(date, "EEEE, d MMMM yyyy")}`}
        className="card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden"
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 className="text-lg font-semibold">{formatDate(date, "EEEE, d MMMM yyyy")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="overflow-y-auto p-4">
          {sorted.length === 0 ? (
            <EmptyState message="No activities on this day." />
          ) : (
            <ul className="space-y-2">
              {sorted.map((act) => {
                const dist = unitSystem === "imperial" ? act.distance_mi : act.distance_km
                const SportIcon = iconForSportType(act.sport_type, act.activity_type)
                return (
                  <li key={act.activity_id}>
                    <Link
                      href={`/activities/${act.activity_id}`}
                      className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      <span className="flex items-center gap-2">
                        <SportIcon
                          className="h-4 w-4 shrink-0"
                          style={{ color: colorForSportType(act.sport_type) }}
                          aria-hidden="true"
                        />
                        <span className="truncate font-medium text-brand">{act.name}</span>
                      </span>
                      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                        <span>{formatDuration(act.moving_time_s)}</span>
                        {dist > 0.1 && (
                          <span>
                            {formatNumber(dist, 1)} {distUnit}
                          </span>
                        )}
                        <span>{formatActivityPace(act, distUnit)}</span>
                        {act.average_heart_rate != null && (
                          <span>{Math.round(act.average_heart_rate)} bpm avg HR</span>
                        )}
                        {act.load > 0 && <span>Load {act.load}</span>}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <Link
            href={`/activities?from=${date}&to=${date}`}
            className="text-sm font-medium text-brand hover:underline"
          >
            View in activities →
          </Link>
        </footer>
      </div>
    </div>
  )
}
