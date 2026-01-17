"use client";

import { useState } from "react";
import type { EChartsOption } from "echarts";

import { EChart } from "@/components/charts/EChart";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import { useEddington } from "@/lib/api";
import { useAthleteContext } from "@/lib/athlete-context";
import { formatNumber } from "@/lib/format";
import type { EddingtonResult } from "@/lib/types";

export default function EddingtonPage() {
  const { athleteId } = useAthleteContext();
  const { data, error, isLoading } = useEddington(athleteId);
  const [activeTab, setActiveTab] = useState(0);

  if (isLoading) return <Spinner label="Computing Eddington numbers…" />;
  if (error) return <ErrorState />;
  if (!data || data.results.length === 0) {
    return <EmptyState message="Not enough distance-based activities to compute an Eddington number yet." />;
  }

  const active = data.results[Math.min(activeTab, data.results.length - 1)];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Eddington</h1>
        <p className="text-sm text-gray-500">
          Your Eddington number <strong>E</strong> means you have ridden at least <strong>E</strong> {data.unit} on{" "}
          <strong>E</strong> separate days.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {data.results.map((result, index) => (
          <button
            key={result.activity_type}
            onClick={() => setActiveTab(index)}
            className={
              index === activeTab
                ? "rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-white"
                : "rounded-full border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-100"
            }
          >
            {result.activity_type} · {result.number}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Eddington number" value={`${active.number} ${data.unit}`} accent />
        <StatCard
          label="Longest single day"
          value={`${formatNumber(active.longest_day)} ${data.unit}`}
        />
        <StatCard label="Next milestone" value={nextMilestoneLabel(active)} />
      </div>

      <Card title="Distance distribution">
        <EChart option={eddingtonChartOption(active, data.unit)} height={420} />
      </Card>

      {active.history.length > 0 && (
        <Card title="Eddington progression">
          <EChart option={historyChartOption(active)} height={280} />
        </Card>
      )}
    </div>
  );
}

function nextMilestoneLabel(result: EddingtonResult): string {
  const next = result.days_to_next.find((item) => item.distance === result.number + 1);
  if (!next) return "—";
  return `${next.days_needed} days → ${result.number + 1}`;
}

function eddingtonChartOption(result: EddingtonResult, unit: string): EChartsOption {
  const distances = result.times_completed.map((item) => item.distance);
  const counts = result.times_completed.map((item) => item.count);
  // The y = x reference line; its intersection with the bars is the Eddington number.
  const reference = distances.map((d) => d);

  return {
    grid: { left: 55, right: 20, top: 30, bottom: 60 },
    tooltip: { trigger: "axis" },
    legend: { data: ["Days completed", "Eddington line (y = x)"], top: 0, textStyle: { fontSize: 11 } },
    xAxis: {
      type: "category",
      data: distances,
      name: unit,
      nameLocation: "middle",
      nameGap: 32,
      axisLabel: { fontSize: 10 },
    },
    yAxis: { type: "value", name: "Days", axisLabel: { fontSize: 10 } },
    dataZoom: [{ type: "slider", start: 0, end: Math.min(100, (60 / distances.length) * 100) }],
    series: [
      {
        name: "Days completed",
        type: "bar",
        data: counts,
        itemStyle: { color: "#fc4c02", borderRadius: [2, 2, 0, 0] },
      },
      {
        name: "Eddington line (y = x)",
        type: "line",
        data: reference,
        showSymbol: false,
        lineStyle: { color: "#2563eb", type: "dashed", width: 2 },
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ xAxis: result.number }],
          lineStyle: { color: "#16a34a", width: 2 },
          label: { formatter: `E = ${result.number}`, position: "insideEndTop" },
        },
      },
    ],
  };
}

function historyChartOption(result: EddingtonResult): EChartsOption {
  return {
    grid: { left: 45, right: 20, top: 20, bottom: 40 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: result.history.map((item) => item.date),
      axisLabel: { fontSize: 10 },
    },
    yAxis: { type: "value", name: "E", axisLabel: { fontSize: 10 } },
    series: [
      {
        type: "line",
        step: "end",
        data: result.history.map((item) => item.number),
        showSymbol: false,
        lineStyle: { color: "#fc4c02", width: 2 },
        areaStyle: { color: "#fc4c02", opacity: 0.1 },
      },
    ],
  };
}
