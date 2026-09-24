"use client";

import { Activity, ArrowUpRight, HeartPulse, Radar } from "lucide-react";
import Link from "next/link";
import { HealthBadge } from "@/components/HealthBadge";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { cx, money } from "@/lib/format";
import type { PulseIssue } from "@/lib/types";

const LIVE = ["tickets", "conversations", "messages", "actions"] as const;

/** Pulse: topics, sentiment and escalation queues surging above their 7-day baseline. */
export function PulsePanel() {
  const { data, error } = useAsync(() => api.pulse(), "pulse", 30000, LIVE);
  if (error) return null; // analytics still works without it
  if (!data) return <CardSkeleton lines={4} />;
  return (
    <section className="rounded-xl border border-slate-200 bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Radar className="h-4 w-4 text-brand-600" aria-hidden /> Pulse — emerging issues
          </h2>
          <p className="text-xs text-slate-500">
            The last {data.window_hours} hours compared with the previous {data.baseline_days} days. Subscribe to <code className="text-[11px]">insight.spike</code> in
            Settings → Webhooks to get these in Slack.
          </p>
        </div>
        {data.warming_up && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
            Baseline still building — alerts start after a day of traffic
          </span>
        )}
      </div>
      {data.issues.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
          <Activity className="h-4 w-4" aria-hidden /> All quiet — nothing is running above its usual level.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {data.issues.slice(0, 6).map((issue) => (
            <IssueCard key={issue.id} issue={issue} />
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueCard({ issue }: { issue: PulseIssue }) {
  const high = issue.severity === "high";
  const max = Math.max(1, ...issue.series);
  return (
    <li className={cx("rounded-lg border p-3", high ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cx("text-sm font-medium", high ? "text-rose-800" : "text-amber-800")}>{issue.label}</p>
          <p className="mt-0.5 text-xs text-slate-600">
            <b className="font-semibold text-slate-900">{issue.current}</b> in 24h ·{" "}
            {issue.ratio === null ? "new — not seen in the past week" : `${issue.ratio}× the usual ${issue.baseline_avg}/day`}
          </p>
        </div>
        {/* 8-day sparkline: the last bar is today. */}
        <div className="flex h-9 shrink-0 items-end gap-0.5" role="img" aria-label={`Daily conversations, oldest first: ${issue.series.join(", ")}`}>
          {issue.series.map((n, i) => (
            <div
              key={i}
              className={cx("w-1.5 rounded-t-sm", i === issue.series.length - 1 ? (high ? "bg-rose-500" : "bg-amber-500") : "bg-slate-300")}
              style={{ height: `${Math.max((n / max) * 100, 8)}%` }}
            />
          ))}
        </div>
      </div>
      {issue.examples.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {issue.examples.slice(0, 2).map((ex) => (
            <li key={ex} className="truncate text-[11px] italic text-slate-600">
              “{ex}”
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Customers whose recent experience predicts churn, with the reasons. */
export function AtRiskPanel() {
  const { data, error } = useAsync(() => api.customerHealthReport(8), "customer-health", 30000, LIVE);
  if (error) return null;
  if (!data) return <CardSkeleton lines={4} />;
  return (
    <section className="rounded-xl border border-slate-200 bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <HeartPulse className="h-4 w-4 text-rose-600" aria-hidden /> At-risk customers
          </h2>
          <p className="text-xs text-slate-500">Health drops with repeat contacts, escalations, missed SLAs, anger and low ratings (last 30 days).</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tracking-tight text-slate-900">{money(data.revenue_at_risk)}</p>
          <p className="text-[11px] text-slate-500">lifetime value at risk · {data.high_risk} high risk</p>
        </div>
      </div>
      {data.customers.length === 0 ? (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">Every customer is healthy right now.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {data.customers.map((c) => (
            <li key={c.customer_id} className="flex items-center gap-3 py-2.5">
              <HealthBadge score={c.score} risk={c.risk} className="w-14 justify-center" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {c.name} <span className="text-xs font-normal text-slate-500">· {c.tier} · {money(c.lifetime_value)} LTV</span>
                </p>
                <p className="truncate text-xs text-slate-500">{c.factors.filter((f) => f.impact < 0).slice(0, 3).map((f) => f.label).join(" · ")}</p>
              </div>
              {c.latest_conversation_id && (
                <Link
                  href={`/console?conversation=${c.latest_conversation_id}`}
                  className="flex shrink-0 items-center gap-0.5 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                >
                  Open <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
