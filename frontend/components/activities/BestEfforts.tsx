import { Card } from "@/components/ui/Card"
import { formatDuration } from "@/lib/format"
import type { ActivityDetail } from "@/lib/types"

export function BestEfforts({ activity }: { activity: ActivityDetail }) {
  return (
    <Card title="Best Efforts">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {activity.best_efforts.map((effort) => (
          <div key={effort.distance_m} className="rounded-lg bg-surface-muted p-3">
            <p className="text-xs uppercase text-gray-500">{effort.label}</p>
            <p className="text-lg font-semibold">{formatDuration(effort.time_s)}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}
