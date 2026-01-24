import type { EChartsOption } from "echarts";

import type { TrainingLoadAnalysis } from "@/lib/types";

const LIGHT_TEXT = "#374151";
const DARK_TEXT = "#d1d5db";
const LIGHT_AXIS = "#6b7280";
const DARK_AXIS = "#9ca3af";
const LIGHT_TOOLTIP_BG = "#fff";
const DARK_TOOLTIP_BG = "#1f2937";
const LIGHT_TOOLTIP_BORDER = "#e5e7eb";
const DARK_TOOLTIP_BORDER = "#374151";
const LIGHT_SURFACE = "#ffffff";
const DARK_SURFACE = "#1c1e24";

function themeColors(dark: boolean) {
  return {
    text: dark ? DARK_TEXT : LIGHT_TEXT,
    axis: dark ? DARK_AXIS : LIGHT_AXIS,
    tooltipBg: dark ? DARK_TOOLTIP_BG : LIGHT_TOOLTIP_BG,
    tooltipBorder: dark ? DARK_TOOLTIP_BORDER : LIGHT_TOOLTIP_BORDER,
    tooltipText: dark ? DARK_TEXT : LIGHT_TEXT,
    surface: dark ? DARK_SURFACE : LIGHT_SURFACE,
  };
}

export function barChart(
  categories: string[],
  values: number[],
  color = "#fc4c02",
  unit = "",
  dark = false,
  showLabels = false,
): EChartsOption {
  const t = themeColors(dark);
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
    yAxis: { type: "value", axisLabel: { fontSize: 10, color: t.axis } },
    series: [
      {
        type: "bar",
        data: values,
        itemStyle: { color, borderRadius: [3, 3, 0, 0] },
        label: showLabels
          ? {
              show: true,
              position: "top",
              fontSize: 10,
              color: t.text,
              formatter: unit ? `{c} ${unit}` : "{c}",
            }
          : undefined,
      },
    ],
  };
}

export function lineChart(
  categories: string[],
  values: number[],
  color = "#fc4c02",
  dark = false,
): EChartsOption {
  const t = themeColors(dark);
  return {
    grid: { left: 45, right: 15, top: 15, bottom: 40 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
    },
    xAxis: { type: "category", data: categories, axisLabel: { fontSize: 10, color: t.axis } },
    yAxis: { type: "value", axisLabel: { fontSize: 10, color: t.axis } },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        showSymbol: false,
        lineStyle: { color, width: 2 },
        areaStyle: { color, opacity: 0.12 },
      },
    ],
  };
}

export function donutChart(
  items: { name: string; value: number; color?: string }[],
  dark = false,
): EChartsOption {
  const t = themeColors(dark);
  return {
    tooltip: {
      trigger: "item",
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
    },
    legend: {
      bottom: 0,
      type: "scroll",
      textStyle: { fontSize: 11, color: t.text },
      pageTextStyle: { color: t.axis },
      pageIconColor: t.axis,
      pageIconInactiveColor: dark ? "#4b5563" : "#d1d5db",
    },
    series: [
      {
        type: "pie",
        radius: ["45%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: t.surface, borderWidth: 2 },
        label: { show: false },
        data: items.map((item) => ({
          name: item.name,
          value: item.value,
          itemStyle: item.color ? { color: item.color } : undefined,
        })),
      },
    ],
  };
}

export function trainingLoadDetailChart(analysis: TrainingLoadAnalysis, dark = false): EChartsOption {
  const t = themeColors(dark);
  const dates = analysis.series.map((s) => s.date.slice(5));
  const loads = analysis.series.map((s) => s.load);
  const ctls = analysis.series.map((s) => s.ctl);
  const atls = analysis.series.map((s) => s.atl);
  const tsbs = analysis.series.map((s) => s.tsb);

  const tsbMin = Math.min(...tsbs, -35);
  const tsbMax = Math.max(...tsbs, 25);

  return {
    grid: [
      { left: 50, right: 50, top: 40, bottom: "38%" },
      { left: 50, right: 50, top: "70%", bottom: 40 },
    ],
    legend: {
      top: 5,
      data: ["CTL (Fitness)", "ATL (Fatigue)", "TSB (Form)", "Daily Load"],
      textStyle: { fontSize: 11, color: t.text },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText },
    },
    axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
    dataZoom: [
      {
        type: "slider",
        xAxisIndex: [0, 1],
        bottom: 8,
        height: 20,
        startValue: Math.max(0, dates.length - 42),
        endValue: dates.length - 1,
      },
    ],
    xAxis: [
      {
        type: "category",
        data: dates,
        gridIndex: 0,
        axisLabel: { show: false },
        axisTick: { show: false },
      },
      {
        type: "category",
        data: dates,
        gridIndex: 1,
        axisLabel: { fontSize: 10, color: t.axis },
      },
    ],
    yAxis: [
      {
        type: "value",
        name: "Load (CTL/ATL)",
        gridIndex: 0,
        position: "left",
        axisLabel: { fontSize: 10, color: t.axis },
        nameTextStyle: { fontSize: 10, color: t.axis },
      },
      {
        type: "value",
        name: "Form (TSB)",
        gridIndex: 0,
        position: "right",
        min: Math.floor(tsbMin - 5),
        max: Math.ceil(tsbMax + 5),
        axisLabel: { fontSize: 10, color: t.axis },
        nameTextStyle: { fontSize: 10, color: t.axis },
        splitLine: { show: false },
      },
      {
        type: "value",
        name: "Daily Load",
        gridIndex: 1,
        axisLabel: { fontSize: 10, color: t.axis },
        nameTextStyle: { fontSize: 10, color: t.axis },
      },
    ],
    series: [
      {
        name: "CTL (Fitness)",
        type: "line",
        data: ctls,
        xAxisIndex: 0,
        yAxisIndex: 0,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: "#2563eb", width: 2 },
        itemStyle: { color: "#2563eb" },
      },
      {
        name: "ATL (Fatigue)",
        type: "line",
        data: atls,
        xAxisIndex: 0,
        yAxisIndex: 0,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: "#16a34a", width: 2 },
        itemStyle: { color: "#16a34a" },
      },
      {
        name: "TSB (Form)",
        type: "line",
        data: tsbs,
        xAxisIndex: 0,
        yAxisIndex: 1,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: "#f59e0b", width: 2 },
        itemStyle: { color: "#f59e0b" },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", width: 1 },
          label: { fontSize: 9, position: "end" },
          data: [
            { yAxis: 15, lineStyle: { color: "#16a34a" }, label: { formatter: "Taper sweet-spot (+15)" } },
            { yAxis: -10, lineStyle: { color: "#6b7280" }, label: { formatter: "Build zone (−10)" } },
            { yAxis: -30, lineStyle: { color: "#dc2626" }, label: { formatter: "Over-fatigued (−30)" } },
          ],
        },
      },
      {
        name: "Daily Load",
        type: "bar",
        data: loads,
        xAxisIndex: 1,
        yAxisIndex: 2,
        itemStyle: { color: "#fc4c02", borderRadius: [2, 2, 0, 0] },
        barWidth: "60%",
      },
    ],
  };
}

const HR_ZONE_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444"];

export function hrZoneBarChart(
  zones: number[],
  unit = "h",
  dark = false,
): EChartsOption {
  const t = themeColors(dark);
  const labels = ["Z1", "Z2", "Z3", "Z4", "Z5"];
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
    yAxis: { type: "value", axisLabel: { fontSize: 10, color: t.axis } },
    series: [
      {
        type: "bar",
        data: zones.map((v, i) => ({
          value: v,
          itemStyle: {
            color: {
              type: "linear",
              x: 0, y: 1, x2: 0, y2: 0,
              colorStops: [
                { offset: 0, color: HR_ZONE_COLORS[i] + "88" },
                { offset: 1, color: HR_ZONE_COLORS[i] },
              ],
            },
            borderRadius: [4, 4, 0, 0],
          },
        })),
      },
    ],
  };
}

const YEAR_PALETTE = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#8b5cf6", "#6b7280"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function yearlyStatsChart(
  monthlyStats: { period: string; distance: number }[],
  unit: string,
  dark = false,
): EChartsOption {
  const t = themeColors(dark);

  const byYear = new Map<number, { month: number; distance: number }[]>();
  for (const m of monthlyStats) {
    const year = parseInt(m.period.slice(0, 4), 10);
    const month = parseInt(m.period.slice(5, 7), 10);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push({ month, distance: m.distance });
  }

  const years = Array.from(byYear.keys()).sort((a, b) => b - a);

  const series: EChartsOption["series"] = years.map((year, i) => {
    const months = byYear.get(year)!.sort((a, b) => a.month - b.month);
    const cumulative = new Array(12).fill(null) as (number | null)[];
    let sum = 0;
    for (const m of months) {
      sum += m.distance;
      cumulative[m.month - 1] = Math.round(sum);
    }
    // Fill forward nulls within the range
    const lastMonth = months[months.length - 1]?.month ?? 0;
    for (let j = 0; j < lastMonth; j++) {
      if (cumulative[j] === null && j > 0) {
        cumulative[j] = cumulative[j - 1];
      }
    }

    const color = YEAR_PALETTE[i % YEAR_PALETTE.length];
    return {
      name: String(year),
      type: "line" as const,
      data: cumulative,
      smooth: 0.4,
      showSymbol: false,
      symbol: "circle",
      symbolSize: 6,
      emphasis: { focus: "series" as const, itemStyle: { borderWidth: 2 } },
      lineStyle: { color, width: 2.5 },
      itemStyle: { color },
    };
  });

  return {
    grid: { left: 55, right: 20, top: 50, bottom: 65 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText, fontSize: 12 },
      formatter: (params: unknown) => {
        const list = params as { seriesName: string; value: number | null; color: string; dataIndex: number }[];
        if (!Array.isArray(list) || list.length === 0) return "";
        const month = MONTH_LABELS[list[0]?.dataIndex ?? 0] ?? "";
        let html = `<div style="font-weight:600;margin-bottom:4px">${month}</div>`;
        for (const item of list) {
          if (item.value == null) continue;
          html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">`;
          html += `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${item.color}"></span>`;
          html += `<span>${item.seriesName}</span>`;
          html += `<span style="margin-left:auto;font-weight:600">${item.value.toLocaleString()} ${unit}</span>`;
          html += `</div>`;
        }
        return html;
      },
    },
    legend: {
      top: 5,
      textStyle: { fontSize: 12, color: t.text },
      itemWidth: 16,
      itemHeight: 8,
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
      splitLine: { lineStyle: { color: dark ? "#2d333b" : "#f0f0f0" } },
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
  };
}
