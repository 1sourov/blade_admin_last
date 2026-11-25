export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-zinc-200">
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div key={rIdx} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }).map((__, cIdx) => (
            <div
              key={cIdx}
              className={`h-4 bg-zinc-100 rounded animate-pulse ${
                cIdx === 0 ? 'w-32' : 'flex-1'
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function KpiGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="h-3 w-20 bg-zinc-100 rounded animate-pulse" />
          <div className="h-7 w-16 bg-zinc-100 rounded animate-pulse mt-3" />
        </div>
      ))}
    </div>
  );
}
