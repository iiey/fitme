"use client"

import { useCallback, useEffect, useState } from "react"

const DEFAULT_SPORTS_KEY = "fitme-default-sports"
const LEGACY_DEFAULT_SPORT_KEY = "fitme-default-sport"

/** Read the persisted default sports, migrating the legacy single-value key. */
function readDefaultSports(): string[] {
  const stored = localStorage.getItem(DEFAULT_SPORTS_KEY)
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return parsed.filter((entry) => typeof entry === "string")
    } catch {
      // Corrupt value - fall through to "All sports".
    }
    return []
  }
  const legacy = localStorage.getItem(LEGACY_DEFAULT_SPORT_KEY)
  return legacy ? [legacy] : []
}

/**
 * The sports the stats pages (Dashboard, Fitness, Activities, Heatmap, Rewind)
 * open filtered to. An empty array means "All sports". Backed by localStorage.
 */
export function useDefaultSports() {
  const [defaultSports, setDefaultSportsState] = useState<string[]>([])

  // Read after mount so server and first client render agree (no hydration mismatch).
  useEffect(() => {
    setDefaultSportsState(readDefaultSports())
  }, [])

  const setDefaultSports = useCallback((next: string[]) => {
    setDefaultSportsState(next)
    localStorage.setItem(DEFAULT_SPORTS_KEY, JSON.stringify(next))
    localStorage.removeItem(LEGACY_DEFAULT_SPORT_KEY)
  }, [])

  return { defaultSports, setDefaultSports } as const
}
