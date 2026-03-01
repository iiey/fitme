"use client"

import type { EChartsOption } from "echarts"
import { useMemo, useState } from "react"

import { EChart } from "@/components/charts/EChart"
import { themeColors } from "@/components/charts/options"
import { Card } from "@/components/ui/Card"
import { StatCard } from "@/components/ui/StatCard"
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States"
import { useEddington } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import type { EddingtonResult } from "@/lib/types"
import { useIsDark } from "@/lib/use-is-dark"

export function EddingtonDetailModal({
  athleteId,
  onClose,
}: {
  athleteId: string | null
  onClose: () => void
}) {
  const { data, error, isLoading } = useEddington(athleteId)
  const isDark = useIsDark()
  const [activeTab, setActiveTab] = useState(0)

  const active =
    data && data.results.length > 0
      ? data.results[Math.min(activeTab, data.results.length - 1)]
      : null

  const distributionOption = useMemo(
    () => (active && data ? eddingtonChartOption(active, data.unit, isDark) : null),
    [active, data, isDark],
  )
  const progressionOption = useMemo(
    () => (active && active.history.length > 0 ? historyChartOption(active, isDark) : null),
    [active, isDark],
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss is a mouse convenience; the dialog has a keyboard-accessible close button
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is a mouse convenience; the dialog has a keyboard-accessible close button
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="card flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 className="text-lg font-semibold">Eddington</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="overflow-y-auto p-5">
          {isLoading ? (
            <Spinner label="Computing Eddington numbers…" />
          ) : error ? (
            <ErrorState />
          ) : !active || !data ? (
            <EmptyState message="Not enough distance-based activities to compute an Eddington number yet." />
          ) : (
            <div className="space-y-6">
              <p className="text-sm text-gray-500">
                Your Eddington number <strong>E</strong> means you have ridden at least{" "}
                <strong>E</strong> {data.unit} on <strong>E</strong> separate days.
              </p>

              <div className="flex flex-wrap gap-2">
                {data.results.map((result, index) => (
                  <button
                    type="button"
                    key={result.activity_type}
                    onClick={() => setActiveTab(index)}
                    className={
                      index === activeTab
                        ? "rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-white"
                        : "rounded-full border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
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

              {distributionOption && (
                <Card title="Distance distribution">
                  <EChart option={distributionOption} height={420} />
                </Card>
              )}

              {progressionOption && (
                <Card title="Eddington progression">
                  <EChart option={progressionOption} height={280} />
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function nextMilestoneLabel(result: EddingtonResult): string {
  const next = result.days_to_next.find((item) => item.distance === result.number + 1)
  if (!next) return "—"
  return `${next.days_needed} days → ${result.number + 1}`
}

function eddingtonChartOption(result: EddingtonResult, unit: string, dark: boolean): EChartsOption {
  const t = themeColors(dark)
  const distances = result.times_completed.map((item) => item.distance)
  const counts = result.times_completed.map((item) => item.count)
  // The y = x reference line; its intersection with the bars is the Eddington number.
  const reference = distances.map((d) => d)

  return {
    grid: { left: 55, right: 20, top: 30, bottom: 60 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
    },
    legend: {
      data: ["Days completed", "Eddington line (y = x)"],
      top: 0,
      textStyle: { fontSize: 11, color: t.text },
    },
    xAxis: {
      type: "category",
      data: distances,
      name: unit,
      nameLocation: "middle",
      nameGap: 32,
      nameTextStyle: { color: t.axis },
      axisLabel: { fontSize: 10, color: t.axis },
    },
    yAxis: {
      type: "value",
      name: "Days",
      nameTextStyle: { color: t.axis },
      axisLabel: { fontSize: 10, color: t.axis },
      splitLine: { lineStyle: { color: t.splitLine } },
    },
    dataZoom: [{ type: "slider", start: 0, end: Math.min(100, (60 / distances.length) * 100) }],
    series: [
      {
        name: "Days completed",
        type: "bar",
        data: counts,
        itemStyle: { color: "#3b82f6", borderRadius: [2, 2, 0, 0] },
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
          label: { formatter: `E = ${result.number}`, position: "insideEndTop", color: t.text },
        },
      },
    ],
  }
}

function historyChartOption(result: EddingtonResult, dark: boolean): EChartsOption {
  const t = themeColors(dark)
  return {
    grid: { left: 45, right: 20, top: 20, bottom: 40 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
    },
    xAxis: {
      type: "category",
      data: result.history.map((item) => item.date),
      axisLabel: { fontSize: 10, color: t.axis },
    },
    yAxis: {
      type: "value",
      name: "E",
      nameTextStyle: { color: t.axis },
      axisLabel: { fontSize: 10, color: t.axis },
      splitLine: { lineStyle: { color: t.splitLine } },
    },
    series: [
      {
        type: "line",
        step: "end",
        data: result.history.map((item) => item.number),
        showSymbol: false,
        lineStyle: { color: "#3b82f6", width: 2 },
        areaStyle: { color: "#3b82f6", opacity: 0.1 },
      },
    ],
  }
}
