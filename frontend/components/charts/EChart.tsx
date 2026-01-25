"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import echarts from "@/lib/echarts";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

const ReactECharts = dynamic(() => import("echarts-for-react/lib/core"), {
  ssr: false,
});

export function EChart({
  option,
  height = 300,
  onEvents,
}: {
  option: EChartsOption;
  height?: number;
  onEvents?: Record<string, (params: unknown) => void>;
}) {
  return (
    <ErrorBoundary>
      <ReactECharts
        echarts={echarts}
        option={option}
        style={{ height }}
        notMerge
        lazyUpdate
        onEvents={onEvents}
        opts={{ renderer: "canvas" }}
      />
    </ErrorBoundary>
  );
}
