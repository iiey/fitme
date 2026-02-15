"use client"

import { useMemo, useState } from "react"

import { TrainingLoadSection } from "@/components/charts/TrainingLoadSection"
import { DeferredSection } from "@/components/ui/DeferredSection"
import { InfoTip } from "@/components/ui/InfoTip"
import { SportFilter } from "@/components/ui/SportFilter"
import { EmptyState, Spinner } from "@/components/ui/States"
import { useDashboard, useMeta } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { useDefaultSports } from "@/lib/preferences"

export default function FitnessPage() {
  const { athleteId } = useAthleteContext()
  const { data: meta } = useMeta(athleteId)
  const { defaultSports } = useDefaultSports()
  // null = follow the configured default; an array = an explicit user choice.
  const [sports, setSports] = useState<string[] | null>(null)
  const activeSports = sports ?? defaultSports

  const filters = useMemo(
    () => ({ sport_type: activeSports.length ? activeSports : undefined }),
    [activeSports],
  )
  const { data, error, isLoading } = useDashboard(athleteId, filters)

  const distanceUnit = meta?.distance_unit ?? "km"

  const filterControls = (
    <SportFilter
      options={meta?.sport_types ?? []}
      selected={activeSports}
      onChange={setSports}
      align="right"
    />
  )

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">
          Training Load Analysis
          <InfoTip width="w-72" position="below" align="left">
            <p className="mb-1.5 font-semibold">Training Load = Duration × Intensity</p>
            <p className="mb-1.5">
              Quantifies the total physiological stress placed on your body from training - more
              accurate than just tracking mileage or time alone.
            </p>
            <p className="mb-0.5 font-medium">The Two Dimensions</p>
            <ul className="list-disc pl-3.5">
              <li>Volume - how long you trained (time/distance)</li>
              <li>Intensity - how hard (HR, pace, power relative to your threshold)</li>
            </ul>
          </InfoTip>
        </h1>
        <p className="text-sm text-gray-500">Fitness, fatigue and form trends</p>
      </div>
      {filterControls}
    </header>
  )

  if (isLoading && !data) {
    return (
      <div className="space-y-6">
        {header}
        <Spinner label="Loading fitness data…" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState message="Could not load fitness data. Try importing your data." />
      </div>
    )
  }
  if (!data.training_load_analysis) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState message="Not enough data for training load analysis yet. Import more activities to see fitness trends." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}
      <DeferredSection height={720}>
        <TrainingLoadSection analysis={data.training_load_analysis} distanceUnit={distanceUnit} />
      </DeferredSection>
    </div>
  )
}
