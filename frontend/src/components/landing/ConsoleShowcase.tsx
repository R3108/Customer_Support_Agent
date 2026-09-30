"use client";

import { BarChart3, Check, CheckCircle2, Languages, Lightbulb, MousePointer2, ShieldCheck, Wand2, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { AnimatedValue } from "@/components/fx/AnimatedValue";
import { useInView } from "@/hooks/useInView";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cx } from "@/lib/format";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

const TABS = [
  {
    id: "approvals",
    icon: CheckCircle2,
    title: "One-click approvals",
    body: "Refunds above your limit arrive pre-checked, with the policy, the order and the AI's reasoning side by side.",
  },
  {
    id: "copilot",
    icon: Wand2,
    title: "Specialist copilot",
    body: "Rewrite any reply friendlier, shorter or more formal, or translate it — without leaving the ticket.",
  },
  {
    id: "gaps",
    icon: Lightbulb,
    title: "Knowledge gaps",
    body: "Unanswered questions are clustered, and resolved tickets become draft articles with personal data removed.",
  },
  {
    id: "analytics",
    icon: BarChart3,
    title: "Live analytics",
    body: "Automation rate, SLA compliance, CSAT and hours saved update as conversations happen.",
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Tabbed tour of the specialist console. The active tab's progress bar is a CSS animation; when it ends the
 * next tab opens. It pauses off-screen, on hover or focus, and stops for good once a tab is picked.
 */
export function ConsoleShowcase() {
  const [rootRef, visible] = useInView({ threshold: 0.3 });
  const reduced = useReducedMotion();
  const [active, setActive] = useState<TabId>("approvals");
  const [auto, setAuto] = useState(true);
  const [hovered, setHovered] = useState(false);

  const running = auto && visible && !hovered && !reduced;
  const next = () => setActive((id) => TABS[(TABS.findIndex((t) => t.id === id) + 1) % TABS.length].id);

  return (
    <div
      ref={rootRef}
      className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div role="tablist" aria-label="Console features" aria-orientation="vertical" className="flex flex-col gap-2">
        {TABS.map(({ id, icon: Icon, title, body }) => {
          const selected = id === active;
          return (
            <button
              key={id}
              role="tab"
              id={`showcase-tab-${id}`}
              aria-selected={selected}
              aria-controls="showcase-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                setActive(id);
                setAuto(false);
              }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const i = TABS.findIndex((t) => t.id === id) + (e.key === "ArrowDown" ? 1 : -1);
                const target = TABS[(i + TABS.length) % TABS.length].id;
                setActive(target);
                setAuto(false);
                document.getElementById(`showcase-tab-${target}`)?.focus();
              }}
              className={cx(
                "group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-300",
                selected ? "border-slate-200 bg-white shadow-lg shadow-slate-900/5" : "border-transparent hover:bg-white/60",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cx(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                    selected ? "bg-brand-600 text-white" : "bg-slate-200/70 text-slate-500 group-hover:text-slate-700",
                  )}
                >
                  <Icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <span className={cx("font-semibold transition-colors", selected ? "text-slate-900" : "text-slate-600")}>{title}</span>
              </div>
              <div className={cx("showcase-body", selected && "is-open")}>
                <p className="overflow-hidden pl-12 text-sm leading-relaxed text-slate-600">
                  <span className="block pt-2">{body}</span>
                </p>
              </div>
              {selected && auto && !reduced && (
                <span
                  key={id}
                  aria-hidden
                  className="tab-progress absolute inset-x-0 bottom-0 h-0.5 bg-brand-500"
                  style={{ animationPlayState: running ? "running" : "paused" }}
                  onAnimationEnd={next}
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        id="showcase-panel"
        role="tabpanel"
        aria-labelledby={`showcase-tab-${active}`}
        className="relative min-h-[360px] overflow-hidden rounded-3xl bg-ink-950 p-2 shadow-2xl shadow-slate-900/20 ring-1 ring-white/10"
      >
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
        <div aria-hidden className="aurora-b pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-500/25 blur-3xl" />
        <div className="relative flex items-center gap-1.5 px-3 pb-2 pt-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-3 font-mono text-[11px] text-slate-500">relay / console</span>
        </div>
        <div key={active} className="showcase-panel relative h-[calc(100%-2rem)] rounded-2xl bg-white p-5 text-slate-900">
          {active === "approvals" && <ApprovalsMock />}
          {active === "copilot" && <CopilotMock />}
          {active === "gaps" && <GapsMock />}
          {active === "analytics" && <AnalyticsMock />}
        </div>
      </div>
    </div>
  );
}

function PanelHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <p className="font-semibold">{title}</p>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{meta}</span>
    </div>
  );
}

function ApprovalsMock() {
  return (
    <div className="text-sm">
      <PanelHeader title="Pending approvals" meta="Sample data" />
      <div className="animate-bubble rounded-xl border border-slate-200 p-4 [animation-delay:100ms]">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-slate-500">TCK-302DCD</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">High · 4h SLA</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">Returns</span>
        </div>
        <p className="mt-3 font-medium">Refund ORD-10350 · Explorer 12′ Kayak</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          {[
            ["Amount", "$1,248.05"],
            ["Your limit", "$250.00"],
            ["Return window", "Day 8 of 90"],
          ].map(([k, v], i) => (
            <div key={k} className="animate-bubble rounded-lg bg-slate-50 p-2" style={{ animationDelay: `${250 + i * 120}ms` }}>
              <div className="text-slate-500">{k}</div>
              <div className="mt-0.5 font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <p className="animate-bubble mt-3 rounded-lg border-l-2 border-brand-400 bg-brand-50/60 px-3 py-2 text-xs leading-relaxed text-slate-700 [animation-delay:650ms]">
          <b>AI reasoning:</b> owner verified by email, item returned unused, inside the 90-day window. Only the amount needs sign-off.
        </p>
        <div className="relative mt-4 flex items-center gap-2">
          <span className="approve-btn inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white">
            <Check className="h-3.5 w-3.5" aria-hidden /> Approve refund
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600">
            <X className="h-3.5 w-3.5" aria-hidden /> Decline
          </span>
          <MousePointer2 aria-hidden className="demo-cursor absolute left-16 top-3 h-5 w-5 fill-slate-900 text-white drop-shadow" />
          <span className="approve-done ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Refunded · customer notified
          </span>
        </div>
      </div>
    </div>
  );
}

function CopilotMock() {
  const tones = ["Friendlier", "Shorter", "More formal"];
  return (
    <div className="text-sm">
      <PanelHeader title="Reply to Maya R. · TCK-4A19E0" meta="Sample data" />
      <div className="animate-bubble w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 [animation-delay:100ms]">
        My boots arrived with a torn seam. Second time this happens!!
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Wand2 className="h-4 w-4 text-brand-600" aria-hidden />
        {tones.map((t, i) =>
          i === 0 ? (
            // Timings for both its entrance and the "picked" highlight live in `.copilot-pick`.
            <span key={t} className="copilot-pick rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200">
              {t}
            </span>
          ) : (
            <span
              key={t}
              className="animate-bubble rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200"
              style={{ animationDelay: `${200 + i * 80}ms` }}
            >
              {t}
            </span>
          ),
        )}
        <span className="animate-bubble inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200 [animation-delay:440ms]">
          <Languages className="h-3 w-3" aria-hidden /> Translate
        </span>
      </div>
      <div className="mt-3 grid rounded-xl border border-slate-200 p-3 text-[13px] leading-relaxed">
        <p className="copilot-before col-start-1 row-start-1 text-slate-600">
          We have received your complaint regarding order ORD-10388. A replacement can be issued under the warranty policy.
        </p>
        <p className="copilot-after col-start-1 row-start-1 text-slate-800">
          I&apos;m so sorry, Maya — a torn seam twice is not okay. I&apos;ve started a free replacement for ORD-10388 under our warranty, and
          you&apos;ll get a prepaid label for the old pair by email today.
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          Macro: <span className="font-mono text-slate-700">{"{{order_id}}"}</span> filled automatically
        </span>
        <span className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white">Send</span>
      </div>
    </div>
  );
}

function GapsMock() {
  const gaps = [
    ["Gift wrapping for international orders", 38],
    ["Can I combine two orders into one shipment?", 27],
    ["Warranty for items bought at retail stores", 19],
  ] as const;
  return (
    <div className="text-sm">
      <PanelHeader title="Questions the AI couldn't answer" meta="Last 30 days" />
      <ul className="space-y-3">
        {gaps.map(([q, n], i) => (
          <li key={q} className="animate-bubble" style={{ animationDelay: `${100 + i * 120}ms` }}>
            <div className="flex justify-between gap-3 text-[13px]">
              <span className="truncate text-slate-700">{q}</span>
              <span className="shrink-0 tabular-nums text-slate-500">{n} asks</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-slate-100">
              <div className="bar-x h-full rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-400" style={{ width: `${(n / 40) * 100}%`, ...stagger(i + 3) }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="animate-bubble mt-5 rounded-xl border border-dashed border-brand-300 bg-brand-50/50 p-3 [animation-delay:600ms]">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-slate-900">Draft article: “Combining orders”</p>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">
            <ShieldCheck className="h-3 w-3" aria-hidden /> PII redacted
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-600">Written from 12 resolved tickets · review and publish to the knowledge base.</p>
        <div className="mt-2.5 space-y-1.5" aria-hidden>
          <div className="skeleton h-2 w-full" />
          <div className="skeleton h-2 w-4/5" />
        </div>
      </div>
    </div>
  );
}

function AnalyticsMock() {
  const days = [42, 55, 48, 61, 58, 70, 74];
  return (
    <div className="text-sm">
      <PanelHeader title="This week" meta="Sample data" />
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Automation", "71%"],
          ["Saved", "$4,920"],
          ["SLA met", "96%"],
        ].map(([k, v], i) => (
          <div key={k} className="animate-bubble rounded-xl border border-slate-200 p-3" style={{ animationDelay: `${100 + i * 100}ms` }}>
            <div className="text-xs text-slate-500">{k}</div>
            <div className="mt-1 text-xl font-semibold tracking-tight">
              <AnimatedValue value={v} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 p-3">
        <div className="mb-2 flex justify-between text-xs text-slate-500">
          <span>Resolved by AI, per day</span>
          <span className="text-emerald-600">▲ 18%</span>
        </div>
        <div className="flex h-28 items-end gap-2" aria-hidden>
          {days.map((d, i) => (
            <div key={i} className="flex h-full flex-1 flex-col justify-end">
              <div
                className="bar-y rounded-t-md bg-gradient-to-t from-brand-600 to-brand-400"
                style={{ height: `${(d / 80) * 100}%`, ...stagger(i + 2) }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-slate-400" aria-hidden>
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={i} className="flex-1 text-center">
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
