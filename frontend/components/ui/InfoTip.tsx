import type { ReactNode } from "react"

export function InfoTip({
  children,
  text,
  width = "w-56",
  position = "above",
  align = "center",
}: {
  children?: ReactNode
  text?: string
  width?: string
  position?: "above" | "below"
  align?: "center" | "left" | "right"
}) {
  const pos = position === "below" ? "top-full mt-2" : "bottom-full mb-2"
  const hor =
    align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2"

  const bubbleClass = [
    "pointer-events-none absolute z-50",
    pos,
    hor,
    width,
    "normal-case tracking-normal",
    "rounded-lg border border-gray-200 bg-white px-3 py-2",
    "text-xs font-normal leading-relaxed text-gray-900",
    "opacity-0 shadow-lg transition-opacity",
    "group-hover:opacity-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100",
  ].join(" ")

  return (
    <span className="group relative ml-1 inline-flex cursor-help" role="img" aria-label="info">
      <svg
        className="h-3.5 w-3.5 text-gray-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      <span className={bubbleClass}>{children ?? text}</span>
    </span>
  )
}
