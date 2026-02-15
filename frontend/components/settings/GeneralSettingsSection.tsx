"use client"

import { SportFilter } from "@/components/ui/SportFilter"
import { useMeta } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { useDefaultSports } from "@/lib/preferences"

export function GeneralSettingsSection() {
  const { athleteId } = useAthleteContext()
  const { data: meta } = useMeta(athleteId)
  const { defaultSports, setDefaultSports } = useDefaultSports()

  return (
    <div className="space-y-6">
      <div>
        <span className="block text-sm font-medium">Default sports</span>
        <p className="mb-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
          Dashboard, Fitness, Activities, Heatmap and Rewind open filtered to these sports. Pick one
          or more, or choose &ldquo;All sports&rdquo; to see everything by default.
        </p>
        <SportFilter
          options={meta?.sport_types ?? []}
          selected={defaultSports}
          onChange={setDefaultSports}
          className="max-w-xs"
        />
      </div>
    </div>
  )
}
