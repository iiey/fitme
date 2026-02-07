import { formatDuration } from "@/lib/format"
import type { PaceZoneItem } from "@/lib/types"

import { ZONE_COLORS } from "./charts"

function formatZonePace(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}:${String(secs).padStart(2, "0")}`
}

export function PaceZones({ zones }: { zones: PaceZoneItem[] }) {
  const maxPct = Math.max(...zones.map((z) => z.percentage), 1)
  return (
    <div className="space-y-2.5">
      {[...zones].reverse().map((z) => (
        <div key={z.zone} className="flex items-center gap-3">
          <div className="w-32 shrink-0">
            <div className="text-sm font-semibold">
              Zone {z.zone}
              <span className="ml-1.5 font-normal text-gray-400 text-xs">
                {z.fast_pace == null
                  ? `< ${formatZonePace(z.slow_pace!)} /km`
                  : z.slow_pace == null
                    ? `> ${formatZonePace(z.fast_pace)} /km`
                    : `${formatZonePace(z.fast_pace)}–${formatZonePace(z.slow_pace)} /km`}
              </span>
            </div>
            <div className="text-xs text-gray-400">{z.label}</div>
          </div>
          <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max((z.percentage / maxPct) * 100, 1)}%`,
                backgroundColor: ZONE_COLORS[z.zone - 1],
              }}
            />
          </div>
          <div className="w-16 text-right text-sm tabular-nums">{formatDuration(z.seconds)}</div>
          <div className="w-10 text-right text-sm font-medium tabular-nums">{z.percentage}%</div>
        </div>
      ))}
    </div>
  )
}
