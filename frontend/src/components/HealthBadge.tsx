import { HeartPulse } from "lucide-react";
import { cx } from "@/lib/format";
import type { RiskLevel } from "@/lib/types";

const RISK_STYLE: Record<RiskLevel, string> = {
  high: "bg-rose-50 text-rose-700 ring-rose-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-200",
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

/** Customer health score (0–100) coloured by churn risk. */
export function HealthBadge({ score, risk, className }: { score: number; risk: RiskLevel; className?: string }) {
  return (
    <span
      className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", RISK_STYLE[risk], className)}
      title={`Health ${score}/100 — ${risk} churn risk`}
    >
      <HeartPulse className="h-3 w-3" aria-hidden /> {score}
      <span className="sr-only"> out of 100, {risk} churn risk</span>
    </span>
  );
}
