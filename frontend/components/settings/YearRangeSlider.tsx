"use client"

interface YearRangeSliderProps {
  min: number
  max: number
  start: number
  end: number
  onChange: (start: number, end: number) => void
  disabled?: boolean
}

/**
 * A two-thumb year slider rendered from a pair of overlaid native range
 * inputs. The thumbs are clamped so they cannot cross, and z-index is raised on
 * whichever thumb sits at a boundary so a window collapsed to a single year can
 * always be reopened. The right edge reads "now" since it extends to today.
 */
export function YearRangeSlider({
  min,
  max,
  start,
  end,
  onChange,
  disabled = false,
}: YearRangeSliderProps) {
  const span = max - min || 1
  const startPct = ((start - min) / span) * 100
  const endPct = ((end - min) / span) * 100

  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-medium text-gray-600 dark:text-gray-300">
        <span>{start}</span>
        <span>{end >= max ? "now" : end}</span>
      </div>
      <div className="relative h-6">
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded bg-gray-200 dark:bg-gray-700" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-brand"
          style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={start}
          disabled={disabled}
          aria-label="Start year"
          onChange={(e) => onChange(Math.min(Number(e.target.value), end), end)}
          className="range-thumb absolute top-0 left-0 h-6 w-full"
          style={{ zIndex: start >= max ? 5 : 3 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={end}
          disabled={disabled}
          aria-label="End year"
          onChange={(e) => onChange(start, Math.max(Number(e.target.value), start))}
          className="range-thumb absolute top-0 left-0 h-6 w-full"
          style={{ zIndex: end <= min ? 5 : 4 }}
        />
      </div>
    </div>
  )
}
