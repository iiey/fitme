import type { Metadata } from "next"

import "./globals.css"
import "leaflet/dist/leaflet.css"
import { CoachLauncher } from "@/components/coach/CoachLauncher"
import { AppMain } from "@/components/layout/AppMain"
import { Sidebar } from "@/components/layout/Sidebar"
import { AthleteProvider } from "@/lib/athlete-context"
import { SidebarProvider } from "@/lib/sidebar-context"

export const metadata: Metadata = {
  title: "FitMe",
  description: "Self-hosted fitness statistics",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-surface-muted text-gray-900 antialiased dark:text-gray-100">
        <AthleteProvider>
          <SidebarProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <AppMain>{children}</AppMain>
            </div>
            <CoachLauncher />
          </SidebarProvider>
        </AthleteProvider>
      </body>
    </html>
  )
}
