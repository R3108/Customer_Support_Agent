"use client";

import { AlertTriangle, BookOpen, Brain, CheckCircle2, CircleDashed, Database, Headset, Lightbulb, Loader2, MessageSquareText, Zap } from "lucide-react";
import { cx, humanize, languageName, money, pct } from "@/lib/format";
import type { ActionProposal, ActionSummary, AgentStep, ConfidenceBreakdown } from "@/lib/types";
import { ConfidenceMeter, PriorityPill } from "./ConfidenceBadge";

const PIPELINE = [
  { node: "intent_classifier", label: "Intent Classifier", icon: Brain },
  { node: "knowledge_retriever", label: "Knowledge Retriever", icon: BookOpen },
  { node: "support_agent", label: "Support Agent", icon: MessageSquareText },
  { node: "action_agent", label: "Action Agent", icon: Zap },
  { node: "escalation_agent", label: "Escalation Agent", icon: Headset },
  { node: "memory_manager", label: "Memory", icon: Database },
];

type Data = Record<string, unknown>;

export function AgentTrace({ steps, live, threshold = 0.6 }: { steps: AgentStep[]; live: boolean; threshold?: number }) {
  const byNode = new Map(steps.map((s) => [s.node, s]));
  const finished = !live && steps.some((s) => s.node === "memory_manager");

  if (!steps.length && !live) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <CircleDashed className="h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-700">Agent trace</p>
        <p className="mt-1 max-w-xs text-xs text-slate-500">
          Send a message to watch the LangGraph workflow run: intent, retrieval, confidence scoring and escalation decisions — live.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {PIPELINE.map(({ node, label, icon: Icon }, idx) => {
        const step = byNode.get(node);
        const isActive = live && !step && PIPELINE.slice(0, idx).every((p) => byNode.has(p.node) || !wouldRun(p.node, byNode));
        const skipped = !step && (finished || (live && !wouldRun(node, byNode)));
        return (
          <div
            key={node}
            className={cx(
              "rounded-xl border bg-surface transition",
              step ? "border-slate-200 shadow-sm" : "border-dashed border-slate-200",
              skipped && "opacity-45",
            )}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <div
                className={cx(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  step
                    ? node === "escalation_agent"
                      ? "bg-amber-100 text-amber-700"
                      : node === "action_agent"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-brand-50 text-brand-600"
                    : "bg-slate-50 text-slate-500",
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="flex-1 text-[13px] font-medium text-slate-800">{label}</span>
              {step ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : isActive && !skipped ? (
                <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
              ) : skipped ? (
                <span className="text-[11px] uppercase tracking-wide text-slate-500">skipped</span>
              ) : null}
            </div>
            {step && <div className="border-t border-slate-100 px-3 py-2.5">{renderStep(step, threshold)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function wouldRun(node: string, byNode: Map<string, AgentStep>): boolean {
  const intent = byNode.get("intent_classifier")?.data as Data | undefined;
  const support = byNode.get("support_agent")?.data as Data | undefined;
  const action = byNode.get("action_agent")?.data as Data | undefined;
  const hardEscalation = Boolean(intent && (intent.hard_triggers as string[] | undefined)?.length);
  const confirmation = Boolean(intent?.action_confirmation);
  if (node === "knowledge_retriever") return !hardEscalation && !confirmation && intent?.intent !== "greeting";
  if (node === "support_agent") return !hardEscalation && !confirmation;
  if (node === "action_agent") return !hardEscalation && (!intent || confirmation);
  if (node === "escalation_agent") {
    if (confirmation) return !action || Boolean(action.escalate);
    return hardEscalation || !support || Boolean(support.escalate);
  }
  return true;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5 text-xs">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className="min-w-0 text-right text-slate-800">{children}</span>
    </div>
  );
}

function Chip({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "rose" | "brand" | "amber" | "emerald" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    rose: "bg-rose-100 text-rose-700",
    brand: "bg-brand-50 text-brand-700",
    amber: "bg-amber-100 text-amber-800",
    emerald: "bg-emerald-100 text-emerald-700",
  };
  return <span className={cx("inline-block rounded px-1.5 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}

function Bar({ label, value, weight }: { label: string; value: number; weight?: string }) {
  return (
    <div className="grid grid-cols-[76px_1fr_40px] items-center gap-2 text-[11px]">
      <span className="text-slate-500">
        {label}
        {weight && <span className="text-slate-500"> ·{weight}</span>}
      </span>
      <div className="h-1.5 rounded-full bg-slate-100">
        <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="text-right font-mono text-slate-600">{value.toFixed(2)}</span>
    </div>
  );
}

function renderStep(step: AgentStep, threshold: number) {
  const d = step.data as Data;
  switch (step.node) {
    case "intent_classifier": {
      const triggers = (d.hard_triggers as string[]) ?? [];
      const signals = ((d.signals as string[]) ?? []).filter((s) => !triggers.includes(s));
      const entities = (d.entities as Record<string, unknown>) ?? {};
      return (
        <div className="space-y-1">
          <Row k="Intent">
            <Chip tone="brand">{String(d.intent_label ?? d.intent)}</Chip>
          </Row>
          <Row k="Confidence">{pct(d.confidence as number)}</Row>
          <Row k="Sentiment">
            <Chip tone={d.sentiment === "angry" ? "rose" : d.sentiment === "negative" ? "amber" : d.sentiment === "positive" ? "emerald" : "slate"}>
              {humanize(d.sentiment as string)}
            </Chip>
          </Row>
          {triggers.length > 0 && (
            <Row k="Hard trigger">
              {triggers.map((t) => (
                <Chip key={t} tone="rose">
                  {humanize(t)}
                </Chip>
              ))}
            </Row>
          )}
          {typeof d.language === "string" && d.language !== "en" && <Row k="Language">{languageName(d.language)}</Row>}
          {Boolean(d.action_confirmation) && (
            <Row k="Offer reply">
              <Chip tone={d.action_confirmation === "confirm" ? "emerald" : "slate"}>{d.action_confirmation === "confirm" ? "Confirmed" : "Declined"}</Chip>
            </Row>
          )}
          {signals.length > 0 && <Row k="Signals">{signals.map(humanize).join(", ")}</Row>}
          {Object.keys(entities).length > 0 && (
            <Row k="Entities">
              <span className="font-mono text-[11px]">
                {Object.entries(entities)
                  .filter(([k]) => k !== "order_ids")
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(" ")}
              </span>
            </Row>
          )}
          <Row k="Engine">{d.mode === "llm" ? "LLM" : "Offline rules"}</Row>
        </div>
      );
    }
    case "knowledge_retriever": {
      const sources = (d.sources as { id: string; title: string; section: string; score: number }[]) ?? [];
      const account = d.account as { authenticated?: boolean; order_lookup?: { order_id: string; result: string; auto_selected?: boolean }; candidate_orders?: number } | null;
      return (
        <div className="space-y-2">
          <Row k="Retrieval relevance">{pct(d.retrieval_confidence as number)}</Row>
          <ul className="space-y-1">
            {sources.slice(0, 3).map((s) => (
              <li key={s.id} className="rounded-md bg-slate-50 px-2 py-1">
                <div className="flex justify-between gap-2 text-[11px]">
                  <span className="truncate text-slate-700">{s.section}</span>
                  <span className="font-mono text-slate-500">{s.score.toFixed(2)}</span>
                </div>
                <div className="mt-0.5 h-1 rounded-full bg-slate-200">
                  <div className="h-1 rounded-full bg-emerald-500" style={{ width: `${s.score * 100}%` }} />
                </div>
              </li>
            ))}
            {!sources.length && <li className="text-[11px] text-slate-500">No relevant passages found.</li>}
          </ul>
          {account && (
            <div className="border-t border-slate-100 pt-1.5">
              <Row k="Signed in">{account.authenticated ? "Yes" : "Guest"}</Row>
              {account.order_lookup && (
                <Row k="Order lookup">
                  <span className="font-mono">{account.order_lookup.order_id}</span>{" "}
                  <Chip tone={account.order_lookup.result === "found" ? "emerald" : "amber"}>
                    {humanize(account.order_lookup.result)}
                    {account.order_lookup.auto_selected ? " (auto)" : ""}
                  </Chip>
                </Row>
              )}
              {!!account.candidate_orders && <Row k="Candidates">{account.candidate_orders} orders</Row>}
            </div>
          )}
        </div>
      );
    }
    case "support_agent": {
      const b = (d.breakdown as ConfidenceBreakdown) ?? {};
      const confidence = (d.confidence as number) ?? 0;
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Chip tone={d.action === "answer" ? "emerald" : d.action === "clarify" ? "brand" : "amber"}>{humanize(d.action as string)}</Chip>
            <span className="font-mono text-sm font-semibold text-slate-900">{pct(confidence)}</span>
          </div>
          <ConfidenceMeter value={confidence} threshold={threshold} />
          <div className="space-y-1 pt-1">
            <Bar label="Intent" weight="20%" value={b.intent ?? 0} />
            <Bar label="Evidence" weight="35%" value={b.evidence ?? 0} />
            <Bar label="Generation" weight="45%" value={b.generation ?? 0} />
          </div>
          {(b.sentiment_penalty ?? 0) > 0 && <Row k="Sentiment penalty">−{b.sentiment_penalty}</Row>}
          {b.clarify_floor && <Row k="Clarify floor">applied (safe action)</Row>}
          {Boolean(d.escalate) && (
            <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" /> Escalating: {humanize(d.escalation_reason as string)}
            </div>
          )}
          {Boolean(d.action_proposal) && (
            <div className="flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-[11px] text-brand-700">
              <Zap className="h-3.5 w-3.5" /> Offered: {(d.action_proposal as ActionProposal).label} · {(d.action_proposal as ActionProposal).order_id}
            </div>
          )}
          {Boolean(d.knowledge_gap) && (
            <div className="flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-[11px] text-sky-800">
              <Lightbulb className="h-3.5 w-3.5" /> Logged as a knowledge gap
            </div>
          )}
        </div>
      );
    }
    case "action_agent": {
      const action = d.action as ActionSummary | null;
      return (
        <div className="space-y-1">
          <Row k="Customer">
            <Chip tone={d.decision === "confirm" ? "emerald" : "slate"}>{d.decision === "confirm" ? "Confirmed" : "Declined"}</Chip>
          </Row>
          {action && (
            <>
              <Row k="Action">
                {action.label} · <span className="font-mono">{action.order_id}</span>
              </Row>
              <Row k="Amount">{money(action.amount)}</Row>
              <Row k="Result">
                <Chip tone={action.status === "executed" ? "emerald" : action.status === "pending_approval" ? "amber" : "rose"}>{humanize(action.status)}</Chip>
              </Row>
            </>
          )}
        </div>
      );
    }
    case "escalation_agent": {
      const rationale = (d.priority_rationale as string[]) ?? [];
      return (
        <div className="space-y-1">
          <Row k="Ticket">
            <span className="font-mono">{String(d.ticket_id)}</span>
          </Row>
          <Row k="Priority">
            <PriorityPill priority={String(d.priority)} />
          </Row>
          <Row k="Routed to">{String(d.team)}</Row>
          <Row k="Reason">{String(d.reason)}</Row>
          {Boolean(d.approval) && (
            <Row k="Approval queued">
              <Chip tone="amber">
                {(d.approval as ActionSummary).label} · {money((d.approval as ActionSummary).amount)}
              </Chip>
            </Row>
          )}
          {rationale.length > 0 && <p className="pt-1 text-[11px] text-slate-500">{rationale.join(" · ")}</p>}
        </div>
      );
    }
    case "memory_manager": {
      const remembered = (d.remembered as Record<string, unknown>) ?? {};
      return (
        <div className="space-y-1">
          <Row k="Stored">{Object.keys(remembered).length ? Object.entries(remembered).map(([k, v]) => `${k}: ${String(v)}`).join(", ") : "turn saved to thread"}</Row>
          {Boolean(d.summarized) && <Row k="Summary">older turns summarized</Row>}
        </div>
      );
    }
    default:
      return null;
  }
}
