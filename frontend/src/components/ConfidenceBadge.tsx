import { confidenceTone, cx, pct } from "@/lib/format";

const TONES = {
  high: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  medium: "bg-amber-50 text-amber-700 ring-amber-600/20",
  low: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

export function ConfidenceBadge({ value, label = "confidence", className }: { value?: number | null; label?: string; className?: string }) {
  if (value === null || value === undefined) return null;
  const tone = confidenceTone(value);
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[tone], className)}>
      <span className={cx("h-1.5 w-1.5 rounded-full", tone === "high" ? "bg-emerald-500" : tone === "medium" ? "bg-amber-500" : "bg-rose-500")} />
      {pct(value)} {label}
    </span>
  );
}

export function ConfidenceMeter({ value, threshold = 0.6 }: { value: number; threshold?: number }) {
  const tone = confidenceTone(value, threshold);
  return (
    <div className="relative h-2 w-full rounded-full bg-slate-100">
      <div
        className={cx(
          "h-2 rounded-full transition-all duration-500",
          tone === "high" ? "bg-emerald-500" : tone === "medium" ? "bg-amber-400" : "bg-rose-500",
        )}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
      <div className="absolute -top-1 h-4 w-0.5 bg-slate-500" style={{ left: `${threshold * 100}%` }} title={`Escalation threshold ${pct(threshold)}`} />
    </div>
  );
}

const PRIORITY_TONES: Record<string, string> = {
  urgent: "bg-rose-600 text-white",
  high: "bg-orange-100 text-orange-800",
  normal: "bg-sky-100 text-sky-800",
  low: "bg-slate-100 text-slate-700",
};

export function PriorityPill({ priority }: { priority: string }) {
  return (
    <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", PRIORITY_TONES[priority] ?? PRIORITY_TONES.low)}>
      {priority}
    </span>
  );
}
