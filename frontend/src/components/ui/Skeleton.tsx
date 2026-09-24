import { cx } from "@/lib/format";

/** Placeholder block shown while data loads, sized like the content it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

/** Wraps a skeleton layout so assistive tech hears "Loading" once instead of nothing. */
export function LoadingRegion({ label = "Loading", className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

export function ListRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <LoadingRegion>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2 border-b border-slate-100 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="ml-auto h-3 w-10" />
          </div>
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </LoadingRegion>
  );
}

export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("space-y-3 rounded-xl border border-slate-200 bg-surface p-5", className)}>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3", i % 2 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
