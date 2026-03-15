import clsx from "clsx"

export function StatCard({
  label,
  value,
  sub,
  accent,
  className,
}: {
  label: string
  value: string
  sub?: React.ReactNode
  accent?: boolean
  className?: string
}) {
  return (
    <div className={clsx("card flex flex-col gap-1 p-4", className)}>
      <span className="card-title">{label}</span>
      <span className={accent ? "stat-value text-brand dark:text-brand" : "stat-value"}>
        {value}
      </span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  )
}
