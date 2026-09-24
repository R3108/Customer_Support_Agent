"use client";

import { Activity, Crown, RotateCcw, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentTrace } from "@/components/AgentTrace";
import { ChatPanel } from "@/components/ChatPanel";
import { SidePanel } from "@/components/ui/SidePanel";
import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useAsync } from "@/hooks/useAsync";
import { useChat } from "@/hooks/useChat";
import { api } from "@/lib/api";
import { cx, humanize } from "@/lib/format";
import { brandStyle } from "@/lib/theme";

const SCENARIOS: { title: string; text: string; customerId: string | null; tag: string }[] = [
  { title: "Track an order", text: "Where is my order?", customerId: "CUST-001", tag: "Account data" },
  { title: "AI cancels an order", text: "Please cancel my order", customerId: "CUST-004", tag: "Agentic action" },
  { title: "Return by product name", text: "Can I return the down jacket I bought?", customerId: "CUST-001", tag: "Memory + action" },
  { title: "Guest lookup + verification", text: "What's the status of ORD-10397?", customerId: null, tag: "Verification" },
  { title: "Refund over approval limit", text: "I want a refund for ORD-10350", customerId: "CUST-003", tag: "Approval queue" },
  { title: "Spanish-speaking customer", text: "¿Dónde está mi pedido?", customerId: "CUST-001", tag: "Multilingual" },
  { title: "Unanswered question", text: "Do you sell bicycles?", customerId: "CUST-002", tag: "Knowledge gap" },
  { title: "Help-center question", text: "Do you ship to Canada?", customerId: "CUST-005", tag: "RAG" },
  { title: "Damaged item", text: "My order arrived damaged", customerId: "CUST-005", tag: "Clarify → escalate" },
  { title: "Fraud report", text: "There's an unauthorized charge on my card!", customerId: "CUST-002", tag: "Hard trigger" },
  { title: "Out of scope", text: "What's the capital of France?", customerId: "CUST-004", tag: "Guardrail" },
];

export function DemoPlayground() {
  const [customerId, setCustomerId] = useState<string | null>("CUST-001");
  const [queued, setQueued] = useState<{ customerId: string | null; text: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const toast = useToast();
  const customers = useAsync(() => api.demoCustomers(), "demo-customers");
  const config = useAsync(() => api.config(), "config");
  const chat = useChat(customerId);
  const { send } = chat;

  useEffect(() => {
    if (!queued || queued.customerId !== customerId) return;
    const timer = window.setTimeout(() => {
      void send(queued.text);
      setQueued(null);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [queued, customerId, send]);

  const runScenario = (s: (typeof SCENARIOS)[number]) => {
    if (chat.pending) return;
    try {
      window.localStorage.removeItem(`relay.conversation.${s.customerId ?? "guest"}`);
    } catch {
      /* ignore */
    }
    if (s.customerId === customerId) chat.reset();
    setCustomerId(s.customerId);
    setQueued({ customerId: s.customerId, text: s.text });
  };

  const resetOrders = async () => {
    setResetting(true);
    try {
      await api.resetDemoOrders();
      customers.reload();
      toast.success("Demo orders restored");
    } catch (e) {
      toast.error(e, "Couldn't reset the demo orders.");
    } finally {
      setResetting(false);
    }
  };

  const steps = chat.pending ? chat.liveSteps : chat.lastSteps;
  const lastMeta = [...chat.messages].reverse().find((m) => m.role === "assistant")?.meta;
  const active = customers.data?.find((c) => c.id === customerId);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_360px]">
      {/* Left: identity + scenarios */}
      <aside className="hidden min-h-0 flex-col overflow-y-auto border-r border-slate-200 bg-surface lg:flex">
        <section className="border-b border-slate-100 p-4">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <UserRound className="h-3.5 w-3.5" /> Signed in as
          </h2>
          {!customers.data && !customers.error && (
            <LoadingRegion label="Loading demo customers" className="mt-2 space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                  <Skeleton className="h-7 w-7 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                </div>
              ))}
            </LoadingRegion>
          )}
          <div className="mt-2 space-y-1">
            <IdentityButton active={customerId === null} onClick={() => setCustomerId(null)} name="Guest visitor" detail="Not signed in · must verify email" />
            {customers.data?.map((c) => (
              <IdentityButton
                key={c.id}
                active={customerId === c.id}
                onClick={() => setCustomerId(c.id)}
                name={c.name}
                detail={`${c.orders.length} orders`}
                vip={c.tier === "Aurora+"}
              />
            ))}
          </div>
          {active && (
            <div className="mt-3 rounded-lg bg-slate-50 p-2.5">
              <p className="text-[11px] font-medium text-slate-500">Orders (click to ask)</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {active.orders.map((o) => (
                  <button
                    key={o.id}
                    disabled={chat.pending}
                    onClick={() => void chat.send(`What's the status of ${o.id}?`)}
                    className="rounded border border-slate-200 bg-surface px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:border-brand-300 hover:text-brand-700"
                    title={humanize(o.status)}
                  >
                    {o.id}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="p-4">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Sparkles className="h-3.5 w-3.5" /> Try a scenario
          </h2>
          <div className="mt-2 space-y-1.5">
            {SCENARIOS.map((s) => (
              <button
                key={s.title}
                onClick={() => runScenario(s)}
                disabled={chat.pending}
                className="w-full rounded-lg border border-slate-200 p-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-slate-800">{s.title}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{s.tag}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">“{s.text}”</p>
              </button>
            ))}
          </div>
          <button
            onClick={() => void resetOrders()}
            disabled={resetting}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-50"
            title="Undo cancellations, returns and refunds made during the demo"
          >
            <RotateCcw className={cx("h-3.5 w-3.5", resetting && "animate-spin")} aria-hidden /> Reset demo orders
          </button>
        </section>
      </aside>

      {/* Center: chat */}
      <section className="flex min-h-0 flex-col bg-slate-100 p-0 sm:p-4">
        <div
          className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-sm"
          style={brandStyle(config.data?.accent_color)}
        >
          {/* Mobile identity switcher */}
          <div className="grid grid-cols-2 gap-2 border-b border-slate-200 bg-surface px-3 py-2 lg:hidden">
            <select
              value={customerId ?? ""}
              onChange={(e) => setCustomerId(e.target.value || null)}
              className="min-w-0 rounded-md border border-slate-200 bg-surface px-2 py-1 text-sm text-slate-900"
              aria-label="Signed in as"
            >
              <option value="">Guest visitor</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.tier})
                </option>
              ))}
            </select>
            <select
              value=""
              disabled={chat.pending}
              onChange={(e) => {
                const scenario = SCENARIOS[Number(e.target.value)];
                if (scenario) runScenario(scenario);
              }}
              className="min-w-0 rounded-md border border-slate-200 bg-surface px-2 py-1 text-sm text-slate-900"
              aria-label="Try a scenario"
            >
              <option value="" disabled>
                Try a scenario…
              </option>
              {SCENARIOS.map((s, i) => (
                <option key={s.title} value={i}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
          <ChatPanel
            chat={chat}
            headerExtra={
              <button
                onClick={() => setShowTrace(true)}
                className="relative flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 xl:hidden"
                aria-label="Show agent trace"
              >
                <Activity className="h-3.5 w-3.5 text-brand-600" aria-hidden /> <span className="hidden sm:inline">Trace</span>
                {chat.pending && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-surface bg-brand-500" />}
              </button>
            }
            showMeta
            assistantName={config.data?.assistant_name}
            companyName={config.data?.company_name}
            welcome={config.data?.welcome_message}
            suggestions={config.data?.suggested_prompts ?? ["Where is my order?", "What's your return policy?", "Talk to a human"]}
          />
        </div>
      </section>

      {/* Right: agent trace */}
      <SidePanel open={showTrace} onClose={() => setShowTrace(false)} label="Agent trace" className="bg-slate-50">
        <div className="flex items-center justify-between border-b border-slate-200 bg-surface px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Activity className="h-4 w-4 text-brand-600" /> Agent trace
          </h2>
          {!chat.pending && lastMeta?.latency_ms !== undefined && (
            <span className="text-[11px] text-slate-500">
              {lastMeta.latency_ms} ms · {lastMeta.mode === "llm" ? "LLM" : "offline"}
            </span>
          )}
          {chat.pending && <span className="text-[11px] font-medium text-brand-600">running…</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AgentTrace steps={steps} live={chat.pending} threshold={config.data?.confidence_threshold} />
        </div>
      </SidePanel>
    </div>
  );
}

function IdentityButton({ active, onClick, name, detail, vip }: { active: boolean; onClick: () => void; name: string; detail: string; vip?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition",
        active ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-slate-50",
      )}
    >
      <div
        className={cx(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600",
        )}
      >
        {name
          .split(" ")
          .map((p) => p[0])
          .join("")
          .slice(0, 2)}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[13px] font-medium text-slate-800">
          <span className="truncate">{name}</span>
          {vip && <Crown className="h-3 w-3 shrink-0 text-amber-500" />}
        </div>
        <div className="truncate text-[11px] text-slate-500">{detail}</div>
      </div>
    </button>
  );
}
