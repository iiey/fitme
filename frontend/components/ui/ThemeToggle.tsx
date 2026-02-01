"use client"

import { useEffect, useState } from "react"

export type Theme = "light" | "dark" | "system"

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system"
  return (localStorage.getItem("theme") as Theme) ?? "system"
}

function applyTheme(theme: Theme) {
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", isDark)
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system")

  useEffect(() => {
    const stored = getStoredTheme()
    setThemeState(stored)
    applyTheme(stored)

    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      if (getStoredTheme() === "system") applyTheme("system")
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const setTheme = (next: Theme) => {
    setThemeState(next)
    localStorage.setItem("theme", next)
    applyTheme(next)
  }

  return { theme, setTheme } as const
}
