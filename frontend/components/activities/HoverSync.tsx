"use client"

import type { EChartsOption, EChartsType } from "echarts"
import type React from "react"
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"

import { EChart } from "@/components/charts/EChart"

const HoverIndexContext = createContext<number | null>(null)
const HoverSetterContext = createContext<(index: number | null) => void>(() => {})

/**
 * Shares the hovered stream sample index between the activity charts and the
 * route map. Split into two contexts on purpose: the charts only ever *set* the
 * index, so they subscribe to the (stable) setter and never re-render as the
 * cursor moves; only the map, which *reads* the index, re-renders.
 *
 * `enabled` is false for activities without a GPS track, where the setter is a
 * no-op and the index stays null - no marker, no wasted renders.
 */
export function ActivityHoverProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const [index, setIndex] = useState<number | null>(null)
  const setter = useMemo<(index: number | null) => void>(
    () => (enabled ? setIndex : () => {}),
    [enabled],
  )
  return (
    <HoverSetterContext.Provider value={setter}>
      <HoverIndexContext.Provider value={enabled ? index : null}>
        {children}
      </HoverIndexContext.Provider>
    </HoverSetterContext.Provider>
  )
}

export const useHoverIndex = () => useContext(HoverIndexContext)
export const useHoverSetter = () => useContext(HoverSetterContext)

/** Nearest sample index in a monotonic x array (distance km / elapsed seconds). */
function nearestIndex(xs: number[], target: number): number | null {
  if (xs.length === 0 || Number.isNaN(target)) return null
  let best = 0
  let bestDiff = Number.POSITIVE_INFINITY
  for (let i = 0; i < xs.length; i++) {
    const diff = Math.abs(xs[i] - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  }
  return best
}

/**
 * A stream line chart that reports the hovered sample index to the hover
 * context so the route map can mark the matching GPS point. `xValues` are the
 * chart's x coordinates (km or seconds), one per sample and index-aligned with
 * the activity's `coordinates`.
 */
export function HoverStreamChart({
  option,
  height,
  xValues,
}: {
  option: EChartsOption
  height?: number
  xValues: number[]
}) {
  const setHover = useHoverSetter()
  // Keep the handler reading the latest values without re-binding on every render.
  const xValuesRef = useRef(xValues)
  xValuesRef.current = xValues
  const lastEmitted = useRef<number | null>(null)

  const emit = useCallback(
    (index: number | null) => {
      if (index === lastEmitted.current) return
      lastEmitted.current = index
      setHover(index)
    },
    [setHover],
  )

  const handleReady = useCallback(
    (chart: EChartsType) => {
      const zr = chart.getZr()
      zr.on("mousemove", (event) => {
        const point: [number, number] = [event.offsetX, event.offsetY]
        // "grid" is the cartesian coordinate system finder; the {gridIndex}/
        // {seriesIndex} object forms are not accepted by contain/convertFromPixel.
        if (!chart.containPixel("grid", point)) {
          emit(null)
          return
        }
        const [x] = chart.convertFromPixel("grid", point) as number[]
        emit(nearestIndex(xValuesRef.current, x))
      })
      zr.on("globalout", () => emit(null))
    },
    [emit],
  )

  return <EChart option={option} height={height} onChartReady={handleReady} />
}
