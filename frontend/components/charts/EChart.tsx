"use client"

import type { EChartsOption } from "echarts"
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
}: {
  option: EChartsOption
  height?: number
  onEvents?: Record<string, (params: unknown) => void>
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
  )
}
