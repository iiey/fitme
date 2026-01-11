export function Skeleton({ className = "", height }: { className?: string; height?: number | string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 ${className}`}
      style={height ? { height } : undefined}
    />
  );
}

export function CardSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div className="card p-4">
      <Skeleton className="mb-3 h-4 w-32" />
      <Skeleton height={height} />
    </div>
  );
}
