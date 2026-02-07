import type { EChartsOption } from "echarts"

import { formatNumber } from "@/lib/format"
import type { HrCurvePoint } from "@/lib/types"

/** Zone fill colours, indexed by zone number - 1 (5 zones). Shared by HR/pace zones. */
export const ZONE_COLORS = ["#9ca3af", "#3b82f6", "#22c55e", "#f97316", "#ef4444"]

/** A simple line-over-distance chart (distance in km on x, `values` on y). */
export function streamChart(
  distance: (number | null)[],
  values: (number | null)[],
  color: string,
  unit: string,
): EChartsOption {
  const data = distance.map((d, index) => [d ? d / 1000 : 0, values[index]])
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
        return `<strong>${formatNumber(val[1], 1)} ${unit}</strong><br/><span style="color:#9ca3af">${formatNumber(val[0], 2)} km</span>`
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
  const maxDuration = Math.max(...curve.map((p) => p.duration_s))
  const ticks = HR_CURVE_TICKS.filter((t) => t <= maxDuration * 1.1)
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
      min: toLog(ticks[0]),
      max: toLog(ticks[ticks.length - 1]),
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
