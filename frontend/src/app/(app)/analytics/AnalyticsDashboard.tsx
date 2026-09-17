"use client";

import { AlarmClock, Bot, Download, Gauge, Globe, Headset, Lightbulb, MessagesSquare, PiggyBank, Star, Timer, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorNotice } from "@/components/AppShell";
import { useAsync } from "@/hooks/useAsync";
import { api, downloadExport } from "@/lib/api";
import { cx, humanize, languageName, money, pct } from "@/lib/format";

function minutes(value: number | null): string {
  if (value === null) return "—";
  if (value < 60) return `${Math.round(value)}m`;
  if (value < 60 * 24) return `${(value / 60).toFixed(1)}h`;
  return `${(value / 1440).toFixed(1)}d`;
}

export function AnalyticsDashboard() {
  const { data, error, reload } = useAsync(() => api.analytics(), "analytics", 10000);
  const [exportError, setExportError] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <div className="p-8 text-sm text-slate-500">Loading…</div>;

  const exportCsv = (kind: "tickets" | "conversations") => {
    setExportError(null);
    downloadExport(kind).catch((e: Error) => setExportError(e.message));
  };

  const kpis = [
    { label: "Conversations", value: data.total_conversations.toLocaleString(), sub: `${data.ai_replies} AI replies`, icon: MessagesSquare },
    { label: "AI resolution rate", value: pct(data.deflection_rate), sub: `${data.ai_resolved_conversations} handled end-to-end`, icon: Bot },
    { label: "Escalated", value: data.escalated_conversations.toLocaleString(), sub: `${data.open_tickets} open · ${data.resolved_tickets} resolved`, icon: Headset },
    { label: "Avg confidence", value: pct(data.avg_confidence), sub: "blended score per reply", icon: Gauge },
    { label: "CSAT", value: data.csat_avg ? `${data.csat_avg.toFixed(1)} / 5` : "—", sub: `${data.csat_count} ratings`, icon: Star },
    { label: "Avg response time", value: data.avg_latency_ms !== null ? `${(data.avg_latency_ms / 1000).toFixed(2)}s` : "—", sub: "end-to-end agent run", icon: Timer },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Support analytics</h1>
            <p className="text-sm text-slate-500">How Relay is performing across conversations, confidence and escalations. Refreshes every 10s.</p>
          </div>
          <div className="flex items-center gap-2">
            {exportError && <span className="text-xs text-rose-600">{exportError}</span>}
            {(["tickets", "conversations"] as const).map((kind) => (
              <button
                key={kind}
                onClick={() => exportCsv(kind)}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" /> {humanize(kind)} CSV
              </button>
            ))}
          </div>
        </div>

        <section className="relative overflow-hidden rounded-2xl bg-ink-950 p-6 text-white">
          <div className="bg-grid absolute inset-0 opacity-60" />
          <div className="relative grid gap-6 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-brand-200">
                <PiggyBank className="h-4 w-4" /> Estimated savings
              </p>
              <p className="mt-2 text-4xl font-semibold tracking-tight">{money(data.roi.cost_saved)}</p>
              <p className="mt-1 text-xs text-slate-400">
                {data.roi.handled_by_ai} tickets handled without a human × {data.roi.minutes_per_human_ticket} min × {money(data.roi.cost_per_agent_hour)}/h ·{" "}
                <Link href="/settings" className="underline decoration-slate-600 underline-offset-2 hover:text-white">
                  adjust
                </Link>
              </p>
            </div>
            <HeroStat label="Agent hours saved" value={`${data.roi.hours_saved}h`} />
            <HeroStat label="Actions automated" value={String(data.automation.automated_actions)} sub={`${data.automation.approved_actions} approved by specialists`} />
            <HeroStat label="SLA compliance" value={pct(data.sla.compliance_rate)} sub={`${data.sla.breached} breached · ${data.sla.open_breached} still open`} />
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {kpis.map(({ label, value, sub, icon: Icon }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Icon className="h-3.5 w-3.5" /> {label}
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Intents" subtitle="What customers ask about">
            <HBars data={data.intents} format={humanize} />
          </Panel>
          <Panel title="Confidence distribution" subtitle="AI replies by blended confidence score">
            <VBars
              data={data.confidence_buckets}
              colors={{ "0-40": "bg-rose-400", "40-60": "bg-amber-400", "60-80": "bg-brand-400", "80-100": "bg-emerald-500" }}
              suffix="%"
            />
          </Panel>
          <Panel title="Escalations by team" subtitle="Where the Escalation Agent routes tickets">
            <HBars data={data.tickets_by_category} />
          </Panel>
          <Panel title="Escalations by priority" subtitle="Computed from reason, sentiment and customer tier">
            <VBars
              data={{ low: 0, normal: 0, high: 0, urgent: 0, ...data.tickets_by_priority }}
              colors={{ low: "bg-slate-400", normal: "bg-sky-500", high: "bg-orange-500", urgent: "bg-rose-600" }}
            />
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Human response times" subtitle="Across escalated tickets">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat icon={AlarmClock} label="First response" value={minutes(data.sla.avg_first_response_minutes)} />
              <MiniStat icon={Timer} label="Resolution" value={minutes(data.sla.avg_resolution_minutes)} />
              <MiniStat icon={Zap} label="Pending approvals" value={String(data.automation.pending_approvals)} tone={data.automation.pending_approvals ? "amber" : undefined} />
              <MiniStat icon={PiggyBank} label="Refunded / released" value={money(data.automation.refunded_amount)} />
            </div>
          </Panel>
          <Panel title="Customer languages" subtitle="Conversations by detected language">
            <HBars data={Object.fromEntries(Object.entries(data.languages).map(([k, v]) => [languageName(k), v]))} />
          </Panel>
          <Panel title="Order actions" subtitle="Executed by the AI or approved by specialists">
            <HBars data={data.automation.by_type} format={humanize} />
            <Link
              href="/knowledge"
              className="mt-4 flex items-center justify-between rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 hover:bg-sky-100"
            >
              <span className="flex items-center gap-1.5">
                <Lightbulb className="h-3.5 w-3.5" /> {data.knowledge_gaps} knowledge gap{data.knowledge_gaps === 1 ? "" : "s"} to close
              </span>
              <span className="font-medium">Review →</span>
            </Link>
          </Panel>
        </div>

        <Panel title="Conversations per day" subtitle="Last 14 days">
          <VBars data={Object.fromEntries(data.conversations_per_day.map((d) => [d.day.slice(5), d.count]))} colors={{}} />
        </Panel>
      </div>
    </div>
  );
}

function HeroStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-white/10 md:border-l md:pl-6">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, tone }: { icon: typeof Globe; label: string; value: string; tone?: "amber" }) {
  return (
    <div className={cx("rounded-lg p-3", tone === "amber" ? "bg-amber-50" : "bg-slate-50")}>
      <div className="flex items-center gap-1 text-[11px] text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={cx("mt-1 text-lg font-semibold", tone === "amber" ? "text-amber-800" : "text-slate-900")}>{value}</div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <p className="mb-4 text-xs text-slate-500">{subtitle}</p>
      {children}
    </section>
  );
}

function HBars({ data, format = (s: string) => s }: { data: Record<string, number>; format?: (s: string) => string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) return <p className="text-xs text-slate-500">No data yet.</p>;
  return (
    <ul className="space-y-2">
      {entries.map(([k, v]) => (
        <li key={k} className="grid grid-cols-[140px_1fr_32px] items-center gap-3 text-xs">
          <span className="truncate text-slate-600">{format(k)}</span>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(v / max) * 100}%` }} />
          </div>
          <span className="text-right font-mono text-slate-700">{v}</span>
        </li>
      ))}
    </ul>
  );
}

function VBars({ data, colors, suffix = "" }: { data: Record<string, number>; colors: Record<string, string>; suffix?: string }) {
  const entries = Object.entries(data);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) return <p className="text-xs text-slate-500">No data yet.</p>;
  return (
    <div className="flex h-40 items-end gap-3">
      {entries.map(([k, v]) => (
        <div key={k} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <span className="font-mono text-[11px] text-slate-700">{v}</span>
          <div className={cx("w-full max-w-14 rounded-t-md", colors[k] ?? "bg-brand-500")} style={{ height: `${Math.max((v / max) * 100, 2)}%` }} />
          <span className="text-[11px] text-slate-500">
            {humanize(k)}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  );
}
