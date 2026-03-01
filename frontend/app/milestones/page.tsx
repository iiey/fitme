"use client"

import clsx from "clsx"
import {
  Circle,
  Clock,
  Flag,
  Flame,
  Hash,
  type LucideIcon,
  Medal,
  Mountain,
  Route,
  TrendingUp,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/Card"
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States"
import { useMilestones } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { formatDate } from "@/lib/format"

const GROUP_ICONS: Record<string, LucideIcon> = {
  Firsts: Flag,
  Distance: Route,
  Elevation: Mountain,
  Time: Clock,
  Count: Hash,
  "Personal Bests": Medal,
  Eddington: TrendingUp,
  Streaks: Flame,
}

function GroupIcon({ group, className }: { group: string; className?: string }) {
  const Icon = GROUP_ICONS[group] ?? Circle
  return <Icon className={className} />
}

export default function MilestonesPage() {
  const { athleteId } = useAthleteContext()
  const { data, error, isLoading } = useMilestones(athleteId)
  const [activeGroup, setActiveGroup] = useState<string>("All")

  const filteredTimeline = useMemo(() => {
    if (!data) return []
    if (activeGroup === "All") return data.timeline
    return data.timeline
      .map((year) => ({
        year: year.year,
        milestones: year.milestones.filter((m) => m.group === activeGroup),
      }))
      .filter((year) => year.milestones.length > 0)
  }, [data, activeGroup])

  if (isLoading) return <Spinner label="Discovering milestones…" />
  if (error) return <ErrorState />
  if (!data || data.total === 0) {
    return (
      <EmptyState message="No milestones discovered yet. Import more activities to unlock achievements." />
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Milestones</h1>
        <p className="text-sm text-gray-500">{data.total} achievements across your history</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {["All", ...data.groups].map((group) => (
          <button
            key={group}
            type="button"
            onClick={() => setActiveGroup(group)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm",
              group === activeGroup
                ? "bg-brand text-white"
                : "border border-gray-300 hover:bg-gray-100",
            )}
          >
            {group !== "All" && <GroupIcon group={group} className="h-3.5 w-3.5" />}
            {group}
          </button>
        ))}
      </div>

      <div className="space-y-8">
        {filteredTimeline.map((yearGroup) => (
          <div key={yearGroup.year}>
            <h2 className="mb-3 text-lg font-bold text-gray-700">{yearGroup.year}</h2>
            <div className="space-y-3 border-l-2 border-gray-200 pl-5">
              {yearGroup.milestones.map((milestone) => (
                <Card
                  key={`${milestone.group}-${milestone.achieved_on}-${milestone.title}`}
                  className="relative"
                >
                  <span className="absolute -left-[27px] top-5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-brand ring-2 ring-brand dark:bg-gray-900">
                    <GroupIcon group={milestone.group} className="h-3 w-3" />
                  </span>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{milestone.title}</p>
                      <p className="text-sm text-gray-500">{milestone.description}</p>
                      {milestone.fun_comparison && (
                        <p className="mt-1 text-xs italic text-brand">{milestone.fun_comparison}</p>
                      )}
                    </div>
                    <span className="whitespace-nowrap text-xs text-gray-400">
                      {formatDate(milestone.achieved_on)}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
