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
import { colorForActivityType, formatDate, formatDuration, formatNumber } from "@/lib/format";
import type { ActivityDetail } from "@/lib/types";

const RouteMap = dynamic(() => import("@/components/map/RouteMap"), { ssr: false });

function streamChart(
  title: string,
  distance: (number | null)[],
  values: (number | null)[],
  color: string,
  unit: string,
): EChartsOption {
  const data = distance.map((d, index) => [d ? d / 1000 : 0, values[index]]);
  return {
    title: { text: title, left: 0, textStyle: { fontSize: 13, color: "#6b7280" } },
    grid: { left: 45, right: 15, top: 35, bottom: 30 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "value", name: "km", axisLabel: { fontSize: 10 } },
    yAxis: { type: "value", name: unit, axisLabel: { fontSize: 10 } },
    series: [
      {
        type: "line",
        data,
        showSymbol: false,
        smooth: true,
        lineStyle: { color, width: 1.5 },
        areaStyle: { color, opacity: 0.1 },
      },
    ],
  };
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

  return (
    <div className="space-y-6">
      <div>
        <Link href="/activities" className="text-sm text-brand hover:underline">
          ← Back to activities
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{activity.name}</h1>
        <p className="text-sm text-gray-500">
          {activity.sport_label} · {formatDate(activity.start_date_time, "EEEE yyyy-MM-dd 'at' HH:mm")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={`Distance (${distanceUnit})`} value={formatNumber(distance, 1)} accent />
        <StatCard label="Moving Time" value={formatDuration(activity.moving_time_s)} />
        <StatCard label="Elevation" value={`${formatNumber(activity.elevation_m, 0)} m`} />
        <StatCard
          label="Avg HR"
          value={activity.average_heart_rate ? `${activity.average_heart_rate} bpm` : "-"}
        />
      </div>

      {activity.polyline && (
        <Card title="Route">
          <RouteMap polyline={activity.polyline} color={color} height={360} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {activity.streams.altitude && (
          <Card>
            <EChart
              option={streamChart("Elevation", distanceStream, activity.streams.altitude, "#16a34a", "m")}
              height={220}
            />
          </Card>
        )}
        {activity.streams.heartrate && (
          <Card>
            <EChart
              option={streamChart("Heart rate", distanceStream, activity.streams.heartrate, "#dc2626", "bpm")}
              height={220}
            />
          </Card>
        )}
        {activity.streams.velocity_smooth && (
          <Card>
            <EChart
              option={streamChart(
                "Speed",
                distanceStream,
                activity.streams.velocity_smooth.map((v) => (v ? v * 3.6 : null)),
                "#2563eb",
                "km/h",
              )}
              height={220}
            />
          </Card>
        )}
        {activity.streams.watts && (
          <Card>
            <EChart
              option={streamChart("Power", distanceStream, activity.streams.watts, "#ca8a04", "W")}
              height={220}
            />
          </Card>
        )}
      </div>

      {activity.best_efforts.length > 0 && <BestEfforts activity={activity} />}
    </div>
  );
}

function BestEfforts({ activity }: { activity: ActivityDetail }) {
  return (
    <Card title="Best efforts">
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
