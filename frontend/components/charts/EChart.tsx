"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";

// echarts-for-react touches the DOM, so it must only render on the client.
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export function EChart({
  option,
  height = 300,
}: {
  option: EChartsOption;
  height?: number;
}) {
  return (
    <ReactECharts
      option={option}
      style={{ height }}
      notMerge
      lazyUpdate
      opts={{ renderer: "canvas" }}
    />
  );
}
