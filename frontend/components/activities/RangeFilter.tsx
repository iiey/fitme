"use client"

import { X } from "lucide-react"
import { useState } from "react"

export interface RangePreset {
  label: string
  min?: string
  max?: string
}

interface RangeFilterProps {
  label: string
  unit?: string
  min: string
  max: string
  step?: string
  minPlaceholder?: string
  maxPlaceholder?: string
  presets?: RangePreset[]
  onChange: (min: string, max: string) => void
  onClear: () => void
  disabled?: boolean
}

/**
 * A numeric min/max range filter rendered as a toggle chip that expands into an
 * inline panel of Min/Max inputs plus optional quick presets. Open state is
 * self-managed and seeded from whether a value is already set (e.g. on reload
 * from the URL). Values are owned by the parent so they can live in the URL.
 */
export function RangeFilter({
  label,
  unit,
  min,
  max,
  step = "any",
  minPlaceholder = "0",
  maxPlaceholder = "∞",
  presets,
  onChange,
  onClear,
  disabled = false,
}: RangeFilterProps) {
  const hasValue = min !== "" || max !== ""
  const [open, setOpen] = useState(hasValue)

  const handleChipClick = () => {
    if (open && hasValue) {
      onClear()
      setOpen(false)
    } else {
      setOpen((prev) => !prev)
    }
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
        {label}
        {hasValue && <X className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            Min
            <input
              type="number"
              step={step}
              min="0"
              placeholder={minPlaceholder}
              value={min}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value, max)}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-surface"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            Max
            <input
              type="number"
              step={step}
              min="0"
              placeholder={maxPlaceholder}
              value={max}
              disabled={disabled}
              onChange={(event) => onChange(min, event.target.value)}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-surface"
            />
          </label>
          {unit && <span className="text-xs text-gray-400">{unit}</span>}
          {presets?.map((preset) => (
            <button
              type="button"
              key={preset.label}
              onClick={() => onChange(preset.min ?? "", preset.max ?? "")}
              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 transition-colors hover:border-brand hover:text-brand"
            >
              {preset.label}
            </button>
          ))}
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
