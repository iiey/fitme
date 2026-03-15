"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { use, useEffect } from "react"

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
  const { data: activity, error, isLoading, mutate } = useActivity(athleteId, id)
  const { data: meta } = useMeta(athleteId)

  // Reflect the activity name in the browser tab; this is a client page, so
  // the static metadata title ("FitMe") is all Next.js sets on its own.
  useEffect(() => {
    if (!activity) return
    const previousTitle = document.title
    document.title = `${activity.name} · FitMe`
    return () => {
      document.title = previousTitle
    }
  }, [activity])

  if (isLoading) return <Spinner label="Loading activity…" />
  if (error || !activity) {
    const notFound = error instanceof ApiError && error.status === 404
    return notFound ? (
      <ErrorState message="Activity not found." />
    ) : (
      <ErrorState
        message="Couldn't load this activity. Please try again."
        onRetry={() => mutate()}
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
  const router = useRouter()

  // Prefer going back so the list keeps its filters and scroll position; fall
  // back to the plain link when there is no in-app history (e.g. a shared URL
  // opened directly, or middle-click / open-in-new-tab).
  const handleBack = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    if (window.history.length > 1) {
      event.preventDefault()
      router.back()
    }
  }

  return (
    <div>
      <Link href="/activities" onClick={handleBack} className="text-sm text-brand hover:underline">
        &larr; Back to activities
      </Link>
      <h1 className="mt-1 text-2xl font-bold">{activity.name}</h1>
      <p className="text-sm text-gray-500">
        {activity.sport_label} &middot;{" "}
        <time dateTime={activity.start_date_time}>
          {formatDate(activity.start_date_time, "EEEE yyyy-MM-dd 'at' HH:mm")}
        </time>
      </p>
      {activity.description && (
        <p className="mt-2 text-sm text-gray-600 italic">{activity.description}</p>
      )}
    </div>
  )
}
