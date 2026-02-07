"use client"

import type { LatLngBoundsExpression, LatLngTuple } from "leaflet"
import { useEffect, useMemo } from "react"
import { MapContainer, Polyline, TileLayer, useMap } from "react-leaflet"

import { colorForActivityType } from "@/lib/format"
import { decodePolyline } from "@/lib/polyline"
import type { HeatmapRoute } from "@/lib/types"
import { useIsDark } from "@/lib/use-is-dark"

interface DecodedRoute {
  activityId: string
  name: string
  activityType: string
  points: LatLngTuple[]
}

function FitAllBounds({ routes }: { routes: DecodedRoute[] }) {
  const map = useMap()
  useEffect(() => {
    const allPoints = routes.flatMap((route) => route.points)
    if (allPoints.length > 0) {
      map.fitBounds(allPoints as LatLngBoundsExpression, { padding: [30, 30] })
    }
  }, [map, routes])
  return null
}

export default function HeatmapView({ routes }: { routes: HeatmapRoute[] }) {
  const isDark = useIsDark()
  const decoded = useMemo<DecodedRoute[]>(
    () =>
      routes
        .map((route) => ({
          activityId: route.activity_id,
          name: route.name,
          activityType: route.activity_type,
          points: decodePolyline(route.polyline) as LatLngTuple[],
        }))
        .filter((route) => route.points.length > 1),
    [routes],
  )

  const center = decoded[0]?.points[0] ?? ([50.85, 4.35] as LatLngTuple)

  return (
    <MapContainer center={center} zoom={11} style={{ height: "100%", width: "100%" }} preferCanvas>
      <TileLayer
        key={isDark ? "dark" : "light"}
        className={isDark ? "heatmap-tiles-dark" : "heatmap-tiles-light"}
        attribution="&copy; OpenStreetMap contributors &copy; CARTO"
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />
      {decoded.map((route) => (
        <Polyline
          key={route.activityId}
          positions={route.points}
          pathOptions={{
            color: colorForActivityType(route.activityType),
            weight: 2,
            opacity: isDark ? 0.5 : 0.7,
          }}
        />
      ))}
      <FitAllBounds routes={decoded} />
    </MapContainer>
  )
}
