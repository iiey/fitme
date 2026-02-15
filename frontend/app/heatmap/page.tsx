"use client"

import dynamic from "next/dynamic"
import { useState } from "react"

import { SportFilter } from "@/components/ui/SportFilter"
import { ErrorState, Spinner } from "@/components/ui/States"
import { useHeatmap, useMeta } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { formatNumber } from "@/lib/format"
import { useDefaultSports } from "@/lib/preferences"

const HeatmapView = dynamic(() => import("@/components/map/HeatmapView"), {
  ssr: false,
  loading: () => <Spinner label="Loading map…" />,
})

export default function HeatmapPage() {
  const { athleteId } = useAthleteContext()
  const { data: meta } = useMeta(athleteId)
  const { defaultSports } = useDefaultSports()
  // null = follow the configured default; an array = an explicit user choice.
  const [sports, setSports] = useState<string[] | null>(null)
  const activeSports = sports ?? defaultSports
  const [commute, setCommute] = useState<string>("")

  const { data, error, isLoading } = useHeatmap(athleteId, {
    sport_type: activeSports.length ? activeSports : undefined,
    commute: commute === "" ? undefined : commute === "true",
  })

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Heatmap</h1>
          <p className="text-sm text-gray-500">
            {data ? `${formatNumber(data.count)} routes` : "Visualize where you've been active"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SportFilter
            options={meta?.sport_types ?? []}
            selected={activeSports}
            onChange={setSports}
          />
          <select
            value={commute}
            onChange={(event) => setCommute(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
          >
            <option value="">All activities</option>
            <option value="false">Non-commute</option>
            <option value="true">Commute only</option>
          </select>
        </div>
      </header>

      <div className="card relative flex-1 overflow-hidden border-gray-400 p-0 shadow-md dark:border-gray-700">
        {isLoading && !data ? (
          <Spinner label="Loading routes…" />
        ) : error ? (
          <ErrorState />
        ) : data && data.routes.length > 0 ? (
          <HeatmapView routes={data.routes} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            No routes with GPS data match these filters.
          </div>
        )}
      </div>
    </div>
  )
}
