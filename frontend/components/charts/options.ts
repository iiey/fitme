import type { EChartsOption } from "echarts";

import type { TrainingLoadAnalysis } from "@/lib/types";

// Reusable ECharts option builders, keeping page components declarative.

export function barChart(
  categories: string[],
  values: number[],
  color = "#fc4c02",
  unit = "",
): EChartsOption {
  return {
    grid: { left: 50, right: 15, top: 15, bottom: 50 },
    tooltip: { trigger: "axis", valueFormatter: (v) => `${Number(v).toLocaleString()} ${unit}` },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: { fontSize: 10, rotate: categories.length > 12 ? 45 : 0 },
    },
    yAxis: { type: "value", axisLabel: { fontSize: 10 } },
    series: [{ type: "bar", data: values, itemStyle: { color, borderRadius: [3, 3, 0, 0] } }],
  };
}

export function lineChart(
  categories: string[],
  values: number[],
  color = "#fc4c02",
): EChartsOption {
  return {
    grid: { left: 45, right: 15, top: 15, bottom: 40 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: categories, axisLabel: { fontSize: 10 } },
    yAxis: { type: "value", axisLabel: { fontSize: 10 } },
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
): EChartsOption {
  return {
    tooltip: { trigger: "item" },
    legend: { bottom: 0, type: "scroll", textStyle: { fontSize: 11 } },
    series: [
      {
        type: "pie",
        radius: ["45%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
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

export function trainingLoadDetailChart(analysis: TrainingLoadAnalysis): EChartsOption {
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
      textStyle: { fontSize: 11 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
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
        axisLabel: { fontSize: 10 },
      },
    ],
    yAxis: [
      {
        type: "value",
        name: "Load (CTL/ATL)",
        gridIndex: 0,
        position: "left",
        axisLabel: { fontSize: 10 },
        nameTextStyle: { fontSize: 10 },
      },
      {
        type: "value",
        name: "Form (TSB)",
        gridIndex: 0,
        position: "right",
        min: Math.floor(tsbMin - 5),
        max: Math.ceil(tsbMax + 5),
        axisLabel: { fontSize: 10 },
        nameTextStyle: { fontSize: 10 },
        splitLine: { show: false },
      },
      {
        type: "value",
        name: "Daily Load",
        gridIndex: 1,
        axisLabel: { fontSize: 10 },
        nameTextStyle: { fontSize: 10 },
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
