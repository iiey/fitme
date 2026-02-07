"use client"

import type { EChartsOption, EChartsType } from "echarts"
import dynamic from "next/dynamic"
import { ErrorBoundary } from "@/components/ui/ErrorBoundary"
import echarts from "@/lib/echarts"

const ReactECharts = dynamic(() => import("echarts-for-react/lib/core"), {
  ssr: false,
})

export function EChart({
  option,
  height = 300,
  onEvents,
  onChartReady,
}: {
  option: EChartsOption
  height?: number
  onEvents?: Record<string, (params: unknown) => void>
  onChartReady?: (instance: EChartsType) => void
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
        onChartReady={onChartReady}
        opts={{ renderer: "canvas" }}
      />
    </ErrorBoundary>
  )
}
