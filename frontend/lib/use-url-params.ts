"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

/**
 * Read and write URL search params as the single source of truth for a page's
 * filter state, so a refresh or a shared link reproduces the same view. Setting
 * a param to "" removes it; ``router.replace`` avoids polluting history.
 */
export function useUrlParams() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const get = useCallback(
    (key: string, fallback: string) => searchParams.get(key) ?? fallback,
    [searchParams],
  )

  const set = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === "") {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : "?", { scroll: false })
    },
    [searchParams, router],
  )

  return { get, set }
}
