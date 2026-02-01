import type { ReactNode } from "react";

export function InfoTip({
  children,
  text,
  width = "w-56",
  position = "above",
}: {
  children?: ReactNode;
  text?: string;
  width?: string;
  position?: "above" | "below";
}) {
  const pos = position === "below"
    ? "top-full mt-2"
    : "bottom-full mb-2";

  const bubbleClass = [
    "pointer-events-none absolute left-1/2 z-50",
    pos,
    width,
    "-translate-x-1/2 normal-case tracking-normal",
    "rounded-lg bg-gray-900 px-3 py-2",
    "text-xs font-normal leading-relaxed text-white",
    "opacity-0 shadow-lg transition-opacity",
    "group-hover:opacity-100 dark:bg-gray-700",
  ].join(" ");

  return (
    <span
      className="group relative ml-1 inline-flex cursor-help"
      role="img"
      aria-label="info"
    >
      <svg
        className="h-3.5 w-3.5 text-gray-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      <span className={bubbleClass}>
        {children ?? text}
      </span>
    </span>
  );
}
