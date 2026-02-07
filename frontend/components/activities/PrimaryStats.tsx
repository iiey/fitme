import { StatCard } from "@/components/ui/StatCard"
import type { ActivityProfile, PrimaryStatKey } from "@/lib/activityProfiles"
import { formatActivityPace, formatDuration, formatNumber } from "@/lib/format"
import type { ActivityDetail } from "@/lib/types"

interface StatTile {
  label: string
  value: string
}

function paceLabel(paceUnit: string): string {
  if (paceUnit === "km/h") return "Speed"
  if (paceUnit === "/100m") return "Pace /100m"
  return "Pace"
}

/** Build one primary tile, or null when the activity has no value for it. */
function statFor(key: PrimaryStatKey, a: ActivityDetail, distanceUnit: string): StatTile | null {
  switch (key) {
    case "distance": {
      const d = distanceUnit === "mi" ? a.distance_mi : a.distance_km
      return { label: `Distance (${distanceUnit})`, value: formatNumber(d, 2) }
    }
    case "movingTime":
      return { label: "Moving Time", value: formatDuration(a.moving_time_s) }
    case "paceSpeed":
      return { label: paceLabel(a.pace_unit), value: formatActivityPace(a) }
    case "elevation":
      return { label: "Elevation", value: `${formatNumber(a.elevation_m, 0)} m` }
    case "avgHr":
      return a.average_heart_rate == null
        ? null
        : { label: "Avg HR", value: `${a.average_heart_rate} bpm` }
    case "calories":
      return a.calories == null
        ? null
        : { label: "Calories", value: `${formatNumber(a.calories, 0)} kcal` }
    case "power":
      return a.average_power == null ? null : { label: "Avg Power", value: `${a.average_power} W` }
  }
}

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
}

/** Top stat grid, driven by the sport profile. Tiles without a value are dropped
 *  and the first surviving tile is accented (the sport's primary metric). */
export function PrimaryStats({
  activity,
  profile,
  distanceUnit,
}: {
  activity: ActivityDetail
  profile: ActivityProfile
  distanceUnit: string
}) {
  const tiles = profile.primaryStats
    .map((key) => statFor(key, activity, distanceUnit))
    .filter((t): t is StatTile => t != null)

  if (tiles.length === 0) return null

  const colClass = GRID_COLS[Math.min(tiles.length, 4)]
  return (
    <div className={`grid gap-3 ${colClass}`}>
      {tiles.map((tile, i) => (
        <StatCard key={tile.label} label={tile.label} value={tile.value} accent={i === 0} />
      ))}
    </div>
  )
}
