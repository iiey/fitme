import type { EChartsOption } from "echarts";

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
