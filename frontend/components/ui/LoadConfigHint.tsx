import Link from "next/link"

/**
 * Notice shown when activities exist but their training load is uniformly zero.
 *
 * Training load and intensity are derived from heart rate or power relative to
 * the athlete's thresholds. Without a resting/max HR (or FTP) configured, every
 * activity scores zero and the load-based views (fitness curve, intensity
 * heatmap) render empty with no explanation. This banner tells the user why and
 * points them at the fix.
 */
export function LoadConfigHint() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
      No training load could be computed. Set your{" "}
      <Link href="/settings" className="font-medium underline hover:no-underline">
        Resting HR and Max HR (or Birthday and FTP) in Settings
      </Link>{" "}
      so intensity can be calculated from your activities&apos; heart-rate or power data.
    </div>
  )
}

/** True when there are activities on record but none produced any training load. */
export function hasActivitiesButNoLoad(
  items: { count?: number; activities?: unknown[]; load?: number; training_load?: number }[],
): boolean {
  const loadOf = (i: { load?: number; training_load?: number }) => i.training_load ?? i.load ?? 0
  const countOf = (i: { count?: number; activities?: unknown[] }) =>
    i.count ?? i.activities?.length ?? 0
  const hasActivities = items.some((i) => countOf(i) > 0)
  const hasLoad = items.some((i) => loadOf(i) > 0)
  return hasActivities && !hasLoad
}
