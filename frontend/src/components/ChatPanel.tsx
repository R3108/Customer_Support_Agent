"use client";

import { ArrowUp, BookOpen, Check, Clock, Globe, Headset, RotateCcw, ShieldAlert, Star, X, Zap } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ChatController } from "@/hooks/useChat";
import { clockTime, cx, languageName } from "@/lib/format";
import type { ActionSummary, Message } from "@/lib/types";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { LogoMark } from "./Logo";
import { Markdown } from "./Markdown";

const STEP_COPY: Record<string, string> = {
  intent_classifier: "Understanding your request",
  knowledge_retriever: "Checking help center & your account",
  support_agent: "Drafting a reply",
  escalation_agent: "Connecting a specialist",
  action_agent: "Taking care of it",
  memory_manager: "Wrapping up",
};

const DEFAULT_WELCOME =
  "I can track orders, handle returns, and answer billing, account and product questions — and I'll bring in a human whenever you need one.";

export function ChatPanel({
  chat,
  assistantName = "Relay",
  companyName = "Aurora Outfitters",
  welcome = DEFAULT_WELCOME,
  showMeta = false,
  suggestions = [],
  compact = false,
  headerExtra,
}: {
  chat: ChatController;
  assistantName?: string;
  companyName?: string;
  welcome?: string;
  showMeta?: boolean;
  suggestions?: string[];
  compact?: boolean;
  headerExtra?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const ratingLabelId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const escalated = chat.conversation?.status === "escalated";
  const agentReplied = chat.messages.some((m) => m.role === "human_agent");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length, chat.liveSteps.length, chat.pending]);

  const submit = async (text: string) => {
    if (!text.trim()) return;
    setDraft("");
    await chat.send(text);
    inputRef.current?.focus();
  };

  const currentStep = chat.liveSteps.at(-1);
  const nextLabel = currentStep
    ? currentStep.node === "intent_classifier"
      ? STEP_COPY.knowledge_retriever
      : currentStep.node === "knowledge_retriever"
        ? STEP_COPY.support_agent
        : STEP_COPY[currentStep.node]
    : STEP_COPY.intent_classifier;
  const showRating = !chat.rated && chat.messages.filter((m) => m.role === "assistant" || m.role === "human_agent").length >= 2 && !chat.pending;
  const lastMessage = chat.messages.at(-1);
  const openOffer = !chat.pending && lastMessage?.role === "assistant" ? lastMessage.meta?.action_proposal : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <header className={cx("flex items-center gap-3 border-b border-slate-200", compact ? "px-4 py-3" : "px-5 py-3.5")}>
        <div className="relative">
          {escalated || agentReplied ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Headset className="h-5 w-5" />
            </div>
          ) : (
            <LogoMark className="h-9 w-9" />
          )}
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">
            {escalated ? `${companyName} Specialist Team` : `${assistantName} · ${companyName}`}
          </div>
          <div className="truncate text-xs text-slate-500">
            {escalated ? "A specialist has been notified · replies appear here" : "AI assistant · replies instantly · human help anytime"}
          </div>
        </div>
        {headerExtra}
        <button
          onClick={chat.reset}
          className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          title="Start a new conversation"
          aria-label="Start a new conversation"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </header>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        className={cx("flex-1 space-y-4 overflow-y-auto bg-slate-50/60", compact ? "px-3 py-4" : "px-5 py-5")}
      >
        {chat.messages.length === 0 && (
          <div className="animate-bubble mx-auto max-w-md pt-4 text-center">
            <LogoMark className="mx-auto h-11 w-11" />
            <h3 className="mt-3 text-base font-semibold text-slate-900">Hi! I&apos;m {assistantName}.</h3>
            <p className="mt-1 text-sm text-slate-500">{welcome}</p>
            {suggestions.length > 0 && (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="rounded-full border border-slate-200 bg-surface px-3 py-1.5 text-xs text-slate-700 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {chat.messages.map((m) => (
          <MessageBubble key={m.id} message={m} showMeta={showMeta} compact={compact} />
        ))}

        {openOffer && (
          <div className="animate-bubble flex flex-wrap gap-2 pl-9">
            <button
              onClick={() => void submit("Yes, go ahead")}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-700"
            >
              <Check className="h-3.5 w-3.5" /> Yes, {openOffer.label.toLowerCase()}
            </button>
            <button
              onClick={() => void submit("No, thanks")}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-surface px-3.5 py-1.5 text-xs text-slate-700 transition hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" /> No thanks
            </button>
          </div>
        )}

        {chat.pending && (
          <div className="animate-bubble flex items-end gap-2">
            <LogoMark className="h-7 w-7 shrink-0" />
            <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-surface px-3.5 py-2.5 shadow-sm">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex gap-0.5">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-500" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-500" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-500" />
                </span>
                {nextLabel}…
              </div>
            </div>
          </div>
        )}

        {showRating && (
          <div className="animate-bubble flex flex-col items-center gap-1.5 pt-2">
            <span id={ratingLabelId} className="text-xs text-slate-500">
              How&apos;s your support experience so far?
            </span>
            <div className="flex gap-1" role="group" aria-labelledby={ratingLabelId}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => chat.rate(n)} aria-label={`Rate ${n} of 5`} className="group p-0.5">
                  <Star className="h-5 w-5 text-slate-300 transition group-hover:fill-amber-400 group-hover:text-amber-400" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {chat.error && (
        <div role="alert" className="flex items-center gap-2 border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden /> {chat.error}
        </div>
      )}

      <form
        className={cx("border-t border-slate-200 bg-surface", compact ? "p-3" : "p-4")}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-surface px-3 py-2 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(draft);
              }
            }}
            rows={1}
            maxLength={4000}
            aria-label="Message"
            placeholder={escalated ? "Add a message for the specialist…" : "Ask about an order, return, billing…"}
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={!draft.trim() || chat.pending}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-slate-500">AI replies can make mistakes · type “talk to a human” anytime</p>
      </form>
    </div>
  );
}

export function ActionChip({ action }: { action: ActionSummary }) {
  if (action.status === "executed") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
        <Zap className="h-3 w-3" /> {action.label} · done
      </span>
    );
  }
  if (action.status === "pending_approval") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
        <Clock className="h-3 w-3" /> {action.label} · awaiting approval
      </span>
    );
  }
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
      {action.label} · {action.status.replace(/_/g, " ")}
    </span>
  );
}

function MessageBubble({ message: m, showMeta, compact }: { message: Message; showMeta: boolean; compact: boolean }) {
  const [openSources, setOpenSources] = useState(false);

  if (m.role === "system") {
    return (
      <div className="animate-bubble flex justify-center">
        <span className="max-w-[85%] rounded-full bg-slate-200/70 px-3 py-1 text-center text-[11px] text-slate-600">{m.content}</span>
      </div>
    );
  }

  if (m.role === "customer") {
    return (
      <div className="animate-bubble flex justify-end">
        <div className={cx("max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2.5 text-sm text-white shadow-sm", m.id < 0 && "opacity-70")}>
          <p className="whitespace-pre-wrap break-words">{m.content}</p>
        </div>
      </div>
    );
  }

  const human = m.role === "human_agent";
  const meta = m.meta ?? {};
  const sources = meta.sources ?? [];

  return (
    <div className="animate-bubble flex items-end gap-2">
      {human ? (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Headset className="h-4 w-4" />
        </div>
      ) : (
        <LogoMark className="h-7 w-7 shrink-0" />
      )}
      <div className={cx("min-w-0", compact ? "max-w-[88%]" : "max-w-[80%]")}>
        {human && <div className="mb-1 text-[11px] font-medium text-emerald-700">{meta.agent_name ?? "Specialist"} · Human support</div>}
        <div
          className={cx(
            "rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm leading-relaxed text-slate-800 shadow-sm",
            human ? "border-emerald-200 bg-emerald-50" : meta.escalated ? "border-amber-200 bg-surface" : "border-slate-200 bg-surface",
          )}
        >
          <Markdown>{m.content}</Markdown>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-1 text-[11px] text-slate-500">
          <span>{clockTime(m.created_at)}</span>
          {showMeta && !human && meta.confidence_breakdown?.policy_trigger === undefined && <ConfidenceBadge value={meta.confidence} />}
          {showMeta && meta.intent_label && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{meta.intent_label}</span>}
          {meta.escalated && meta.ticket_id && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">Handed off · {meta.ticket_id}</span>
          )}
          {meta.action_result && <ActionChip action={meta.action_result} />}
          {showMeta && meta.language && meta.language !== "en" && (
            <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">
              <Globe className="h-3 w-3" /> {languageName(meta.language)}
            </span>
          )}
          {sources.length > 0 && (
            <button
              onClick={() => setOpenSources((v) => !v)}
              aria-expanded={openSources}
              className="inline-flex items-center gap-1 rounded px-1 hover:bg-slate-100 hover:text-slate-600"
            >
              <BookOpen className="h-3 w-3" /> {sources.length} source{sources.length > 1 ? "s" : ""}
            </button>
          )}
        </div>
        {openSources && (
          <ul className="mt-1.5 space-y-1 pl-1">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-surface px-2 py-1 text-[11px]">
                <span className="truncate text-slate-600">
                  {s.title} › <span className="text-slate-900">{s.section}</span>
                </span>
                {showMeta && <span className="shrink-0 font-mono text-slate-500">{s.score.toFixed(2)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
