"use client"

import Link from "next/link"
import { use } from "react"

import { ActivitySectionRenderer } from "@/components/activities/ActivitySectionRenderer"
import { PrimaryStats } from "@/components/activities/PrimaryStats"
import { ErrorState, Spinner } from "@/components/ui/States"
import { resolveActivityProfile } from "@/lib/activityProfiles"
import { ApiError, useActivity, useMeta } from "@/lib/api"
import { useAthleteContext } from "@/lib/athlete-context"
import { formatDate } from "@/lib/format"
import type { ActivityDetail } from "@/lib/types"

export default function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { athleteId } = useAthleteContext()
  const { data: activity, error, isLoading } = useActivity(athleteId, id)
  const { data: meta } = useMeta(athleteId)

  if (isLoading) return <Spinner label="Loading activity…" />
  if (error || !activity) {
    const notFound = error instanceof ApiError && error.status === 404
    return (
      <ErrorState
        message={notFound ? "Activity not found." : "Couldn't load this activity. Please try again."}
      />
    )
  }

  const distanceUnit = meta?.distance_unit ?? "km"
  const profile = resolveActivityProfile(activity)
  const distanceStream = activity.streams.distance ?? []

  return (
    <div className="space-y-6">
      <ActivityHeader activity={activity} />
      <PrimaryStats activity={activity} profile={profile} distanceUnit={distanceUnit} />
      <ActivitySectionRenderer
        activity={activity}
        profile={profile}
        athleteId={athleteId}
        activityId={id}
        distanceStream={distanceStream}
        distanceUnit={distanceUnit}
      />
    </div>
  )
}

function ActivityHeader({ activity }: { activity: ActivityDetail }) {
  return (
    <div>
      <Link href="/activities" className="text-sm text-brand hover:underline">
        &larr; Back to activities
      </Link>
      <h1 className="mt-1 text-2xl font-bold">{activity.name}</h1>
      <p className="text-sm text-gray-500">
        {activity.sport_label} &middot;{" "}
        {formatDate(activity.start_date_time, "EEEE yyyy-MM-dd 'at' HH:mm")}
      </p>
      {activity.description && (
        <p className="mt-2 text-sm text-gray-600 italic">{activity.description}</p>
      )}
    </div>
  )
}
