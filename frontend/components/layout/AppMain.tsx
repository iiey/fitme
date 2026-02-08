"use client"

import clsx from "clsx"

import { useSidebar } from "@/lib/sidebar-context"

/** Main content area; its left margin tracks the desktop sidebar width. */
export function AppMain({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar()
  return (
    <main
      className={clsx(
        "flex-1 overflow-x-hidden px-3 pb-6 pt-16 transition-[margin] duration-200 sm:px-4 md:px-6 lg:px-8 lg:pt-6 xl:px-10",
        collapsed ? "lg:ml-16" : "lg:ml-64",
      )}
    >
      <div className="w-full">{children}</div>
    </main>
  )
}
