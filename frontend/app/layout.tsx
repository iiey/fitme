import type { Metadata } from "next"

import "./globals.css"
import "leaflet/dist/leaflet.css"
import { Sidebar } from "@/components/layout/Sidebar"
import { AthleteProvider } from "@/lib/athlete-context"

export const metadata: Metadata = {
  title: "FitMe",
  description: "Self-hosted fitness statistics",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-surface-muted text-gray-900 antialiased dark:text-gray-100">
        <AthleteProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-x-hidden px-3 pb-6 pt-16 sm:px-4 md:px-6 lg:ml-64 lg:px-8 lg:pt-6 xl:px-10">
              <div className="w-full">{children}</div>
            </main>
          </div>
        </AthleteProvider>
      </body>
    </html>
  )
}
