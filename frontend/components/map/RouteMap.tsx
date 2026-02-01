"use client";

import { useEffect } from "react";
import { MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

import { decodePolyline } from "@/lib/polyline";

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, bounds]);
  return null;
}

function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export default function RouteMap({
  polyline,
  color = "#3b82f6",
  height = 320,
}: {
  polyline: string;
  color?: string;
  height?: number;
}) {
  const points = decodePolyline(polyline);
  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-400"
        style={{ height }}
      >
        No route data
      </div>
    );
  }

  const bounds = points as LatLngBoundsExpression;

  return (
    <div className="overflow-hidden rounded-lg" style={{ height }}>
      <MapContainer
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
        center={points[0]}
        zoom={13}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={points} pathOptions={{ color, weight: 4 }} />
        <FitBounds bounds={bounds} />
        <InvalidateOnResize />
      </MapContainer>
    </div>
  );
}
