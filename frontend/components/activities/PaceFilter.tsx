"use client"

import { X } from "lucide-react"
import { useState } from "react"

const KM_PER_MILE = 1.609344

interface PaceFilterProps {
  /** "pace" shows min/km (or /mi) inputs; "speed" shows km/h (or mph). */
  mode: "pace" | "speed"
  distanceUnit: string
  /** Canonical bounds: average speed in km/h, as strings ("" = unset). */
  speedMin: string
  speedMax: string
  onChange: (speedMin: string, speedMax: string) => void
  onClear: () => void
  disabled?: boolean
}

/** Parse "M:SS" (or bare minutes) to seconds, or null when blank/invalid. */
function parsePaceToSeconds(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const parts = text.split(":")
  if (parts.length === 1) {
    const minutes = Number(parts[0])
    return Number.isFinite(minutes) ? Math.round(minutes * 60) : null
  }
  const minutes = Number(parts[0])
  const seconds = Number(parts[1])
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null
  return Math.round(minutes * 60 + seconds)
}

function formatSecondsAsPace(totalSeconds: number): string {
  const secs = Math.round(totalSeconds)
  const minutes = Math.floor(secs / 60)
  const seconds = secs % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Pace/speed range filter. The underlying filter is always an average-speed
 * range (km/h), so the stored value is sport-agnostic; only the input UI
 * adapts: run/walk selections enter pace (min/km, lower = faster), everything
 * else enters speed (km/h, higher = faster). The component converts between the
 * shown unit and the canonical km/h bounds, including the pace/speed inversion.
 */
export function PaceFilter({
  mode,
  distanceUnit,
  speedMin,
  speedMax,
  onChange,
  onClear,
  disabled = false,
}: PaceFilterProps) {
  const hasValue = speedMin !== "" || speedMax !== ""
  const [open, setOpen] = useState(hasValue)
  const isMiles = distanceUnit === "mi"

  const handleChipClick = () => {
    if (open && hasValue) {
      onClear()
      setOpen(false)
    } else {
      setOpen((prev) => !prev)
    }
  }

  // -- speed (km/h) <-> displayed-unit helpers --------------------------------
  const kmhToDisplaySpeed = (kmh: string) =>
    kmh === "" ? "" : String(roundTo(isMiles ? Number(kmh) / KM_PER_MILE : Number(kmh), 1))
  const displaySpeedToKmh = (value: string) => {
    const n = Number(value)
    if (value.trim() === "" || !Number.isFinite(n)) return ""
    return String(isMiles ? n * KM_PER_MILE : n)
  }

  // -- speed (km/h) <-> pace (sec per shown unit) helpers ---------------------
  const kmhToPace = (kmh: string) => {
    if (kmh === "" || Number(kmh) <= 0) return ""
    const secPerKm = 3600 / Number(kmh)
    return formatSecondsAsPace(isMiles ? secPerKm * KM_PER_MILE : secPerKm)
  }
  const paceToKmh = (value: string) => {
    const secPerShown = parsePaceToSeconds(value)
    if (secPerShown === null || secPerShown <= 0) return ""
    const secPerKm = isMiles ? secPerShown / KM_PER_MILE : secPerShown
    return String(3600 / secPerKm)
  }

  let body: React.ReactNode
  if (mode === "pace") {
    // Fastest pace = highest speed (speedMax); slowest pace = lowest (speedMin).
    const unit = isMiles ? "/mi" : "/km"
    body = (
      <>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Fastest
          <input
            type="text"
            inputMode="numeric"
            placeholder="4:00"
            value={kmhToPace(speedMax)}
            disabled={disabled}
            onChange={(event) => onChange(speedMin, paceToKmh(event.target.value))}
            className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-surface"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Slowest
          <input
            type="text"
            inputMode="numeric"
            placeholder="6:30"
            value={kmhToPace(speedMin)}
            disabled={disabled}
            onChange={(event) => onChange(paceToKmh(event.target.value), speedMax)}
            className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-surface"
          />
        </label>
        <span className="text-xs text-gray-400">min{unit}</span>
      </>
    )
  } else {
    const unit = isMiles ? "mph" : "km/h"
    body = (
      <>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Min
          <input
            type="number"
            step="any"
            min="0"
            placeholder="0"
            value={kmhToDisplaySpeed(speedMin)}
            disabled={disabled}
            onChange={(event) => onChange(displaySpeedToKmh(event.target.value), speedMax)}
            className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-surface"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Max
          <input
            type="number"
            step="any"
            min="0"
            placeholder="∞"
            value={kmhToDisplaySpeed(speedMax)}
            disabled={disabled}
            onChange={(event) => onChange(speedMin, displaySpeedToKmh(event.target.value))}
            className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-surface"
          />
        </label>
        <span className="text-xs text-gray-400">{unit}</span>
      </>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleChipClick}
        disabled={disabled}
        className={`inline-flex items-center gap-1 self-start rounded-lg border px-3 py-2 text-sm transition-colors ${
          hasValue
            ? "border-brand bg-brand/10 text-brand"
            : open
              ? "border-gray-400 text-gray-700 dark:text-gray-200"
              : "border-gray-300 text-gray-600 hover:border-gray-400"
        }`}
      >
        {mode === "pace" ? "Pace" : "Speed"}
        {hasValue && <X className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          {body}
          {hasValue && (
            <button
              type="button"
              onClick={() => {
                onClear()
                setOpen(false)
              }}
              className="text-sm text-brand hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
