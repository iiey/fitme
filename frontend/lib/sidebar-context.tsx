"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"

const STORAGE_KEY = "fitme-sidebar-collapsed"

interface SidebarContextValue {
  /** Desktop sidebar collapsed to an icon-only rail. */
  collapsed: boolean
  toggleCollapsed: () => void
  /** Whether the athlete/profile dropdown is open (so overlays can yield to it). */
  profileMenuOpen: boolean
  setProfileMenuOpen: (open: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggleCollapsed: () => {},
  profileMenuOpen: false,
  setProfileMenuOpen: () => {},
})

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)

  // Read the persisted choice after mount to avoid an SSR/client mismatch.
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "true")
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  return (
    <SidebarContext.Provider
      value={{ collapsed, toggleCollapsed, profileMenuOpen, setProfileMenuOpen }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}
