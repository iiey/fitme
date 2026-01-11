"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import echarts from "@/lib/echarts";

const ReactECharts = dynamic(() => import("echarts-for-react/lib/core"), {
  ssr: false,
});

export function EChart({
  option,
  height = 300,
}: {
  option: EChartsOption;
  height?: number;
}) {
  return (
    <ReactECharts
      echarts={echarts}
      option={option}
      style={{ height }}
      notMerge
      lazyUpdate
      opts={{ renderer: "canvas" }}
    />
  );
}
