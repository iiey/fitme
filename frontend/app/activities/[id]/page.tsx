"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { use } from "react";
import type { EChartsOption } from "echarts";

import { EChart } from "@/components/charts/EChart";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { ErrorState, Spinner } from "@/components/ui/States";
import { useActivity, useMeta } from "@/lib/api";
import { useAthleteContext } from "@/lib/athlete-context";
import {
  colorForActivityType,
  formatActivityPace,
  formatDate,
  formatDuration,
  formatNumber,
} from "@/lib/format";
import type { ActivityDetail, HrZoneItem } from "@/lib/types";

const RouteMap = dynamic(() => import("@/components/map/RouteMap"), { ssr: false });

function streamChart(
  distance: (number | null)[],
  values: (number | null)[],
  color: string,
  unit: string,
): EChartsOption {
  const data = distance.map((d, index) => [d ? d / 1000 : 0, values[index]]);
  return {
    grid: { left: 50, right: 20, top: 12, bottom: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.95)",
      borderColor: "#e5e7eb",
      textStyle: { color: "#374151", fontSize: 12 },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params;
        const val = (p as { value: [number, number] }).value;
        return `<strong>${formatNumber(val[1], 1)} ${unit}</strong><br/><span style="color:#9ca3af">${formatNumber(val[0], 2)} km</span>`;
      },
    },
    xAxis: {
      type: "value",
      name: "km",
      nameLocation: "middle",
      nameGap: 22,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: { fontSize: 10, color: "#9ca3af" },
      axisLine: { lineStyle: { color: "#e5e7eb" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: unit,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: { fontSize: 10, color: "#9ca3af" },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "#f3f4f6", type: "dashed" } },
    },
    series: [
      {
        type: "line",
        data,
        showSymbol: false,
        smooth: 0.3,
        lineStyle: { color, width: 1.5 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: color + "40" },
              { offset: 1, color: color + "05" },
            ],
          } as unknown as string,
        },
      },
    ],
  };
}

const ZONE_COLORS = ["#9ca3af", "#3b82f6", "#22c55e", "#f97316", "#ef4444"];

function HrZones({ zones }: { zones: HrZoneItem[] }) {
  const maxPct = Math.max(...zones.map((z) => z.percentage), 1);
  return (
    <div className="space-y-2.5">
      {[...zones].reverse().map((z) => (
        <div key={z.zone} className="flex items-center gap-3">
          <div className="w-28 shrink-0">
            <div className="text-sm font-semibold">
              Zone {z.zone}
              <span className="ml-1.5 font-normal text-gray-400 text-xs">
                {z.upper_bpm ? `${z.lower_bpm}–${z.upper_bpm}` : `> ${z.lower_bpm}`} bpm
              </span>
            </div>
            <div className="text-xs text-gray-400">{z.label}</div>
          </div>
          <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max((z.percentage / maxPct) * 100, 1)}%`,
                backgroundColor: ZONE_COLORS[z.zone - 1],
              }}
            />
          </div>
          <div className="w-16 text-right text-sm tabular-nums">
            {formatDuration(z.seconds)}
          </div>
          <div className="w-10 text-right text-sm font-medium tabular-nums">
            {z.percentage}%
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || value === "-") return null;
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export default function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { athleteId } = useAthleteContext();
  const { data: activity, error, isLoading } = useActivity(athleteId, id);
  const { data: meta } = useMeta(athleteId);

  if (isLoading) return <Spinner label="Loading activity…" />;
  if (error || !activity) return <ErrorState message="Activity not found." />;

  const distanceUnit = meta?.distance_unit ?? "km";
  const distance = distanceUnit === "mi" ? activity.distance_mi : activity.distance_km;
  const color = colorForActivityType(activity.activity_type);
  const distanceStream = activity.streams.distance ?? [];

  const hasHr = activity.average_heart_rate != null;
  const hasCadence = activity.average_cadence != null;
  const hasPower = activity.average_power != null;

  return (
    <div className="space-y-6">
      {/* Header */}
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

      {/* Primary stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={`Distance (${distanceUnit})`} value={formatNumber(distance, 2)} accent />
        <StatCard label="Moving Time" value={formatDuration(activity.moving_time_s)} />
        <StatCard label="Pace / Speed" value={formatActivityPace(activity)} />
        <StatCard label="Elevation" value={`${formatNumber(activity.elevation_m, 0)} m`} />
      </div>

      {/* Route map */}
      {activity.polyline && (
        <Card title="Route">
          <RouteMap polyline={activity.polyline} color={color} height={360} />
        </Card>
      )}

      {/* Heart Rate + HR Zones row */}
      {hasHr && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Heart Rate">
            <div className="mb-4 grid grid-cols-2 gap-3">
              <StatCard label="Average" value={`${activity.average_heart_rate} bpm`} />
              <StatCard label="Maximum" value={activity.max_heart_rate ? `${activity.max_heart_rate} bpm` : "-"} />
            </div>
            {activity.streams.heartrate && (
              <EChart
                option={streamChart(distanceStream, activity.streams.heartrate, "#dc2626", "bpm")}
                height={220}
              />
            )}
          </Card>
          {activity.hr_zones && activity.hr_zones.length > 0 && (
            <Card title="Time in Heart Rate Zones">
              <HrZones zones={activity.hr_zones} />
            </Card>
          )}
        </div>
      )}

      {/* Speed + Elevation row */}
      {(activity.streams.velocity_smooth || activity.streams.altitude) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {activity.streams.velocity_smooth && (
            <Card title="Speed">
              <div className="mb-4 grid grid-cols-2 gap-3">
                <StatCard label="Average" value={formatActivityPace(activity)} />
                <StatCard
                  label="Max Speed"
                  value={activity.max_speed_kmh ? `${formatNumber(activity.max_speed_kmh, 1)} km/h` : "-"}
                />
              </div>
              <EChart
                option={streamChart(
                  distanceStream,
                  activity.streams.velocity_smooth.map((v) => (v ? v * 3.6 : null)),
                  "#2563eb",
                  "km/h",
                )}
                height={220}
              />
            </Card>
          )}
          {activity.streams.altitude && (
            <Card title="Elevation">
              <div className="mb-4 grid grid-cols-2 gap-3">
                <StatCard label="Gain" value={`${formatNumber(activity.elevation_m, 0)} m`} />
                <StatCard
                  label="Min / Max"
                  value={`${formatNumber(Math.min(...activity.streams.altitude.filter((v): v is number => v != null)), 0)} – ${formatNumber(Math.max(...activity.streams.altitude.filter((v): v is number => v != null)), 0)} m`}
                />
              </div>
              <EChart
                option={streamChart(distanceStream, activity.streams.altitude, "#16a34a", "m")}
                height={220}
              />
            </Card>
          )}
        </div>
      )}

      {/* Power section */}
      {hasPower && (
        <Card title="Power">
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Average" value={`${activity.average_power} W`} />
            <StatCard label="Max" value={activity.max_power ? `${activity.max_power} W` : "-"} />
            <StatCard
              label="Normalized"
              value={activity.normalized_power ? `${formatNumber(activity.normalized_power, 0)} W` : "-"}
            />
          </div>
          {activity.streams.watts && (
            <EChart
              option={streamChart(distanceStream, activity.streams.watts, "#ca8a04", "W")}
              height={220}
            />
          )}
        </Card>
      )}

      {/* Cadence section */}
      {hasCadence && (
        <Card title="Cadence">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Average" value={`${activity.average_cadence} rpm`} />
            <StatCard label="Maximum" value={activity.max_cadence ? `${activity.max_cadence} rpm` : "-"} />
          </div>
        </Card>
      )}

      {/* Best efforts */}
      {activity.best_efforts.length > 0 && <BestEfforts activity={activity} />}

      {/* Additional details */}
      <Card title="Details">
        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          <div>
            <DetailRow label="Elapsed Time" value={formatDuration(activity.elapsed_time_s)} />
            <DetailRow label="Moving Time" value={formatDuration(activity.moving_time_s)} />
            <DetailRow label="Calories" value={activity.calories ? `${formatNumber(activity.calories, 0)} kcal` : null} />
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
    </div>
  );
}

function BestEfforts({ activity }: { activity: ActivityDetail }) {
  return (
    <Card title="Best Efforts">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {activity.best_efforts.map((effort) => (
          <div key={effort.distance_m} className="rounded-lg bg-surface-muted p-3">
            <p className="text-xs uppercase text-gray-500">{effort.label}</p>
            <p className="text-lg font-semibold">{formatDuration(effort.time_s)}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
