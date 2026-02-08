"use client"

import { useMeta } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { useDefaultSport } from "@/lib/preferences"

const SELECT_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"

export function GeneralSettingsSection() {
  const { athleteId } = useAthleteContext()
  const { data: meta } = useMeta(athleteId)
  const { defaultSport, setDefaultSport } = useDefaultSport()

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="default-sport" className="block text-sm font-medium">
          Default sport
        </label>
        <p className="mb-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
          Dashboard, Fitness, Activities, Heatmap and Rewind open filtered to this sport. Choose
          &ldquo;All sports&rdquo; to see everything by default.
        </p>
        <select
          id="default-sport"
          value={defaultSport}
          onChange={(event) => setDefaultSport(event.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">All sports</option>
          {meta?.sport_types.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
