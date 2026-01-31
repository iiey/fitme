"use client";

import { useMemo, useState } from "react";

import { TrainingLoadSection } from "@/components/charts/TrainingLoadSection";
import { DeferredSection } from "@/components/ui/DeferredSection";
import { EmptyState, Spinner } from "@/components/ui/States";
import { useDashboard, useMeta } from "@/lib/api";
import { useAthleteContext } from "@/lib/athlete-context";

export default function FitnessPage() {
  const { athleteId } = useAthleteContext();
  const { data: meta } = useMeta(athleteId);
  const [sportType, setSportType] = useState("");

  const filters = useMemo(
    () => ({ sport_type: sportType ? [sportType] : undefined }),
    [sportType],
  );
  const { data, error, isLoading } = useDashboard(athleteId, filters);

  const distanceUnit = meta?.distance_unit ?? "km";

  const filterControls = (
    <select
      value={sportType}
      onChange={(event) => setSportType(event.target.value)}
      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none dark:border-gray-600 dark:bg-surface dark:text-foreground"
    >
      <option value="">All sports</option>
      {meta?.sport_types.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Fitness</h1>
        <p className="text-sm text-gray-500">Training load, fitness &amp; fatigue trends</p>
      </div>
      {filterControls}
    </header>
  );

  if (isLoading && !data) {
    return (
      <div className="space-y-6">
        {header}
        <Spinner label="Loading fitness data…" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState message="Could not load fitness data. Try importing a Strava export." />
      </div>
    );
  }
  if (!data.training_load_analysis) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState message="Not enough data for training load analysis yet. Import more activities to see fitness trends." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <DeferredSection height={720}>
        <TrainingLoadSection analysis={data.training_load_analysis} distanceUnit={distanceUnit} />
      </DeferredSection>
    </div>
  );
}
