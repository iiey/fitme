import type { EChartsOption, MarkAreaComponentOption } from "echarts"

import type { TrainingLoadAnalysis } from "@/lib/types"

const LIGHT_TEXT = "#374151"
const DARK_TEXT = "#d1d5db"
const LIGHT_AXIS = "#6b7280"
const DARK_AXIS = "#9ca3af"
const LIGHT_TOOLTIP_BG = "#fff"
const DARK_TOOLTIP_BG = "#1f2937"
const LIGHT_TOOLTIP_BORDER = "#e5e7eb"
const DARK_TOOLTIP_BORDER = "#374151"
const LIGHT_SURFACE = "#ffffff"
const DARK_SURFACE = "#1c1e24"
// Grid (split) lines: visible enough to read values off in light mode, but a
// step lighter than the gray-300 card border so the card edge stays dominant.
const LIGHT_SPLIT = "#dadce0"
const DARK_SPLIT = "#2d333b"

export function themeColors(dark: boolean) {
  return {
    text: dark ? DARK_TEXT : LIGHT_TEXT,
    axis: dark ? DARK_AXIS : LIGHT_AXIS,
    tooltipBg: dark ? DARK_TOOLTIP_BG : LIGHT_TOOLTIP_BG,
    tooltipBorder: dark ? DARK_TOOLTIP_BORDER : LIGHT_TOOLTIP_BORDER,
    tooltipText: dark ? DARK_TEXT : LIGHT_TEXT,
    surface: dark ? DARK_SURFACE : LIGHT_SURFACE,
    splitLine: dark ? DARK_SPLIT : LIGHT_SPLIT,
  }
}

export function barChart(
  categories: string[],
  values: number[],
  color = "#3b82f6",
  unit = "",
  dark = false,
  showLabels = false,
  intensityGradient = false,
): EChartsOption {
  const t = themeColors(dark)
  const max = Math.max(0, ...values)
  // With intensityGradient on, each bar is coloured by its height: short bars
  // get a light, washed-out shade and tall bars a deep, saturated one, plus a
  // subtle vertical gradient so the columns read as more vivid and eye-catching.
  const seriesData = intensityGradient
    ? values.map((v) => {
        const ratio = max > 0 ? v / max : 0
        const base = sampleRamp([lighten(color, 0.5), color, darken(color, 0.35)], ratio)
        return {
          value: v,
          itemStyle: {
            color: verticalGradient(lighten(base, 0.25), base),
            borderRadius: [3, 3, 0, 0],
          },
        }
      })
    : values
  return {
    grid: { left: 50, right: 15, top: showLabels ? 28 : 15, bottom: 50 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => `${Number(v).toLocaleString()} ${unit}`,
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: { fontSize: 10, rotate: categories.length > 12 ? 45 : 0, color: t.axis },
    },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 10, color: t.axis },
      splitLine: { lineStyle: { color: t.splitLine } },
    },
    series: [
      {
        type: "bar",
        data: seriesData,
        itemStyle: intensityGradient ? undefined : { color, borderRadius: [3, 3, 0, 0] },
        label: showLabels
          ? {
              show: true,
              position: "top",
              fontSize: 10,
              color: t.text,
              formatter: "{c}",
            }
          : undefined,
      },
    ],
  }
}

// Indices of "sharp" local extrema: points whose curve rises steeply into them
// and falls steeply out (or vice versa). We score each interior extremum by the
// smaller of its two adjoining slopes, so a point only qualifies when *both*
// sides are steep. Mild/medium bumps score low and are skipped, which keeps the
// number of labels on the curve sparse.
function sharpPeakIndices(values: number[], threshold: number): number[] {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length < 3) return []
  const range = Math.max(...finite) - Math.min(...finite)
  if (range <= 0) return []

  const peaks: number[] = []
  for (let i = 1; i < values.length - 1; i++) {
    const prev = values[i - 1]
    const cur = values[i]
    const next = values[i + 1]
    if (![prev, cur, next].every(Number.isFinite)) continue

    const slopeIn = cur - prev
    const slopeOut = next - cur
    // Local maximum or minimum only (direction reverses at this point).
    if (slopeIn === 0 || slopeOut === 0 || Math.sign(slopeIn) === Math.sign(slopeOut)) continue

    // Prominence = the gentler of the two slopes, normalized to the data range.
    const prominence = Math.min(Math.abs(slopeIn), Math.abs(slopeOut)) / range
    if (prominence >= threshold) peaks.push(i)
  }
  return peaks
}

export function lineChart(
  categories: string[],
  values: number[],
  color = "#3b82f6",
  dark = false,
  yRange?: { min?: number; max?: number },
  opts: {
    // ECharts smoothing factor. `true` ~= 0.5; lower is closer to straight
    // segments. Defaults to a gentle 0.3 so curves read as trends, not blobs.
    smooth?: number | boolean
    // Mark sharp peaks/valleys with a small circle and a value label above.
    markPeaks?: boolean
    // Minimum normalized prominence (0-1) for a peak to be labelled.
    peakThreshold?: number
  } = {},
): EChartsOption {
  const t = themeColors(dark)
  const { smooth = 0.3, markPeaks = false, peakThreshold = 0.25 } = opts

  const peakSet = markPeaks ? new Set(sharpPeakIndices(values, peakThreshold)) : new Set<number>()
  // Per-point overrides only when marking peaks: peaks get a circle plus an
  // always-on label, every other point hides its symbol so the line stays
  // clean. (Series-level `showSymbol: false` would also suppress the labels,
  // so we keep symbols enabled and hide non-peak ones individually.)
  const data = markPeaks
    ? values.map((value, i) =>
        peakSet.has(i)
          ? {
              value,
              symbol: "circle",
              symbolSize: 7,
              itemStyle: { color: t.surface, borderColor: color, borderWidth: 2 },
              label: {
                show: true,
                position: "top" as const,
                fontSize: 10,
                fontWeight: "bold" as const,
                color: t.text,
                formatter: () => String(value),
              },
            }
          : { value, symbol: "none" as const },
      )
    : values

  return {
    grid: { left: 45, right: 15, top: 20, bottom: 40 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
    },
    xAxis: { type: "category", data: categories, axisLabel: { fontSize: 10, color: t.axis } },
    yAxis: {
      type: "value",
      min: yRange?.min,
      max: yRange?.max,
      axisLabel: { fontSize: 10, color: t.axis },
      splitLine: { lineStyle: { color: t.splitLine } },
    },
    series: [
      {
        type: "line",
        data,
        smooth,
        // When marking peaks, symbols are controlled per-point (and labels need
        // symbols enabled to render); otherwise hide them all.
        showSymbol: markPeaks,
        lineStyle: { color, width: 2 },
        areaStyle: { color, opacity: 0.12 },
      },
    ],
  }
}

// Curated [light, base] color pairs used to build vertical gradients so the
// charts read as polished rather than flat primary colors.
const GRADIENT_PALETTE: [string, string][] = [
  ["#60a5fa", "#2563eb"], // blue
  ["#34d399", "#059669"], // emerald
  ["#fbbf24", "#d97706"], // amber
  ["#f472b6", "#db2777"], // pink
  ["#a78bfa", "#7c3aed"], // violet
  ["#22d3ee", "#0891b2"], // cyan
  ["#fb923c", "#ea580c"], // orange
  ["#a3e635", "#65a30d"], // lime
]

function verticalGradient(light: string, base: string) {
  return {
    type: "linear" as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: light },
      { offset: 1, color: base },
    ],
  }
}

// Cold-to-hot ramp: low values render blue/cyan, high values orange/red.
const HEAT_RAMP = [
  "#3b82f6", // blue (cold)
  "#22d3ee", // cyan
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
  "#ef4444", // red (hot)
]

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(n).toString(16).padStart(2, "0")
  return `#${c(r)}${c(g)}${c(b)}`
}

// Sample a colour along a ramp; ratio is clamped to [0, 1].
function sampleRamp(ramp: string[], ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio))
  const scaled = clamped * (ramp.length - 1)
  const lo = Math.floor(scaled)
  const hi = Math.min(ramp.length - 1, lo + 1)
  const f = scaled - lo
  const [r1, g1, b1] = hexToRgb(ramp[lo])
  const [r2, g2, b2] = hexToRgb(ramp[hi])
  return rgbToHex(r1 + (r2 - r1) * f, g1 + (g2 - g1) * f, b1 + (b2 - b1) * f)
}

// Mix a colour toward white by `amount` (0 = unchanged, 1 = white).
function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount)
}

// Mix a colour toward black by `amount` (0 = unchanged, 1 = black).
function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount))
}

// Build an rgba() string from a hex colour and an alpha in [0, 1].
function hexA(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function donutChart(
  items: { name: string; value: number; color?: string }[],
  dark = false,
  options: { unit?: string } = {},
): EChartsOption {
  const t = themeColors(dark)
  const { unit = "" } = options

  return {
    tooltip: {
      trigger: "item",
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
      formatter: (params: unknown) => {
        const p = params as {
          marker: string
          name: string
          value: number
          percent: number
        }
        const suffix = unit ? ` ${unit}` : ""
        return `${p.marker}<b>${p.name}</b><br/>${p.value.toLocaleString()}${suffix} (${p.percent}%)`
      },
    },
    series: [
      {
        type: "pie",
        radius: ["40%", "64%"],
        center: ["50%", "50%"],
        avoidLabelOverlap: true,
        minAngle: 4,
        padAngle: 2,
        itemStyle: {
          borderColor: t.surface,
          borderWidth: 2,
          borderRadius: 6,
        },
        label: {
          show: true,
          alignTo: "edge",
          edgeDistance: 6,
          formatter: "{title|{b}}\n{value|{d}%}",
          rich: {
            title: { fontSize: 10, fontWeight: 600, color: t.text, lineHeight: 14 },
            value: { fontSize: 9, color: t.axis, lineHeight: 12 },
          },
        },
        labelLine: {
          length: 6,
          length2: 6,
          smooth: false,
          lineStyle: { color: t.axis },
        },
        emphasis: {
          scale: true,
          scaleSize: 6,
          itemStyle: { shadowBlur: 14, shadowColor: "rgba(0, 0, 0, 0.25)" },
        },
        data: items.map((item, i) => {
          const [light, base] = GRADIENT_PALETTE[i % GRADIENT_PALETTE.length]
          return {
            name: item.name,
            value: item.value,
            itemStyle: { color: item.color ?? verticalGradient(light, base) },
          }
        }),
      },
    ],
  }
}

export function weekdayAverageChart(
  items: { label: string; distance: number; count: number; averageHr?: number | null }[],
  unit = "km",
  dark = false,
): EChartsOption {
  const t = themeColors(dark)
  const categories = items.map((d) => d.label)
  const averages = items.map((d) =>
    d.count > 0 ? Math.round((d.distance / d.count) * 10) / 10 : 0,
  )
  const counts = items.map((d) => d.count)
  const hrs = items.map((d) => d.averageHr ?? null)

  // Colour each bar from cold (lowest average) to hot (highest average).
  const maxAvg = Math.max(...averages)
  const minAvg = Math.min(...averages)
  const span = maxAvg - minAvg || 1

  return {
    grid: { left: 45, right: 15, top: 30, bottom: 28 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
      formatter: (params: unknown) => {
        const list = params as { dataIndex: number }[]
        const i = Array.isArray(list) ? (list[0]?.dataIndex ?? 0) : 0
        const n = counts[i]
        const hr = hrs[i]
        let html =
          `<div style="font-weight:600;margin-bottom:4px">${categories[i]}</div>` +
          `<div>Average: <b>${averages[i].toLocaleString()} ${unit}</b></div>`
        if (hr != null) {
          html += `<div>Avg HR: <b>${hr} bpm</b></div>`
        }
        html += `<div style="color:${t.axis}">From ${n} ${n === 1 ? "activity" : "activities"}</div>`
        return html
      },
    },
    xAxis: {
      type: "category",
      data: categories,
      axisTick: { show: false },
      axisLabel: { fontSize: 11, color: t.axis },
    },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 10, color: t.axis },
      splitLine: { lineStyle: { color: t.splitLine } },
    },
    series: [
      {
        type: "bar",
        barWidth: "58%",
        data: averages.map((value) => {
          const base = sampleRamp(HEAT_RAMP, (value - minAvg) / span)
          return {
            value,
            itemStyle: {
              borderRadius: [5, 5, 0, 0],
              color: verticalGradient(lighten(base, 0.3), base),
            },
          }
        }),
        label: {
          show: true,
          position: "top",
          fontSize: 10,
          fontWeight: 600,
          color: t.text,
          formatter: "{c}",
        },
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowColor: "rgba(0, 0, 0, 0.2)" },
        },
      },
    ],
  }
}

// ── Training-load (fitness/fatigue/form) chart ──

export const FITNESS_COLOR = "#3b82f6" // blue
export const FATIGUE_COLOR = "#a855f7" // purple

// intervals.icu-style Form (TSB) zones, ordered fresh → fatigued. `from` is the
// inclusive lower bound; the band runs up to `to`.
export const FORM_ZONES = [
  {
    label: "Transition",
    color: "#f59e0b",
    from: 20,
    to: Infinity,
    note: "Very rested - fitness starts to fade",
  },
  { label: "Fresh", color: "#3b82f6", from: 5, to: 20, note: "Rested and ready to race" },
  {
    label: "Grey zone",
    color: "#9ca3af",
    from: -10,
    to: 5,
    note: "Maintaining - neither building nor resting",
  },
  {
    label: "Optimal",
    color: "#22c55e",
    from: -30,
    to: -10,
    note: "The sweet spot for building fitness",
  },
  {
    label: "High risk",
    color: "#ef4444",
    from: -Infinity,
    to: -30,
    note: "Overtraining risk - ease off",
  },
] as const

export type FormZone = (typeof FORM_ZONES)[number]

export function formZoneFor(tsb: number): FormZone {
  return FORM_ZONES.find((zone) => tsb >= zone.from && tsb < zone.to) ?? FORM_ZONES[2]
}

// |TSB| at which the Form colour reaches full intensity.
const TSB_INTENSITY_MAX = 30

// Colour for the TSB (Form) number: green when fresh (positive), red when
// fatigued (negative), deepening toward full intensity as the value moves away
// from zero. Light/dark ramps keep the bold number readable on either surface.
export function tsbColor(tsb: number, dark = false): string {
  const intensity = Math.min(1, Math.abs(tsb) / TSB_INTENSITY_MAX)
  const ramp =
    tsb >= 0
      ? dark
        ? ["#22c55e", "#4ade80"] // green-500 → green-400 (brighter = fresher)
        : ["#22c55e", "#166534"] // green-500 → green-800 (deeper = fresher)
      : dark
        ? ["#ef4444", "#f87171"] // red-500 → red-400 (brighter = more fatigued)
        : ["#ef4444", "#991b1b"] // red-500 → red-800 (deeper = more fatigued)
  return sampleRamp(ramp, intensity)
}

export function trainingLoadDetailChart(
  analysis: TrainingLoadAnalysis,
  dark = false,
  pinnedIndex: number | null = null,
): EChartsOption {
  const t = themeColors(dark)
  const labels = analysis.series.map((s) => s.date.slice(5))
  const fullDates = analysis.series.map((s) => s.date)
  const loads = analysis.series.map((s) => s.load)
  const ctls = analysis.series.map((s) => Math.round(s.ctl))
  const atls = analysis.series.map((s) => Math.round(s.atl))
  const tsbs = analysis.series.map((s) => Math.round(s.tsb))

  const tsbMin = Math.min(...tsbs, -35)
  const tsbMax = Math.max(...tsbs, 25)
  const formMin = Math.floor(tsbMin - 5)
  const formMax = Math.ceil(tsbMax + 5)

  const splitLineColor = t.splitLine
  const bandAlpha = dark ? 0.18 : 0.13

  // Horizontal coloured bands behind the Form line, clamped to the visible range.
  const formBands = FORM_ZONES.map((zone) => [
    {
      yAxis: zone.to === Infinity ? formMax : Math.min(zone.to, formMax),
      itemStyle: { color: hexA(zone.color, bandAlpha) },
    },
    { yAxis: zone.from === -Infinity ? formMin : Math.max(zone.from, formMin) },
  ])

  // Persistent vertical marker drawn at the pinned day so it stays put when the
  // mouse leaves the chart (the dashed axisPointer only shows on hover).
  const pinColor = dark ? "#e5e7eb" : "#334155"
  const pinMarkLine =
    pinnedIndex == null
      ? undefined
      : {
          silent: true,
          symbol: ["none", "none"] as [string, string],
          label: { show: false },
          lineStyle: { color: pinColor, width: 1.5, type: "solid" as const, opacity: 0.9 },
          data: [{ xAxis: pinnedIndex }],
        }

  const dot = (color: string) =>
    `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};margin-right:6px"></span>`

  return {
    grid: [
      { left: 52, right: 56, top: 30, height: "42%" },
      { left: 52, right: 56, top: "66%", bottom: 62 },
    ],
    legend: {
      top: 2,
      left: "center",
      data: ["Fitness", "Fatigue", "Daily load"],
      textStyle: { fontSize: 11, color: t.text },
      itemWidth: 14,
      itemHeight: 8,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: t.axis, width: 1 } },
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText, fontSize: 12 },
      formatter: (params: unknown) => {
        const list = params as { dataIndex: number }[]
        const i = Array.isArray(list) ? (list[0]?.dataIndex ?? 0) : 0
        const zone = formZoneFor(tsbs[i])
        return (
          `<div style="font-weight:600;margin-bottom:4px">${fullDates[i]}</div>` +
          `<div style="margin:2px 0">${dot(FITNESS_COLOR)}Fitness <b>${ctls[i]}</b></div>` +
          `<div style="margin:2px 0">${dot(FATIGUE_COLOR)}Fatigue <b>${atls[i]}</b></div>` +
          `<div style="margin:2px 0">${dot(zone.color)}Form <b>${tsbs[i]}</b> ` +
          `<span style="color:${t.axis}">${zone.label}</span></div>` +
          `<div style="margin:2px 0">${dot("#94a3b8")}Load <b>${loads[i]}</b></div>`
        )
      },
    },
    axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
    dataZoom: [
      // Require Ctrl for wheel-zoom so a plain wheel scrolls the page vertically.
      { type: "inside", xAxisIndex: [0, 1], zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false },
      {
        type: "slider",
        xAxisIndex: [0, 1],
        bottom: 8,
        height: 16,
        borderColor: "transparent",
        backgroundColor: dark ? "#1f242b" : "#f1f3f5",
        fillerColor: dark ? "rgba(59,130,246,0.18)" : "rgba(59,130,246,0.12)",
        handleStyle: { color: FITNESS_COLOR },
        moveHandleStyle: { color: FITNESS_COLOR },
        dataBackground: {
          lineStyle: { color: t.axis },
          areaStyle: { color: hexA(FITNESS_COLOR, 0.1) },
        },
        textStyle: { color: t.axis, fontSize: 9 },
      },
    ],
    xAxis: [
      {
        type: "category",
        data: labels,
        gridIndex: 0,
        boundaryGap: true,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: splitLineColor } },
      },
      {
        type: "category",
        data: labels,
        gridIndex: 1,
        boundaryGap: true,
        axisLabel: { fontSize: 9, color: t.axis, hideOverlap: true },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: splitLineColor } },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        position: "left",
        axisLabel: { fontSize: 10, color: t.axis },
        splitLine: { lineStyle: { color: splitLineColor } },
      },
      {
        type: "value",
        gridIndex: 0,
        position: "right",
        min: 0,
        axisLabel: { fontSize: 10, color: t.axis },
        splitLine: { show: false },
      },
      {
        type: "value",
        name: "Form",
        nameTextStyle: { fontSize: 10, color: t.axis, align: "left" },
        gridIndex: 1,
        position: "left",
        min: formMin,
        max: formMax,
        axisLabel: { fontSize: 10, color: t.axis },
        splitLine: { show: false },
      },
    ],
    visualMap: {
      show: false,
      type: "piecewise",
      seriesIndex: 3,
      dimension: 1,
      pieces: [
        { gt: 20, color: "#f59e0b" },
        { gt: 5, lte: 20, color: "#3b82f6" },
        { gt: -10, lte: 5, color: "#9ca3af" },
        { gt: -30, lte: -10, color: "#22c55e" },
        { lte: -30, color: "#ef4444" },
      ],
    },
    series: [
      {
        name: "Fitness",
        type: "line",
        data: ctls,
        xAxisIndex: 0,
        yAxisIndex: 0,
        smooth: true,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 7,
        z: 5,
        lineStyle: { color: FITNESS_COLOR, width: 2.5 },
        itemStyle: { color: FITNESS_COLOR },
        areaStyle: {
          color: verticalGradient(hexA(FITNESS_COLOR, 0.28), hexA(FITNESS_COLOR, 0.01)),
        },
        markLine: pinMarkLine,
      },
      {
        name: "Fatigue",
        type: "line",
        data: atls,
        xAxisIndex: 0,
        yAxisIndex: 0,
        smooth: true,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 7,
        z: 6,
        lineStyle: { color: FATIGUE_COLOR, width: 2 },
        itemStyle: { color: FATIGUE_COLOR },
      },
      {
        name: "Daily load",
        type: "bar",
        data: loads,
        xAxisIndex: 0,
        yAxisIndex: 1,
        z: 2,
        barWidth: "55%",
        itemStyle: {
          color: dark ? "rgba(148,163,184,0.40)" : "rgba(148,163,184,0.50)",
          borderRadius: [2, 2, 0, 0],
        },
      },
      {
        name: "Form",
        type: "line",
        data: tsbs,
        xAxisIndex: 1,
        yAxisIndex: 2,
        smooth: true,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { width: 2.5 },
        markArea: {
          silent: true,
          data: formBands as MarkAreaComponentOption["data"],
        },
        markLine: pinMarkLine,
      },
    ],
  }
}

const HR_ZONE_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444"]

export function hrZoneBarChart(zones: number[], unit = "h", dark = false): EChartsOption {
  const t = themeColors(dark)
  const labels = ["Z1", "Z2", "Z3", "Z4", "Z5"]
  return {
    grid: { left: 50, right: 15, top: 15, bottom: 50 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => `${Number(v).toLocaleString()} ${unit}`,
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { fontSize: 10, color: t.axis },
    },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 10, color: t.axis },
      splitLine: { lineStyle: { color: t.splitLine } },
    },
    series: [
      {
        type: "bar",
        data: zones.map((v, i) => ({
          value: v,
          itemStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 1,
              x2: 0,
              y2: 0,
              colorStops: [
                { offset: 0, color: `${HR_ZONE_COLORS[i]}88` },
                { offset: 1, color: HR_ZONE_COLORS[i] },
              ],
            },
            borderRadius: [4, 4, 0, 0],
          },
        })),
      },
    ],
  }
}

const YEAR_PALETTE = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#8b5cf6", "#6b7280"]
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

export function yearlyStatsChart(
  monthlyStats: { period: string; distance: number; count: number }[],
  unit: string,
  dark = false,
): EChartsOption {
  const t = themeColors(dark)

  const byYear = new Map<number, { month: number; distance: number; count: number }[]>()
  for (const m of monthlyStats) {
    const year = parseInt(m.period.slice(0, 4), 10)
    const month = parseInt(m.period.slice(5, 7), 10)
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year)?.push({ month, distance: m.distance, count: m.count })
  }

  const years = Array.from(byYear.keys()).sort((a, b) => b - a)

  // Only show the last 5 years by default; older ones are toggled off.
  const selected: Record<string, boolean> = {}
  for (let i = 0; i < years.length; i++) {
    selected[String(years[i])] = i < 5
  }

  // Per-year, per-month activity counts so the tooltip can report how many
  // activities produced each month's cumulative distance. Keyed by the series
  // name (the year) to match what the axis-trigger tooltip hands back.
  const countsByYear: Record<string, (number | null)[]> = {}

  const series: EChartsOption["series"] = years.map((year, i) => {
    const months = (byYear.get(year) ?? []).sort((a, b) => a.month - b.month)
    const cumulative = new Array(12).fill(null) as (number | null)[]
    const counts = new Array(12).fill(null) as (number | null)[]
    // Months with real activity data get an always-on km label; forward-filled
    // months stay unlabelled so flat stretches don't repeat the same number.
    const hasData = new Array(12).fill(false) as boolean[]
    let sum = 0
    for (const m of months) {
      sum += m.distance
      cumulative[m.month - 1] = Math.round(sum)
      counts[m.month - 1] = m.count
      hasData[m.month - 1] = true
    }
    // Fill forward nulls within the range
    const lastMonth = months[months.length - 1]?.month ?? 0
    for (let j = 0; j < lastMonth; j++) {
      if (cumulative[j] === null && j > 0) {
        cumulative[j] = cumulative[j - 1]
        counts[j] = 0
      }
    }
    countsByYear[String(year)] = counts

    const color = YEAR_PALETTE[i % YEAR_PALETTE.length]
    return {
      name: String(year),
      type: "line" as const,
      // Real-data months show a circle + always-on km label; forward-filled
      // months hide both so flat stretches stay clean. Symbols must stay
      // enabled at the series level or the labels won't render either.
      data: cumulative.map((value, idx) =>
        hasData[idx]
          ? { value, itemStyle: { color: t.surface, borderColor: color, borderWidth: 2 } }
          : { value, symbol: "none" as const, label: { show: false } },
      ),
      smooth: 0.4,
      showSymbol: true,
      symbol: "circle",
      symbolSize: 6,
      label: {
        show: true,
        position: "top" as const,
        fontSize: 10,
        color: t.text,
        // Only real-data points keep their label (see per-item show below), so
        // the value is always numeric here; {c} renders the cumulative km.
        formatter: "{c}",
      },
      emphasis: { focus: "series" as const, itemStyle: { borderWidth: 2 } },
      lineStyle: { color, width: 2.5 },
      itemStyle: { color },
    }
  })

  return {
    grid: { left: 55, right: 20, top: 50, bottom: 65 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText, fontSize: 12 },
      formatter: (params: unknown) => {
        const list = params as {
          seriesName: string
          value: number | null
          color: string
          dataIndex: number
        }[]
        if (!Array.isArray(list) || list.length === 0) return ""
        const month = MONTH_LABELS[list[0]?.dataIndex ?? 0] ?? ""
        let html = `<div style="font-weight:600;margin-bottom:4px">${month}</div>`
        for (const item of list) {
          if (item.value == null) continue
          // The cumulative km is already labelled on the curve; the tooltip
          // instead reports how many activities that month contributed.
          const count = countsByYear[item.seriesName]?.[item.dataIndex] ?? 0
          html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">`
          html += `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${item.color}"></span>`
          html += `<span>${item.seriesName}</span>`
          html += `<span style="margin-left:auto;font-weight:600">${count} ${count === 1 ? "activity" : "activities"}</span>`
          html += `</div>`
        }
        return html
      },
    },
    legend: {
      top: 5,
      textStyle: { fontSize: 12, color: t.text },
      itemWidth: 16,
      itemHeight: 8,
      selected,
    },
    xAxis: {
      type: "category",
      data: MONTH_LABELS,
      boundaryGap: false,
      axisLabel: { fontSize: 11, color: t.axis },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 10,
        color: t.axis,
        formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k${unit}` : `${v}${unit}`),
      },
      splitLine: { lineStyle: { color: t.splitLine } },
    },
    dataZoom: [
      {
        type: "slider",
        bottom: 8,
        height: 20,
        startValue: 0,
        endValue: 11,
        textStyle: { color: t.axis },
      },
    ],
    series,
  }
}
