"use client";

import { CheckCircle2, Headset, Languages, Pause, Play, RotateCcw, SendHorizontal, Zap } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Tilt } from "@/components/fx/Tilt";
import { LogoMark } from "@/components/Logo";
import { useInView } from "@/hooks/useInView";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cx } from "@/lib/format";

type Tone = "amber" | "emerald" | "brand";
type Scenario = {
  id: string;
  message: string;
  /** Reply text; **double asterisks** mark bold runs. */
  reply: string;
  tone: Tone;
  extra?: ReactNode;
  chips: { label: string; className: string }[];
  route: string[];
  notice: { icon: typeof Zap; title: string; sub: string };
};

const SCENARIOS: Scenario[] = [
  {
    id: "refund",
    message: "I want a refund for the kayak I got last week",
    reply:
      "I checked **ORD-10350** — it's within your 90-day window. Because the refund (**$1,248.05**) is over our self-service limit, a specialist needs to approve it.",
    tone: "amber",
    extra: (
      <div className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
        Ticket <b>TCK-302DCD</b> · Returns · <b>High</b> priority — reply within 4 business hours
      </div>
    ),
    chips: [
      { label: "90% confidence", className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
      { label: "Returns & refunds", className: "bg-slate-200/70 text-slate-700" },
      { label: "Policy escalation", className: "bg-amber-100 text-amber-800" },
    ],
    route: ["intent", "retrieve", "support", "escalate"],
    notice: { icon: Headset, title: "TCK-302DCD → Returns team", sub: "Escalation Agent · briefing attached" },
  },
  {
    id: "status",
    message: "¿Dónde está mi pedido ORD-10342?",
    reply: "¡Buenas noticias! Tu pedido **ORD-10342** ya salió de nuestro almacén y está en camino. Te dejo el enlace de seguimiento aquí abajo.",
    tone: "emerald",
    extra: (
      <div className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
        <span>
          <b>ORD-10342</b> · En camino
        </span>
        <span className="font-medium text-brand-600">Seguir envío →</span>
      </div>
    ),
    chips: [
      { label: "94% confidence", className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
      { label: "Order status", className: "bg-slate-200/70 text-slate-700" },
      { label: "Replied in Spanish", className: "bg-sky-100 text-sky-800" },
    ],
    route: ["intent", "retrieve", "support", "reply"],
    notice: { icon: Languages, title: "Resolved in Spanish", sub: "Support Agent · no human needed" },
  },
  {
    id: "cancel",
    message: "Please cancel ORD-10377, I ordered the wrong size.",
    reply: "No problem — **ORD-10377** hasn't shipped yet, so I can cancel it and refund **$89.00** to your original payment method. Shall I go ahead?",
    tone: "brand",
    extra: (
      <div className="flex gap-1.5 text-xs">
        <span className="hero-confirm rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white">Yes, cancel it</span>
        <span className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600">Keep my order</span>
      </div>
    ),
    chips: [
      { label: "92% confidence", className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
      { label: "Cancel order", className: "bg-slate-200/70 text-slate-700" },
      { label: "Action executed", className: "bg-brand-100 text-brand-800" },
    ],
    route: ["intent", "retrieve", "support", "action"],
    notice: { icon: CheckCircle2, title: "ORD-10377 cancelled · $89.00 refunded", sub: "Action Agent · resolved in chat" },
  },
];

const BUBBLE_TONE: Record<Tone, string> = { amber: "border-amber-200", emerald: "border-emerald-200", brand: "border-brand-200" };
const ROUTE_TONE: Record<Tone, string> = {
  amber: "bg-amber-500/20 text-amber-200 ring-amber-400/50",
  emerald: "bg-emerald-500/20 text-emerald-200 ring-emerald-400/50",
  brand: "bg-indigo-500/25 text-indigo-100 ring-indigo-300/50",
};
const NOTICE_TONE: Record<Tone, string> = {
  amber: "bg-amber-400/15 text-amber-300",
  emerald: "bg-emerald-400/15 text-emerald-300",
  brand: "bg-indigo-400/15 text-indigo-200",
};

type Phase = "typing" | "sent" | "thinking" | "streaming" | "done" | "leaving";
type State = {
  index: number;
  phase: Phase;
  typed: number;
  hops: number;
  /** The server-rendered opening frame: shown complete, without entrance animations. */
  initial: boolean;
  /** Set once playback wraps back to the first conversation; it stops when that one finishes. */
  looped: boolean;
};

const WORD_MS = 42;
/** Long enough to read the longest finished conversation (~40 words). */
const HOLD_MS = 7000;

const finishedState = (index: number, extra: Partial<State> = {}): State => ({
  index,
  phase: "done",
  typed: SCENARIOS[index].message.length,
  hops: SCENARIOS[index].route.length,
  initial: false,
  looped: false,
  ...extra,
});
const START = finishedState(0, { initial: true });

/** Splits the reply into words, keeping **bold** runs, so each word can fade in on its own delay. */
function words(reply: string) {
  return reply
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .flatMap((part) => {
      const bold = part.startsWith("**");
      return (bold ? part.slice(2, -2) : part)
        .split(/(?<=\s)/)
        .filter(Boolean)
        .map((text) => ({ text, bold }));
    });
}

/** How long to stay in a phase before `advance` runs. */
function delay(s: State): number {
  const sc = SCENARIOS[s.index];
  switch (s.phase) {
    case "typing":
      return s.typed === 0 ? 400 : s.typed < sc.message.length ? 34 : 350;
    case "sent":
      return 450;
    case "thinking":
      return 520;
    case "streaming":
      return words(sc.reply).length * WORD_MS + 450;
    case "done":
      return HOLD_MS;
    case "leaving":
      return 450;
  }
}

const isStopped = (s: State) => s.phase === "done" && s.index === 0 && s.looped;

function advance(s: State): State {
  const sc = SCENARIOS[s.index];
  switch (s.phase) {
    case "typing":
      return s.typed < sc.message.length ? { ...s, typed: s.typed + 1 } : { ...s, phase: "sent", hops: 1 };
    case "sent":
      return { ...s, phase: "thinking" };
    case "thinking":
      // Light the route one hop at a time; the last hop lands with the finished reply.
      return s.hops < sc.route.length - 1 ? { ...s, hops: s.hops + 1 } : { ...s, phase: "streaming" };
    case "streaming":
      return { ...s, phase: "done", hops: sc.route.length };
    case "done":
      return { ...s, phase: "leaving", initial: false };
    case "leaving": {
      const index = (s.index + 1) % SCENARIOS.length;
      return { index, phase: "typing", typed: 0, hops: 0, initial: false, looped: s.looped || index === 0 };
    }
  }
}

/**
 * The hero's 3D product shot. It opens on a finished conversation (also what the server renders), then plays
 * the others: the customer types, the agent route lights up hop by hop while Relay "thinks", and the reply
 * streams in word by word before the outcome appears. It runs once through every conversation and stops on
 * the first; it pauses while hovered or off screen, and a Pause / Play / Replay button gives explicit control.
 * With reduced motion it shows the first conversation's finished state only.
 */
export function HeroPreview() {
  const [ref, visible] = useInView({ threshold: 0.2 });
  const reduced = useReducedMotion();
  const [live, setLive] = useState<State>(START);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const s: State = reduced ? START : live;
  const sc = SCENARIOS[s.index];
  const stopped = isStopped(s);
  const sent = s.phase !== "typing";
  const replying = s.phase === "streaming" || s.phase === "done" || s.phase === "leaving";
  const finished = s.phase === "done" || s.phase === "leaving";
  // The opening frame is already complete, so it skips the entrance animations.
  const enter = s.initial ? undefined : "animate-bubble";

  useEffect(() => {
    if (reduced || !visible || paused || hovered || isStopped(live)) return;
    const t = setTimeout(() => setLive(advance), delay(live));
    return () => clearTimeout(t);
  }, [live, reduced, visible, paused, hovered]);

  const control = stopped
    ? { label: "Replay", name: "Replay the example conversations", icon: RotateCcw, run: () => setLive(finishedState(0, { phase: "leaving" })) }
    : paused
      ? { label: "Play", name: "Resume the example conversations", icon: Play, run: () => setPaused(false) }
      : { label: "Pause", name: "Pause the example conversations", icon: Pause, run: () => setPaused(true) };

  return (
    <div ref={ref} className="relative">
      <p className="sr-only">
        Example conversation. Customer: “{SCENARIOS[0].message}” Relay: “{SCENARIOS[0].reply.replace(/\*\*/g, "")}” The request is escalated to
        the returns team as a high-priority ticket.
      </p>
      {!reduced && (
        <button
          type="button"
          aria-label={control.name}
          onClick={() => {
            control.run();
            if (stopped) setPaused(false);
          }}
          className="absolute -bottom-14 right-2 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-slate-400 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white"
        >
          <control.icon className="h-3 w-3" aria-hidden />
          {control.label}
        </button>
      )}
      <div onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <Tilt max={10} restX={4} restY={-9} className="relative">
        <div aria-hidden className="rounded-2xl border border-white/10 bg-white/5 p-2 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="overflow-hidden rounded-xl bg-white text-slate-900">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <LogoMark className="h-8 w-8" />
              <div>
                <div className="text-sm font-semibold">Relay · Aurora Outfitters</div>
                <div className="grid whitespace-nowrap text-[11px]">
                  <span className={cx("col-start-1 row-start-1 text-slate-500 transition-opacity duration-300", s.phase === "thinking" && "opacity-0")}>
                    AI assistant · human help anytime
                  </span>
                  <span className={cx("col-start-1 row-start-1 text-brand-600 transition-opacity duration-300", s.phase !== "thinking" && "opacity-0")}>
                    Relay is checking your order…
                  </span>
                </div>
              </div>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-600">
                <span className="relative flex h-2 w-2">
                  <span className="pipeline-ping absolute inset-0 rounded-full border-2 border-emerald-400" />
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Online
              </span>
            </div>

            <div
              className={cx(
                "flex h-[300px] flex-col justify-end gap-3 bg-slate-50 p-4 text-sm transition-all duration-400",
                s.phase === "leaving" && "-translate-y-2 opacity-0",
              )}
            >
              {sent && (
                <div key={`${sc.id}-q`} className={cx(enter, "ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-brand-600 px-3 py-2 text-white")}>
                  {sc.message}
                </div>
              )}
              {(s.phase === "sent" || s.phase === "thinking") && (
                <div className="animate-bubble flex w-fit items-center gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-3">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" />
                </div>
              )}
              {replying && (
                <div key={`${sc.id}-a`} className={cx(enter, "max-w-[88%] rounded-2xl rounded-bl-md border bg-white px-3 py-2", BUBBLE_TONE[sc.tone])}>
                  <p>
                    {words(sc.reply).map((w, i) => {
                      const cls = s.initial ? undefined : "stream-word";
                      const style = { "--w": i } as CSSProperties;
                      return w.bold ? (
                        <b key={i} className={cls} style={style}>
                          {w.text}
                        </b>
                      ) : (
                        <span key={i} className={cls} style={style}>
                          {w.text}
                        </span>
                      );
                    })}
                  </p>
                  {sc.extra && <div className={cx("mt-2 transition-all duration-500", finished ? "opacity-100" : "translate-y-1 opacity-0")}>{sc.extra}</div>}
                </div>
              )}
              {finished && (
                <div key={`${sc.id}-c`} className="flex flex-wrap gap-1.5 text-[11px]">
                  {sc.chips.map((c, i) => (
                    <span key={c.label} className={cx(enter, "rounded px-1.5 py-0.5", c.className)} style={{ animationDelay: `${150 + i * 110}ms` }}>
                      {c.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2.5">
              <div className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-1.5 text-[13px]">
                {s.phase === "typing" && s.typed > 0 ? (
                  <span className="text-slate-800">
                    {sc.message.slice(0, s.typed)}
                    <span className="composer-caret" />
                  </span>
                ) : (
                  <span className="text-slate-400">Ask about an order, return or product…</span>
                )}
              </div>
              <span
                className={cx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
                  s.phase === "typing" && s.typed > 0 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400",
                )}
              >
                <SendHorizontal className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>

        <div aria-hidden className="tilt-depth absolute -bottom-16 left-6 hidden rounded-xl border border-white/10 bg-ink-950/90 p-3 text-xs shadow-xl shadow-black/40 sm:block">
          <div className="mb-1.5 flex items-center justify-between gap-4 text-slate-400">
            Agent route
            <span className="font-mono text-[10px] text-slate-500">
              {s.hops}/{sc.route.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            {sc.route.map((step, i) => {
              const lit = i < s.hops;
              const last = i === sc.route.length - 1;
              return (
                <span key={`${sc.id}-${step}`} className="flex items-center gap-1.5">
                  {i > 0 && <span className={cx("transition-colors duration-300", lit ? "text-slate-300" : "text-slate-600")}>→</span>}
                  <span
                    className={cx(
                      "rounded px-1.5 py-0.5 ring-1 transition-all duration-300",
                      !lit && "bg-white/5 text-slate-500 ring-transparent",
                      lit && !last && "bg-white/10 text-slate-200 ring-white/15",
                      lit && last && ROUTE_TONE[sc.tone],
                      lit && i === s.hops - 1 && !s.initial && "route-live",
                    )}
                  >
                    {step}
                  </span>
                </span>
              );
            })}
          </div>
        </div>

        {finished && (
          <div aria-hidden className="tilt-depth absolute -right-5 -top-9 hidden sm:block">
            {/* Entrance, bob and exit live on separate layers because each is its own animation. */}
            <div key={sc.id} className={cx(enter, enter && "[animation-delay:500ms]", "transition-opacity duration-300", s.phase === "leaving" && "opacity-0")}>
              <div className="float-y flex items-center gap-2.5 rounded-xl border border-white/10 bg-ink-950/90 py-2.5 pl-2.5 pr-4 text-xs shadow-xl shadow-black/40 backdrop-blur">
                <span className={cx("flex h-7 w-7 items-center justify-center rounded-lg", NOTICE_TONE[sc.tone])}>
                  <sc.notice.icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-medium text-slate-100">{sc.notice.title}</div>
                  <div className="text-[11px] text-slate-400">{sc.notice.sub}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Tilt>
      </div>
    </div>
  );
}
