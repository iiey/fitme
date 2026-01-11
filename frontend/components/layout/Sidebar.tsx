"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { ImportDialog } from "@/components/import/ImportDialog";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useMeta } from "@/lib/api";
import type { AthleteInfo } from "@/lib/types";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/activities", label: "Activities", icon: "📋" },
  { href: "/calendar", label: "Monthly View", icon: "🗓️" },
  { href: "/eddington", label: "Eddington", icon: "📈" },
  { href: "/heatmap", label: "Heatmap", icon: "🗺️" },
  { href: "/milestones", label: "Milestones", icon: "🏆" },
  { href: "/rewind", label: "Rewind", icon: "⏪" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: meta } = useMeta();
  const [importOpen, setImportOpen] = useState(false);

  return (
    <aside className="fixed left-0 top-0 z-20 hidden h-screen w-64 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 lg:flex">
      <div className="flex items-center gap-2 px-6 py-5">
        <span className="text-2xl">🏃</span>
        <span className="text-xl font-bold tracking-tight">
          Stra<span className="text-brand">Stat</span>
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand/10 text-brand"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200",
              )}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-2 border-t border-gray-200 p-3 dark:border-gray-700">
        <button
          onClick={() => setImportOpen(true)}
          className="flex w-full items-center gap-3 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
        >
          <span className="text-lg">⬆️</span>
          Import data
        </button>
        <div className="flex items-center justify-between">
          <AthleteButton athlete={meta?.athlete ?? null} />
          <ThemeToggle />
        </div>
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </aside>
  );
}

function AthleteButton({ athlete }: { athlete: AthleteInfo | null }) {
  if (!athlete?.name) {
    return <p className="px-3 py-2 text-xs text-gray-400">Self-hosted · Strava export</p>;
  }

  const initials = athlete.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const content = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
        {initials}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-200">{athlete.name}</span>
        {athlete.location && (
          <span className="block truncate text-xs text-gray-400">{athlete.location}</span>
        )}
      </span>
      {athlete.profile_url && <span className="text-gray-300">↗</span>}
    </>
  );

  if (athlete.profile_url) {
    return (
      <a
        href={athlete.profile_url}
        target="_blank"
        rel="noopener noreferrer"
        title="Open Strava profile"
        className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        {content}
      </a>
    );
  }

  return <div className="flex items-center gap-2 rounded-lg px-2 py-2">{content}</div>;
}
