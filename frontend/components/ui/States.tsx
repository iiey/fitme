export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-gray-400">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-brand" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="card p-6 text-center text-sm text-red-600">
      <p>{message ?? "Something went wrong loading this data."}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 font-medium text-brand hover:underline"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-4 p-10 text-center text-sm text-gray-500">
      <span>{message}</span>
      {action}
    </div>
  )
}
