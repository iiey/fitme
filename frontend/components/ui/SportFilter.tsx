"use client"

import clsx from "clsx"
import { Check, ChevronDown } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { SportTypeOption } from "@/lib/types"

interface SportFilterProps {
  options: SportTypeOption[]
  /** Selected sport values. An empty array means "All sports" (no filter). */
  selected: string[]
  onChange: (next: string[]) => void
  /** Which edge the dropdown aligns to, to keep it on-screen. */
  align?: "left" | "right"
  className?: string
}

const TRIGGER_CLASS =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none dark:border-gray-600 dark:bg-surface dark:text-foreground"

/**
 * Multi-select sport picker shared by every "All sports" filter.
 *
 * The empty selection is the canonical "All sports" (no filter) state, matching
 * the backend, which omits the `sport_type IN (...)` clause when none are given.
 * Picking the "All sports" row clears the selection; ticking every sport
 * normalizes back to it, so the label and query stay simple.
 */
export function SportFilter({
  options,
  selected,
  onChange,
  align = "left",
  className,
}: SportFilterProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const isAll = selected.length === 0
  const label = isAll
    ? "All sports"
    : selected.length === 1
      ? (options.find((option) => option.value === selected[0])?.label ?? selected[0])
      : `${selected.length} sports`

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((entry) => entry !== value)
      : [...selected, value]
    onChange(next.length === options.length ? [] : next)
  }

  return (
    <div ref={ref} className={clsx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={TRIGGER_CLASS}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className={clsx(
            "absolute z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <Option label="All sports" checked={isAll} bold onClick={() => onChange([])} />
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          {options.map((option) => (
            <Option
              key={option.value}
              label={option.label}
              checked={selected.includes(option.value)}
              onClick={() => toggle(option.value)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Option({
  label,
  checked,
  bold,
  onClick,
}: {
  label: string
  checked: boolean
  bold?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
    >
      <span
        className={clsx(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          checked ? "border-brand bg-brand text-white" : "border-gray-300 dark:border-gray-600",
        )}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className={clsx("truncate", bold && "font-medium", checked && bold && "text-brand")}>
        {label}
      </span>
    </button>
  )
}
