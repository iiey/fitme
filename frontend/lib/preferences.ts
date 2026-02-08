"use client"

import { useCallback, useEffect, useState } from "react"

const DEFAULT_SPORT_KEY = "fitme-default-sport"

/**
 * The sport the stats pages (Dashboard, Fitness, Activities, Heatmap, Rewind)
 * open filtered to. Empty string means "All sports". Backed by localStorage.
 */
export function useDefaultSport() {
  const [defaultSport, setDefaultSportState] = useState("")

  // Read after mount so server and first client render agree (no hydration mismatch).
  useEffect(() => {
    setDefaultSportState(localStorage.getItem(DEFAULT_SPORT_KEY) ?? "")
  }, [])

  const setDefaultSport = useCallback((value: string) => {
    setDefaultSportState(value)
    if (value) {
      localStorage.setItem(DEFAULT_SPORT_KEY, value)
    } else {
      localStorage.removeItem(DEFAULT_SPORT_KEY)
    }
  }, [])

  return { defaultSport, setDefaultSport } as const
}
