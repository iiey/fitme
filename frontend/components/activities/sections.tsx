"use client"

import dynamic from "next/dynamic"
import type React from "react"
import { useMemo } from "react"

import { EChart } from "@/components/charts/EChart"
import { Card } from "@/components/ui/Card"
import { InfoTip } from "@/components/ui/InfoTip"
import { StatCard } from "@/components/ui/StatCard"
import type { ActivitySection } from "@/lib/activityProfiles"
import { colorForActivityType, formatDate, formatDuration, formatNumber } from "@/lib/format"
import type { ActivityDetail } from "@/lib/types"
import { useIsDark } from "@/lib/use-is-dark"

import { ActivityNote } from "./ActivityNote"
import { BestEfforts } from "./BestEfforts"
import { HR_CURVE_HELP, hrCurveChart, type StreamAxis, streamChart } from "./charts"
import { DetailRow } from "./DetailRow"
import { HrZones } from "./HrZones"
import { PaceChartCard } from "./PaceChartCard"
import { PaceZones } from "./PaceZones"

const RouteMap = dynamic(() => import("@/components/map/RouteMap"), { ssr: false })

export interface SectionProps {
  activity: ActivityDetail
  distanceStream: (number | null)[]
  athleteId: string | null
  activityId: string
  distanceUnit: string
}

/**
 * Choose the x-axis for a stream chart. GPS distance is only meaningful for
 * distance-based sports that actually recorded a non-zero distance; indoor /
 * cardio sessions fall back to the elapsed-time stream so samples don't collapse
 * onto x=0. With neither available, the sample index stands in for elapsed time.
 */
function streamAxis(
  activity: ActivityDetail,
  distanceStream: (number | null)[],
  valueStream: (number | null)[],
): { stream: (number | null)[]; axis: StreamAxis } {
  const hasDistance = activity.is_distance_based && distanceStream.some((d) => d != null && d > 0)
  if (hasDistance) return { stream: distanceStream, axis: "distance" }
  const time = activity.streams.time
  if (time?.some((t) => t != null)) return { stream: time, axis: "time" }
  return { stream: valueStream.map((_, i) => i), axis: "time" }
}

// Whether a section has the data to render for this activity. Single source of
// truth for both layout (column pairing) and the empty-state fallback. `map` and
// `details` are always-on (note panel / summary) and excluded from emptiness.
export const sectionHasData: Record<ActivitySection, (a: ActivityDetail) => boolean> = {
  map: () => true,
  hrCurve: (a) => !!a.hr_curve && a.hr_curve.length > 1,
  heartRate: (a) => a.average_heart_rate != null,
  hrZones: (a) => !!a.hr_zones && a.hr_zones.length > 0,
  pace: (a) => !!a.streams.velocity_smooth,
  paceZones: (a) => !!a.pace_zones && a.pace_zones.length > 0,
  elevation: (a) => !!a.streams.altitude,
  power: (a) => a.average_power != null,
  cadence: (a) => a.average_cadence != null,
  bestEfforts: (a) => a.best_efforts.length > 0,
  details: () => true,
}

function MapSection({ activity, athleteId, activityId }: SectionProps) {
  const color = colorForActivityType(activity.activity_type)
  return activity.polyline ? (
    <ActivityNote activityId={activityId} athleteId={athleteId} note={activity.user_note}>
      <Card title="Route" className="min-w-0 flex-1">
        <RouteMap polyline={activity.polyline} color={color} height={360} />
      </Card>
    </ActivityNote>
  ) : (
    <ActivityNote activityId={activityId} athleteId={athleteId} note={activity.user_note} />
  )
}

function HrCurveSection({ activity }: SectionProps) {
  const dark = useIsDark()
  const option = useMemo(
    () => (activity.hr_curve ? hrCurveChart(activity.hr_curve, dark) : null),
    [activity.hr_curve, dark],
  )
  if (!option) return null
  return (
    <div className="flex justify-center">
      <div className="w-full lg:w-1/3">
        <Card
          title={
            <span className="inline-flex items-center">
              Heart Rate Curve
              <InfoTip width="w-72">
                <span className="whitespace-pre-line">{HR_CURVE_HELP}</span>
              </InfoTip>
            </span>
          }
        >
          <EChart option={option} height={240} />
        </Card>
      </div>
    </div>
  )
}

function HeartRateSection({ activity, distanceStream }: SectionProps) {
  const dark = useIsDark()
  const heartrate = activity.streams.heartrate
  const option = useMemo(() => {
    if (!heartrate) return null
    const { stream, axis } = streamAxis(activity, distanceStream, heartrate)
    return streamChart(stream, heartrate, "#dc2626", "bpm", axis, dark)
  }, [activity, distanceStream, heartrate, dark])
  if (activity.average_heart_rate == null) return null
  return (
    <Card title="Heart Rate">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard label="Average" value={`${activity.average_heart_rate} bpm`} />
        <StatCard
          label="Maximum"
          value={activity.max_heart_rate ? `${activity.max_heart_rate} bpm` : "-"}
        />
      </div>
      {option && <EChart option={option} height={220} />}
    </Card>
  )
}

function HrZonesSection({ activity }: SectionProps) {
  if (!activity.hr_zones || activity.hr_zones.length === 0) return null
  return (
    <Card title="Time in Heart Rate Zones">
      <HrZones zones={activity.hr_zones} />
    </Card>
  )
}

function PaceSection({ activity, distanceStream, distanceUnit }: SectionProps) {
  if (!activity.streams.velocity_smooth) return null
  return (
    <PaceChartCard
      activity={activity}
      distanceStream={distanceStream}
      distanceUnit={distanceUnit}
    />
  )
}

function PaceZonesSection({ activity }: SectionProps) {
  if (!activity.pace_zones || activity.pace_zones.length === 0) return null
  return (
    <Card
      title={
        <span className="inline-flex items-center">
          Pace Zones
          <InfoTip width="w-72">
            <p className="font-semibold">Joe Friel, The Triathlete&apos;s Training Bible</p>
            <p className="mt-1">Zones = % of Functional Threshold Pace (FTP):</p>
            <ul className="mt-1 space-y-0.5">
              <li>Z1 Recovery: FTP × 1.29 (&gt;129%)</li>
              <li>Z2 Aerobic: FTP × 1.14 (114–129%)</li>
              <li>Z3 Tempo: FTP × 1.06 (106–113%)</li>
              <li>Z4 Sub-Threshold: FTP × 0.99 (99–105%)</li>
              <li>Z5 VO2 Max: FTP × 0.95 (&lt;99%)</li>
            </ul>
            <p className="mt-2 text-gray-400">
              We perform only a rough estimate. To set your own threshold pace, go to Settings →
              Athlete Profile.
            </p>
          </InfoTip>
        </span>
      }
    >
      <PaceZones zones={activity.pace_zones} />
    </Card>
  )
}

function ElevationSection({ activity, distanceStream }: SectionProps) {
  const dark = useIsDark()
  const altitude = activity.streams.altitude
  const option = useMemo(() => {
    if (!altitude) return null
    const { stream, axis } = streamAxis(activity, distanceStream, altitude)
    return streamChart(stream, altitude, "#16a34a", "m", axis, dark)
  }, [activity, distanceStream, altitude, dark])
  if (!altitude) return null
  const present = altitude.filter((v): v is number => v != null)
  return (
    <Card title="Elevation">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard label="Gain" value={`${formatNumber(activity.elevation_m, 0)} m`} />
        <StatCard
          label="Min / Max"
          value={`${formatNumber(Math.min(...present), 0)} – ${formatNumber(Math.max(...present), 0)} m`}
        />
      </div>
      {option && <EChart option={option} height={220} />}
    </Card>
  )
}

function PowerSection({ activity, distanceStream }: SectionProps) {
  const dark = useIsDark()
  const watts = activity.streams.watts
  const option = useMemo(() => {
    if (!watts) return null
    const { stream, axis } = streamAxis(activity, distanceStream, watts)
    return streamChart(stream, watts, "#ca8a04", "W", axis, dark)
  }, [activity, distanceStream, watts, dark])
  if (activity.average_power == null) return null
  return (
    <Card title="Power">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard label="Average" value={`${activity.average_power} W`} />
        <StatCard label="Max" value={activity.max_power ? `${activity.max_power} W` : "-"} />
      </div>
      {option && <EChart option={option} height={220} />}
    </Card>
  )
}

function CadenceSection({ activity }: SectionProps) {
  if (activity.average_cadence == null) return null
  return (
    <Card title="Cadence">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Average" value={`${activity.average_cadence} rpm`} />
        <StatCard
          label="Maximum"
          value={activity.max_cadence ? `${activity.max_cadence} rpm` : "-"}
        />
      </div>
    </Card>
  )
}

function BestEffortsSection({ activity }: SectionProps) {
  if (activity.best_efforts.length === 0) return null
  return <BestEfforts activity={activity} />
}

function DetailsSection({ activity }: SectionProps) {
  return (
    <Card title="Details">
      <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        <div>
          <DetailRow label="Elapsed Time" value={formatDuration(activity.elapsed_time_s)} />
          <DetailRow label="Moving Time" value={formatDuration(activity.moving_time_s)} />
          <DetailRow
            label="Calories"
            value={activity.calories ? `${formatNumber(activity.calories, 0)} kcal` : null}
          />
          <DetailRow label="Sport" value={activity.sport_label} />
        </div>
        <div>
          <DetailRow label="Gear" value={activity.gear_name} />
          <DetailRow label="Device" value={activity.device_name} />
          <DetailRow
            label="Date"
            value={formatDate(activity.start_date_time, "EEEE, d MMMM yyyy 'at' HH:mm")}
          />
          <DetailRow label="Commute" value={activity.is_commute ? "Yes" : null} />
        </div>
      </div>
    </Card>
  )
}

export const SECTION_COMPONENTS: Record<ActivitySection, React.FC<SectionProps>> = {
  map: MapSection,
  hrCurve: HrCurveSection,
  heartRate: HeartRateSection,
  hrZones: HrZonesSection,
  pace: PaceSection,
  paceZones: PaceZonesSection,
  elevation: ElevationSection,
  power: PowerSection,
  cadence: CadenceSection,
  bestEfforts: BestEffortsSection,
  details: DetailsSection,
}
