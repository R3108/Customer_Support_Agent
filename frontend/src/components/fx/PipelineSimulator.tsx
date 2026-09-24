"use client";

import { BookOpen, Brain, CheckCircle2, Headset, MessageSquareText, Pause, Play, User, Zap } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { cx } from "@/lib/format";

type NodeId = "customer" | "intent" | "retrieve" | "support" | "reply" | "action" | "escalate";
type Tone = "emerald" | "brand" | "amber" | "rose";

// Coordinates in the 760×260 diagram space; nodes are HTML positioned by percentage so the diagram scales.
const NODES: Record<NodeId, { x: number; y: number; label: string; agent: string; icon: typeof User }> = {
  customer: { x: 60, y: 130, label: "Customer", agent: "Customer", icon: User },
  intent: { x: 205, y: 130, label: "Intent", agent: "Intent Classifier", icon: Brain },
  retrieve: { x: 350, y: 130, label: "Retrieve", agent: "Knowledge Retriever", icon: BookOpen },
  support: { x: 495, y: 130, label: "Support", agent: "Support Agent", icon: MessageSquareText },
  reply: { x: 685, y: 45, label: "Resolved", agent: "Resolved by AI", icon: CheckCircle2 },
  action: { x: 685, y: 130, label: "Action", agent: "Action Agent", icon: Zap },
  escalate: { x: 685, y: 215, label: "Handoff", agent: "Escalation Agent", icon: Headset },
};

const EDGES: Record<string, string> = {
  "customer-intent": "M60 130 H205",
  "intent-retrieve": "M205 130 H350",
  "retrieve-support": "M350 130 H495",
  "support-reply": "M495 130 C590 130 590 45 685 45",
  "support-action": "M495 130 H685",
  "support-escalate": "M495 130 C590 130 590 215 685 215",
  "intent-escalate": "M205 130 C205 262 600 262 685 215",
};

type Scenario = { id: string; label: string; message: string; tone: Tone; path: NodeId[]; trace: string[]; outcome: string };

const SCENARIOS: Scenario[] = [
  {
    id: "status",
    label: "Order status",
    message: "Hi! Where is order ORD-10342?",
    tone: "emerald",
    path: ["customer", "intent", "retrieve", "support", "reply"],
    trace: ["order_status · 0.94 · neutral", "ORD-10342 · owner verified · shipping.md", "grounded reply + tracking link · conf 0.91", "answered in 1.2s, no human needed"],
    outcome: "Resolved by AI",
  },
  {
    id: "cancel",
    label: "Cancel order",
    message: "Please cancel ORD-10377, I ordered the wrong size.",
    tone: "brand",
    path: ["customer", "intent", "retrieve", "support", "action"],
    trace: ["cancel_order · 0.92", "ORD-10377 · unshipped · orders_cancellations.md", "asked to confirm → customer said yes", "order cancelled · $89.00 refunded"],
    outcome: "Action executed",
  },
  {
    id: "refund",
    label: "Refund over limit",
    message: "I want a refund for the kayak I got last week.",
    tone: "amber",
    path: ["customer", "intent", "retrieve", "support", "escalate"],
    trace: ["refund_request · 0.90", "ORD-10350 · inside 90-day window", "$1,248.05 exceeds self-service limit", "TCK-302DCD → Returns · High · 4h SLA"],
    outcome: "Queued for approval",
  },
  {
    id: "human",
    label: "Asks for a human",
    message: "This is ridiculous. Let me talk to a real person.",
    tone: "rose",
    path: ["customer", "intent", "escalate"],
    trace: ["human_request · sentiment negative · safety rule", "priority handoff with written briefing"],
    outcome: "Scoring bypassed by rule",
  },
];

const TONES: Record<Tone, { stroke: string; node: string; text: string; badge: string; chip: string }> = {
  emerald: {
    stroke: "#34d399",
    node: "border-emerald-400/60 bg-emerald-400/15 text-emerald-200",
    text: "text-emerald-300",
    badge: "bg-emerald-400/15 text-emerald-200 ring-emerald-400/30",
    chip: "bg-emerald-400/15 text-emerald-200 ring-emerald-400/40",
  },
  brand: {
    stroke: "#a5b4fc",
    node: "border-indigo-300/60 bg-indigo-400/15 text-indigo-100",
    text: "text-indigo-300",
    badge: "bg-indigo-400/15 text-indigo-100 ring-indigo-300/30",
    chip: "bg-indigo-400/15 text-indigo-100 ring-indigo-300/40",
  },
  amber: {
    stroke: "#fbbf24",
    node: "border-amber-400/60 bg-amber-400/15 text-amber-200",
    text: "text-amber-300",
    badge: "bg-amber-400/15 text-amber-200 ring-amber-400/30",
    chip: "bg-amber-400/15 text-amber-200 ring-amber-400/40",
  },
  rose: {
    stroke: "#fb7185",
    node: "border-rose-400/60 bg-rose-400/15 text-rose-200",
    text: "text-rose-300",
    badge: "bg-rose-400/15 text-rose-200 ring-rose-400/30",
    chip: "bg-rose-400/15 text-rose-200 ring-rose-400/40",
  },
};

const edgeKey = (a: NodeId, b: NodeId) => `${a}-${b}`;

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useReducedMotion = () =>
  useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);

/**
 * Interactive diagram of a message travelling through Relay's agent graph. Autoplays through the scenarios
 * while on screen; picking one pauses autoplay. With reduced motion, each scenario shows its final state.
 */
export function PipelineSimulator() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const reduced = useReducedMotion();

  const scenario = SCENARIOS[index];
  const last = scenario.path.length - 1;
  const shown = reduced ? last : step;
  const tone = TONES[scenario.tone];

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Advance one hop at a time; after a pause on the outcome, autoplay moves to the next scenario.
  useEffect(() => {
    if (!visible || reduced || (step >= last && !auto)) return;
    const t = setTimeout(
      () => {
        if (step < last) {
          setStep(step + 1);
        } else {
          setIndex((index + 1) % SCENARIOS.length);
          setStep(0);
        }
      },
      step === 0 ? 700 : step < last ? 1000 : 3200,
    );
    return () => clearTimeout(t);
  }, [visible, reduced, step, last, auto, index]);

  const pick = (i: number) => {
    setIndex(i);
    setStep(0);
    setAuto(false);
  };

  const litEdges = new Set(scenario.path.slice(0, shown).map((n, i) => edgeKey(n, scenario.path[i + 1])));
  const activeEdge = shown > 0 ? edgeKey(scenario.path[shown - 1], scenario.path[shown]) : null;

  return (
    <div ref={rootRef} className="overflow-hidden rounded-3xl bg-ink-950 text-white shadow-2xl ring-1 ring-white/10">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-4">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => pick(i)}
            aria-pressed={i === index}
            className={cx(
              "rounded-full px-3 py-1 text-xs font-medium ring-1 transition",
              i === index ? TONES[s.tone].chip : "text-slate-400 ring-white/10 hover:bg-white/5 hover:text-white",
            )}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={() => setAuto((v) => !v)}
          className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-slate-400 ring-1 ring-white/10 hover:text-white"
          aria-label={auto ? "Pause autoplay" : "Resume autoplay"}
        >
          {auto ? <Pause className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}
          {auto ? "Autoplay" : "Paused"}
        </button>
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr]">
        <div className="relative overflow-x-auto p-5">
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />
          <p key={scenario.id} className="animate-bubble relative mb-3 w-fit max-w-full rounded-2xl rounded-bl-md bg-white/10 px-3 py-2 text-sm text-slate-100">
            “{scenario.message}”
          </p>
          <div
            className="relative aspect-[760/262] min-w-[600px]"
            role="img"
            aria-label={`Route: ${scenario.path.map((n) => NODES[n].agent).join(" → ")}. Outcome: ${scenario.outcome}.`}
          >
            <svg viewBox="0 0 760 262" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              {Object.entries(EDGES).map(([key, d]) => (
                <g key={key}>
                  <path d={d} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth={2} strokeDasharray="4 6" />
                  <path
                    d={d}
                    fill="none"
                    stroke={tone.stroke}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    pathLength={1}
                    className="pipeline-edge"
                    style={{ strokeDashoffset: litEdges.has(key) ? 0 : 1 }}
                  />
                </g>
              ))}
              {activeEdge && !reduced && <Packet key={`${scenario.id}-${shown}`} d={EDGES[activeEdge]} color={tone.stroke} />}
            </svg>
            {(Object.keys(NODES) as NodeId[]).map((id) => {
              const node = NODES[id];
              const pos = scenario.path.indexOf(id);
              const reached = pos !== -1 && pos <= shown;
              const current = pos === shown;
              const Icon = node.icon;
              return (
                <div
                  key={id}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
                  style={{ left: `${(node.x / 760) * 100}%`, top: `${(node.y / 262) * 100}%` }}
                >
                  <div
                    className={cx(
                      "relative flex h-11 w-11 items-center justify-center rounded-xl border transition-all duration-500",
                      reached ? tone.node : "border-white/10 bg-ink-950 text-slate-500",
                      current && "scale-110",
                    )}
                  >
                    {current && !reduced && <span className={cx("pipeline-ping absolute inset-0 rounded-xl border-2", tone.node)} aria-hidden />}
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className={cx("text-[11px] font-medium transition-colors", reached ? "text-slate-200" : "text-slate-500")}>{node.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-white/10 bg-white/[0.03] p-5 lg:border-l lg:border-t-0">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Agent trace</p>
            {shown === last && (
              <span key={scenario.id} className={cx("animate-bubble rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", tone.badge)}>
                {scenario.outcome}
              </span>
            )}
          </div>
          <ol className="min-h-[15rem] space-y-2.5 font-mono text-[11.5px]">
            {scenario.trace.map((line, i) => {
              const node = NODES[scenario.path[i + 1]];
              const done = i < shown;
              return (
                <li
                  key={`${scenario.id}-${i}`}
                  className={cx("flex gap-2.5 rounded-lg p-2 transition-all duration-500", done ? "bg-white/5 opacity-100" : "translate-y-1 opacity-25")}
                >
                  <node.icon className={cx("mt-0.5 h-3.5 w-3.5 shrink-0", done ? tone.text : "text-slate-500")} aria-hidden />
                  <div className="min-w-0">
                    <div className="font-sans text-xs font-medium text-slate-200">{node.agent}</div>
                    <div className="mt-0.5 text-slate-400">{done ? line : "…"}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** A glowing dot that travels once along `d` (SMIL, restarted on mount so it works mid-document). */
function Packet({ d, color }: { d: string; color: string }) {
  const ref = useRef<SVGAnimateMotionElement>(null);
  useLayoutEffect(() => {
    ref.current?.beginElement();
  }, []);
  return (
    <g>
      <circle r={9} fill={color} opacity={0.25} />
      <circle r={4} fill="white" opacity={0.95} />
      <animateMotion ref={ref} dur="0.9s" begin="indefinite" fill="freeze" path={d} calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1" />
    </g>
  );
}
