import type { EChartsOption } from "echarts"

import { formatNumber } from "@/lib/format"
import type { HrCurvePoint } from "@/lib/types"

/** Zone fill colours, indexed by zone number - 1 (5 zones). Shared by HR/pace zones. */
export const ZONE_COLORS = ["#9ca3af", "#3b82f6", "#22c55e", "#f97316", "#ef4444"]

/** X-axis a stream chart can be plotted against. */
export type StreamAxis = "distance" | "time"

/**
 * A simple line chart of `values` over either distance (km) or elapsed time.
 *
 * Distance is only meaningful for sports that record GPS distance; indoor /
 * cardio sessions have no distance (or an all-zero stream) and would collapse
 * every sample onto x=0, so callers plot those over the `time` axis instead.
 * `axisStream` carries the matching raw values: metres for "distance", seconds
 * for "time".
 */
export function streamChart(
  axisStream: (number | null)[],
  values: (number | null)[],
  color: string,
  unit: string,
  axis: StreamAxis = "distance",
): EChartsOption {
  const data =
    axis === "distance"
      ? axisStream.map((d, index) => [d ? d / 1000 : 0, values[index]])
      : axisStream.map((t, index) => [t ?? 0, values[index]])
  const formatX = (x: number) =>
    axis === "distance" ? `${formatNumber(x, 2)} km` : formatWindowLabel(x)
  return {
    grid: { left: 50, right: 20, top: 12, bottom: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.95)",
      borderColor: "#e5e7eb",
      textStyle: { color: "#374151", fontSize: 12 },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params
        const val = (p as { value: [number, number] }).value
        return `<strong>${formatNumber(val[1], 1)} ${unit}</strong><br/><span style="color:#9ca3af">${formatX(val[0])}</span>`
      },
    },
    xAxis: {
      type: "value",
      name: axis === "distance" ? "km" : "time",
      nameLocation: "middle",
      nameGap: 22,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: {
        fontSize: 10,
        color: "#9ca3af",
        ...(axis === "time" ? { formatter: (v: number) => formatWindowLabel(v) } : {}),
      },
      axisLine: { lineStyle: { color: "#e5e7eb" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: unit,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: { fontSize: 10, color: "#9ca3af" },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "#dadce0", type: "dashed" } },
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
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: color + "40" },
              { offset: 1, color: color + "05" },
            ],
          } as unknown as string,
        },
      },
    ],
  }
}

/** A named series to overlay in {@link multiStreamChart}. */
export type StreamSeries = {
  name: string
  values: (number | null)[]
  color: string
}

/**
 * Overlay several named line series on one shared distance/time axis - used to
 * compare e.g. raw pace against grade-adjusted pace on a single graph. A legend
 * is rendered so the curves can be told apart; area fills are dropped because
 * overlapping translucent fills muddy the comparison.
 */
export function multiStreamChart(
  axisStream: (number | null)[],
  series: StreamSeries[],
  unit: string,
  axis: StreamAxis = "distance",
): EChartsOption {
  const formatX = (x: number) =>
    axis === "distance" ? `${formatNumber(x, 2)} km` : formatWindowLabel(x)
  const toPoint = (value: number | null, index: number): [number, number | null] =>
    axis === "distance"
      ? [axisStream[index] ? (axisStream[index] as number) / 1000 : 0, value]
      : [axisStream[index] ?? 0, value]
  return {
    grid: { left: 50, right: 20, top: 28, bottom: 36 },
    legend: {
      top: 0,
      right: 0,
      data: series.map((s) => s.name),
      textStyle: { fontSize: 11, color: "#9ca3af" },
      itemWidth: 14,
      itemHeight: 8,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.95)",
      borderColor: "#e5e7eb",
      textStyle: { color: "#374151", fontSize: 12 },
      formatter: (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as {
          value: [number, number]
          marker: string
          seriesName: string
        }[]
        if (list.length === 0) return ""
        const rows = list
          .map(
            (p) =>
              `${p.marker}${p.seriesName} <strong>${formatNumber(p.value[1], 1)} ${unit}</strong>`,
          )
          .join("<br/>")
        return `${rows}<br/><span style="color:#9ca3af">${formatX(list[0].value[0])}</span>`
      },
    },
    xAxis: {
      type: "value",
      name: axis === "distance" ? "km" : "time",
      nameLocation: "middle",
      nameGap: 22,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: {
        fontSize: 10,
        color: "#9ca3af",
        ...(axis === "time" ? { formatter: (v: number) => formatWindowLabel(v) } : {}),
      },
      axisLine: { lineStyle: { color: "#e5e7eb" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: unit,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: { fontSize: 10, color: "#9ca3af" },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "#dadce0", type: "dashed" } },
    },
    series: series.map((s) => ({
      name: s.name,
      type: "line",
      data: s.values.map(toPoint),
      showSymbol: false,
      smooth: 0.3,
      lineStyle: { color: s.color, width: 1.5 },
      itemStyle: { color: s.color },
    })),
  }
}

/** Format a window length (seconds) compactly: "15s", "5m", "1.5h". */
export function formatWindowLabel(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hours = seconds / 3600
  return hours % 1 === 0 ? `${hours}h` : `${hours.toFixed(1)}h`
}

export const HR_CURVE_HELP =
  "Highest average heart rate you sustained for each window length.\n\n" +
  "How to read:\n" +
  "• Left (short windows) ≈ your peak HR.\n" +
  "• Right (long windows) ≈ your average HR.\n" +
  "• It always slopes down by definition - it does NOT mean HR fell during the run.\n\n" +
  "Use it: a higher curve = a harder, more sustained effort. Compare the 5–60 min range across runs to gauge fitness or fatigue.\n\n" +
  "It shows WHAT you sustained, not WHEN."

const HR_CURVE_TICKS = [1, 5, 15, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 10800]

/** Mean-maximal HR curve: best sustained average HR vs window duration (log x). */
export function hrCurveChart(curve: HrCurvePoint[]): EChartsOption {
  const color = "#dc2626"
  // Start the axis at the first window the curve actually has data for. Streams
  // are downsampled, so the backend drops sub-resolution windows (often the 1-2s
  // points); anchoring at a fixed 1s would render a flat, data-less lead-in.
  const durations = curve.map((p) => p.duration_s)
  const minDuration = durations.length ? Math.min(...durations) : HR_CURVE_TICKS[0]
  const maxDuration = Math.max(...durations)
  const ticks = HR_CURVE_TICKS.filter((t) => t >= minDuration && t <= maxDuration * 1.1)
  const toLog = (v: number) => Math.log10(v)
  const data = curve.map((p) => [toLog(p.duration_s), p.bpm])
  return {
    grid: { left: 50, right: 20, top: 12, bottom: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.95)",
      borderColor: "#e5e7eb",
      textStyle: { color: "#374151", fontSize: 12 },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params
        const val = (p as { value: [number, number] }).value
        const seconds = 10 ** val[0]
        return `<strong>${Math.round(val[1])} bpm</strong><br/><span style="color:#9ca3af">best average over ${formatWindowLabel(seconds)}</span>`
      },
    },
    xAxis: {
      type: "value",
      name: "duration",
      nameLocation: "middle",
      nameGap: 22,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      min: toLog(minDuration),
      max: toLog(ticks[ticks.length - 1] ?? maxDuration),
      axisLabel: {
        fontSize: 10,
        color: "#9ca3af",
        customValues: ticks.map(toLog),
        formatter: (value: number) => formatWindowLabel(Math.round(10 ** value)),
      },
      axisTick: { show: true, customValues: ticks.map(toLog) },
      axisLine: { lineStyle: { color: "#e5e7eb" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "bpm",
      scale: true,
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: { fontSize: 10, color: "#9ca3af" },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "#dadce0", type: "dashed" } },
    },
    series: [
      {
        type: "line",
        data,
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { color, width: 2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: color + "40" },
              { offset: 1, color: color + "05" },
            ],
          } as unknown as string,
        },
      },
    ],
  }
}
