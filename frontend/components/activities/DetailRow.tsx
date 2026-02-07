export function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || value === "-") return null
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
