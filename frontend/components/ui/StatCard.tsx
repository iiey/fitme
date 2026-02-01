export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="card-title">{label}</span>
      <span className={accent ? "stat-value text-brand dark:text-brand" : "stat-value"}>
        {value}
      </span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  )
}
