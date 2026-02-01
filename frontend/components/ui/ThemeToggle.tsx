"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"

type Theme = "light" | "dark" | "system"

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

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system")

  useEffect(() => {
    const stored = getStoredTheme()
    setTheme(stored)
    applyTheme(stored)

    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      if (getStoredTheme() === "system") applyTheme("system")
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const cycle = () => {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light"
    setTheme(next)
    localStorage.setItem("theme", next)
    applyTheme(next)
  }

  const label = theme === "light" ? "Light" : theme === "dark" ? "Dark" : "Auto"
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor

  return (
    <button
      type="button"
      onClick={cycle}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
      aria-label={`Theme: ${label}`}
      title={`Theme: ${label}`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden md:inline">{label}</span>
    </button>
  )
}
