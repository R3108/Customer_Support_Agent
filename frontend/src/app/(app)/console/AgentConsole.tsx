"use client";

import {
  BookPlus,
  Brain,
  CheckCheck,
  ChevronDown,
  Clock,
  Crown,
  Globe,
  Inbox,
  Loader2,
  MessageSquareQuote,
  MessagesSquare,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorNotice } from "@/components/AppShell";
import { ActionChip } from "@/components/ChatPanel";
import { ConfidenceBadge, PriorityPill } from "@/components/ConfidenceBadge";
import { LogoMark } from "@/components/Logo";
import { Markdown } from "@/components/Markdown";
import { useAsync } from "@/hooks/useAsync";
import { useWorkspaceConfig } from "@/hooks/useWorkspaceConfig";
import { ApiError, api, stashArticleDraft } from "@/lib/api";
import { clockTime, cx, humanize, languageName, money, timeAgo } from "@/lib/format";
import type { Conversation, ConversationDetail, CopilotMode, Macro, Message, OrderAction, Ticket } from "@/lib/types";

type Tab = "open" | "resolved" | "conversations";
type Selection = { kind: "ticket"; id: string } | { kind: "conversation"; id: string } | null;

const AGENT_NAME_KEY = "relay.agentName";

export function AgentConsole() {
  const [tab, setTab] = useState<Tab>("open");
  const [chosen, setSelection] = useState<Selection>(null);
  const tickets = useAsync(
    () => api.tickets().then((ts) => ts.map((t) => ({ ...t, overdue: t.status !== "resolved" && !!t.sla_due_at && new Date(t.sla_due_at).getTime() < Date.now() }))),
    "tickets",
    5000,
  );
  const conversations = useAsync(() => api.conversations(), "conversations", 8000);

  const openTickets = (tickets.data ?? []).filter((t) => t.status !== "resolved");
  const resolvedTickets = (tickets.data ?? []).filter((t) => t.status === "resolved");
  // Until the agent picks something, focus the most urgent open ticket.
  const selection: Selection = chosen ?? (openTickets[0] ? { kind: "ticket", id: openTickets[0].id } : null);

  if (tickets.error) return <ErrorNotice error={tickets.error} onRetry={tickets.reload} />;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="grid grid-cols-3 gap-1 border-b border-slate-200 p-2">
          {(
            [
              ["open", `Queue (${openTickets.length})`, Inbox],
              ["resolved", `Resolved`, CheckCheck],
              ["conversations", "All chats", MessagesSquare],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cx(
                "flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
                tab === key ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab !== "conversations" &&
            (tab === "open" ? openTickets : resolvedTickets).map((t) => (
              <TicketRow key={t.id} ticket={t} active={selection?.kind === "ticket" && selection.id === t.id} onClick={() => setSelection({ kind: "ticket", id: t.id })} />
            ))}
          {tab === "conversations" &&
            (conversations.data ?? []).map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={selection?.kind === "conversation" && selection.id === c.id}
                onClick={() => setSelection({ kind: "conversation", id: c.id })}
              />
            ))}
          {!tickets.loading && tab === "open" && openTickets.length === 0 && (
            <EmptyState title="Queue is clear" body="Escalations from Relay land here with an AI briefing and a suggested reply." />
          )}
          {tab === "resolved" && resolvedTickets.length === 0 && <EmptyState title="Nothing resolved yet" body="Resolved tickets are kept here for reference." />}
          {tab === "conversations" && (conversations.data ?? []).length === 0 && <EmptyState title="No conversations yet" body="Start one from the live demo." />}
        </div>
      </aside>

      <section className="min-h-0 bg-slate-50">
        {selection ? (
          <Workspace key={`${selection.kind}-${selection.id}`} selection={selection} onChanged={tickets.reload} />
        ) : (
          <EmptyState title="Select a ticket" body="Pick a ticket from the queue to see the transcript, AI briefing and customer context." />
        )}
      </section>
    </div>
  );
}

function TicketRow({ ticket: t, active, onClick }: { ticket: Ticket; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx("block w-full border-b border-slate-100 px-4 py-3 text-left transition", active ? "bg-brand-50/60" : "hover:bg-slate-50")}
    >
      <div className="flex items-center gap-2">
        <PriorityPill priority={t.priority} />
        <span className="font-mono text-[11px] text-slate-500">{t.id}</span>
        <span className="ml-auto text-[11px] text-slate-400">{timeAgo(t.created_at)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-sm font-medium text-slate-900">
        {t.customer_name}
        {t.customer_tier === "Aurora+" && <Crown className="h-3 w-3 text-amber-500" />}
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{t.reason}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{t.category}</span>
        {!!t.pending_actions && (
          <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
            <ShieldCheck className="h-3 w-3" /> Approval needed
          </span>
        )}
        {t.language && t.language !== "en" && (
          <span className="flex items-center gap-0.5 text-sky-700">
            <Globe className="h-3 w-3" /> {languageName(t.language)}
          </span>
        )}
        {t.status === "in_progress" && <span className="text-sky-700">In progress{t.assignee ? ` · ${t.assignee}` : ""}</span>}
        {t.overdue && (
          <span className="flex items-center gap-0.5 text-rose-600">
            <Clock className="h-3 w-3" /> SLA breached
          </span>
        )}
      </div>
    </button>
  );
}

function ConversationRow({ conversation: c, active, onClick }: { conversation: Conversation; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx("block w-full border-b border-slate-100 px-4 py-3 text-left transition", active ? "bg-brand-50/60" : "hover:bg-slate-50")}
    >
      <div className="flex items-center gap-2">
        <span
          className={cx(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
            c.status === "escalated" ? "bg-amber-100 text-amber-800" : c.status === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-brand-50 text-brand-700",
          )}
        >
          {c.status === "ai" ? "AI" : c.status}
        </span>
        <span className="truncate text-xs text-slate-500">{c.customer_id ?? "Guest"}</span>
        <span className="ml-auto text-[11px] text-slate-400">{timeAgo(c.updated_at)}</span>
      </div>
      <p className="mt-1 truncate text-sm font-medium text-slate-900">{c.title ?? "Untitled conversation"}</p>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
        <span>{c.message_count} msgs</span>
        {c.last_intent && <span>· {humanize(c.last_intent)}</span>}
        {c.last_confidence !== null && <ConfidenceBadge value={c.last_confidence} label="" />}
      </div>
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center p-8 text-center">
      <Inbox className="h-8 w-8 text-slate-300" />
      <p className="mt-2 text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-1 max-w-xs text-xs text-slate-500">{body}</p>
    </div>
  );
}

function Workspace({ selection, onChanged }: { selection: NonNullable<Selection>; onChanged: () => void }) {
  const detail = useAsync<ConversationDetail & { ticket?: Ticket }>(
    () => (selection.kind === "ticket" ? api.ticket(selection.id) : api.conversationDetail(selection.id)),
    `${selection.kind}:${selection.id}`,
    4000,
  );
  const [reply, setReply] = useState("");
  const [agentName, setAgentName] = useState(() => {
    try {
      return window.localStorage.getItem(AGENT_NAME_KEY) || "Alex";
    } catch {
      return "Alex";
    }
  });
  const [busy, setBusy] = useState(false);
  const [assist, setAssist] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const transcriptRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const config = useWorkspaceConfig();
  const macros = useAsync(() => api.macros(), "macros");

  const messageCount = detail.data?.messages.length ?? 0;
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messageCount]);

  if (detail.error) return <ErrorNotice error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <div className="p-8 text-sm text-slate-500">Loading…</div>;

  const { conversation, messages, customer, memory, ticket, actions } = detail.data;
  const language = conversation.language ?? "en";
  const specialistReplied = messages.some((m) => m.role === "human_agent");

  const runCopilot = async (mode: CopilotMode) => {
    if (!reply.trim()) return;
    setAssist({ busy: true, note: null });
    try {
      const res = await api.rewrite(reply, mode, conversation.id, mode === "translate" ? language : undefined);
      setReply(res.text);
      setAssist({ busy: false, note: res.engine === "offline" ? "Rewritten with offline rules — connect an LLM for richer rewrites." : null });
    } catch (e) {
      setAssist({ busy: false, note: e instanceof ApiError ? e.message : "Copilot is unavailable right now." });
    }
  };

  const insertMacro = (macro: Macro) => {
    const vars: Record<string, string> = {
      first_name: customer?.name.split(" ")[0] ?? "there",
      order_id: String(memory.entities.active_order_id ?? "your order"),
      ticket_id: ticket?.id ?? "",
      agent_name: agentName,
      company_name: config?.company_name ?? "our",
    };
    const text = macro.body.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
    setReply((cur) => (cur.trim() ? `${cur.trim()}\n\n${text}` : text));
  };

  const draftArticle = async () => {
    if (!ticket) return;
    setAssist({ busy: true, note: null });
    try {
      stashArticleDraft(await api.draftArticleFromTicket(ticket.id));
      router.push("/knowledge");
    } catch (e) {
      setAssist({ busy: false, note: e instanceof ApiError ? e.message : "Couldn't draft an article." });
    }
  };

  const send = async (resolve: boolean) => {
    if (!ticket || (!reply.trim() && !resolve)) return;
    setBusy(true);
    try {
      window.localStorage.setItem(AGENT_NAME_KEY, agentName);
    } catch {
      /* ignore */
    }
    try {
      if (reply.trim()) await api.replyTicket(ticket.id, reply.trim(), agentName, resolve);
      else await api.patchTicket(ticket.id, { status: "resolved", assignee: agentName });
      setReply("");
      detail.reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const updateTicket = async (patch: Partial<Pick<Ticket, "status" | "priority" | "assignee">>) => {
    if (!ticket) return;
    await api.patchTicket(ticket.id, patch);
    detail.reload();
    onChanged();
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* Transcript + composer */}
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {ticket && <PriorityPill priority={ticket.priority} />}
              <h2 className="truncate text-sm font-semibold text-slate-900">{ticket ? ticket.reason : conversation.title}</h2>
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              {ticket ? `${ticket.id} · ${ticket.category} · opened ${timeAgo(ticket.created_at)}` : `${conversation.id} · ${humanize(conversation.status)}`}
              {language !== "en" && (
                <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">
                  <Globe className="h-3 w-3" /> {languageName(language)}
                </span>
              )}
            </p>
          </div>
          {ticket && specialistReplied && (
            <button
              onClick={() => void draftArticle()}
              disabled={assist.busy}
              className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Turn how this was resolved into a help-center article so the AI can answer it next time"
            >
              <BookPlus className="h-3.5 w-3.5" /> Save as KB article
            </button>
          )}
          {ticket && ticket.status !== "resolved" && (
            <button
              onClick={() => void send(true)}
              disabled={busy}
              className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Resolve
            </button>
          )}
        </div>

        <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.map((m) => (
            <TranscriptMessage key={m.id} message={m} />
          ))}
        </div>

        {ticket && ticket.status !== "resolved" ? (
          <div className="border-t border-slate-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Replying as</span>
              <input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className="w-32 rounded border border-slate-200 px-1.5 py-0.5 text-xs outline-none focus:border-brand-400"
                aria-label="Agent name"
              />
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Menu label="Macros" icon={<MessageSquareQuote className="h-3.5 w-3.5" />}>
                  {(close) =>
                    (macros.data ?? []).length ? (
                      (macros.data ?? []).map((m) => (
                        <MenuItem
                          key={m.id}
                          onClick={() => {
                            insertMacro(m);
                            close();
                          }}
                          title={m.title}
                          detail={m.body}
                        />
                      ))
                    ) : (
                      <p className="px-3 py-2 text-xs text-slate-500">No macros yet — add them in Settings.</p>
                    )
                  }
                </Menu>
                <Menu label="Copilot" icon={assist.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} disabled={!reply.trim() || assist.busy}>
                  {(close) =>
                    (
                      [
                        ["friendlier", "Make friendlier"],
                        ["empathetic", "Add empathy"],
                        ["shorter", "Make shorter"],
                        ["formal", "Make more formal"],
                        ["fix_grammar", "Fix spelling & grammar"],
                        ...(language !== "en" ? [["translate", `Translate to ${languageName(language)}`]] : []),
                      ] as [CopilotMode, string][]
                    ).map(([mode, label]) => (
                      <MenuItem
                        key={mode}
                        title={label}
                        onClick={() => {
                          close();
                          void runCopilot(mode);
                        }}
                      />
                    ))
                  }
                </Menu>
                {ticket.suggested_reply && (
                  <button
                    onClick={() => setReply(ticket.suggested_reply)}
                    className="flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Use AI draft
                  </button>
                )}
              </div>
            </div>
            {assist.note && (
              <p className="mb-2 flex items-center gap-1 text-[11px] text-slate-500">
                {assist.note}
                <button onClick={() => setAssist({ busy: false, note: null })} aria-label="Dismiss" className="text-slate-400 hover:text-slate-700">
                  <X className="h-3 w-3" />
                </button>
              </p>
            )}
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={4}
              placeholder="Write a reply — the customer sees it instantly in their chat."
              className="w-full resize-none rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => void send(true)}
                disabled={busy || !reply.trim()}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Send & resolve
              </button>
              <button
                onClick={() => void send(false)}
                disabled={busy || !reply.trim()}
                className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" /> Send
              </button>
            </div>
          </div>
        ) : ticket ? (
          <div className="border-t border-slate-200 bg-white p-3 text-center text-xs text-slate-500">
            Resolved {timeAgo(ticket.resolved_at)} ·{" "}
            <button className="text-brand-600 hover:underline" onClick={() => void updateTicket({ status: "open" })}>
              Reopen
            </button>
          </div>
        ) : null}
      </div>

      {/* Context sidebar */}
      <aside className="min-h-0 space-y-3 overflow-y-auto border-l border-slate-200 bg-white p-4">
        {actions.length > 0 && (
          <ActionsCard
            actions={actions}
            agentName={agentName}
            onChanged={() => {
              detail.reload();
              onChanged();
            }}
          />
        )}
        {ticket && (
          <Card icon={<Sparkles className="h-4 w-4 text-brand-600" />} title="AI briefing">
            <Markdown className="prose-chat text-xs leading-relaxed text-slate-700">{ticket.summary}</Markdown>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-slate-500">
                Priority
                <select
                  value={ticket.priority}
                  onChange={(e) => void updateTicket({ priority: e.target.value as Ticket["priority"] })}
                  className="mt-0.5 w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-800"
                >
                  {["low", "normal", "high", "urgent"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-slate-500">
                Status
                <select
                  value={ticket.status}
                  onChange={(e) => void updateTicket({ status: e.target.value as Ticket["status"], assignee: agentName })}
                  className="mt-0.5 w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-800"
                >
                  <option value="open">open</option>
                  <option value="in_progress">in progress</option>
                  <option value="resolved">resolved</option>
                </select>
              </label>
            </div>
            {ticket.sla_due_at && ticket.status !== "resolved" && (
              <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500">
                <Clock className="h-3 w-3" /> SLA due {new Date(ticket.sla_due_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              </p>
            )}
          </Card>
        )}

        <Card icon={<UserRound className="h-4 w-4 text-slate-600" />} title="Customer">
          {customer ? (
            <div className="space-y-2 text-xs">
              <div>
                <div className="flex items-center gap-1 font-medium text-slate-900">
                  {customer.name} {customer.tier === "Aurora+" && <Crown className="h-3 w-3 text-amber-500" />}
                </div>
                <div className="text-slate-500">{customer.email}</div>
                <div className="text-slate-500">
                  {customer.tier} · since {customer.member_since} · {customer.rewards_points.toLocaleString()} pts
                </div>
              </div>
              <ul className="space-y-1">
                {customer.recent_orders.map((o) => (
                  <li key={o.order_id} className="rounded-md bg-slate-50 px-2 py-1.5">
                    <div className="flex justify-between">
                      <span className="font-mono text-[11px] text-slate-800">{o.order_id}</span>
                      <span className="text-[11px] text-slate-500">{humanize(o.status)}</span>
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {o.items} · ${o.total.toFixed(2)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Guest visitor (not signed in). Verified details, if any, appear in agent memory below.</p>
          )}
        </Card>

        <Card icon={<Brain className="h-4 w-4 text-slate-600" />} title="Agent memory">
          <div className="space-y-1 text-xs">
            {Object.entries(memory.entities).length ? (
              Object.entries(memory.entities).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-slate-500">{humanize(k)}</span>
                  <span className="truncate font-mono text-[11px] text-slate-800">{Array.isArray(v) ? v.join(", ") : String(v)}</span>
                </div>
              ))
            ) : (
              <p className="text-slate-500">No entities remembered yet.</p>
            )}
            <div className="flex justify-between gap-3 border-t border-slate-100 pt-1">
              <span className="text-slate-500">Messages in window</span>
              <span className="text-slate-800">{memory.messages_in_window}</span>
            </div>
            {memory.summary && <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] text-slate-600">{memory.summary}</p>}
          </div>
        </Card>
      </aside>
    </div>
  );
}

function ActionsCard({ actions, agentName, onChanged }: { actions: OrderAction[]; agentName: string; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = actions.filter((a) => a.status === "pending_approval");
  const history = actions.filter((a) => a.status !== "pending_approval");

  const decide = async (action: OrderAction, approve: boolean) => {
    let note: string | undefined;
    if (!approve) {
      const input = window.prompt("Optional message to the customer explaining the decision:", "");
      if (input === null) return;
      note = input.trim() || undefined;
    }
    setBusyId(action.id);
    setError(null);
    try {
      if (approve) await api.approveAction(action.id, agentName);
      else await api.denyAction(action.id, agentName, note);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't update the action.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card icon={<Zap className="h-4 w-4 text-emerald-600" />} title="Order actions">
      {pending.map((a) => (
        <div key={a.id} className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-amber-900">{a.label}</span>
            <span className="font-mono text-amber-900">{money(a.amount)}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-amber-800">
            <span className="font-mono">{a.order_id}</span> · requested by {a.requested_by === "ai" ? "Relay AI" : a.requested_by} · {timeAgo(a.created_at)}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              onClick={() => void decide(a, true)}
              disabled={busyId === a.id}
              className="flex items-center justify-center gap-1 rounded-md bg-emerald-600 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Approve
            </button>
            <button
              onClick={() => void decide(a, false)}
              disabled={busyId === a.id}
              className="rounded-md border border-amber-300 bg-white py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              Deny
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-amber-700">Approving executes it, notifies the customer and resolves the ticket.</p>
        </div>
      ))}
      {error && <p className="mb-2 text-[11px] text-rose-600">{error}</p>}
      {history.length > 0 && (
        <ul className="space-y-1">
          {history.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-slate-600">
                <span className="font-mono">{a.order_id}</span> · {a.decided_by ?? (a.requested_by === "ai" ? "AI" : a.requested_by)}
              </span>
              <ActionChip action={a} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Menu({
  label,
  icon,
  disabled,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        aria-expanded={open}
      >
        {icon} {label} <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ title, detail, onClick }: { title: string; detail?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50">
      <span className="block text-xs font-medium text-slate-800">{title}</span>
      {detail && <span className="block truncate text-[11px] text-slate-500">{detail}</span>}
    </button>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

function TranscriptMessage({ message: m }: { message: Message }) {
  if (m.role === "system") {
    return <div className="text-center text-[11px] text-slate-500">— {m.content} —</div>;
  }
  const customer = m.role === "customer";
  const human = m.role === "human_agent";
  return (
    <div className={cx("flex gap-2.5", customer && "flex-row-reverse")}>
      <div className="shrink-0">
        {customer ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600">
            <UserRound className="h-4 w-4" />
          </div>
        ) : human ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <span className="text-[11px] font-semibold">{(m.meta.agent_name ?? "S")[0]}</span>
          </div>
        ) : (
          <LogoMark className="h-7 w-7" />
        )}
      </div>
      <div className={cx("max-w-[78%]", customer && "text-right")}>
        <div className="mb-0.5 text-[11px] text-slate-500">
          {customer ? "Customer" : human ? `${m.meta.agent_name ?? "Specialist"} (human)` : "Relay AI"} · {clockTime(m.created_at)}
        </div>
        <div
          className={cx(
            "inline-block rounded-xl border px-3 py-2 text-left text-sm text-slate-800",
            customer ? "border-brand-200 bg-brand-50" : human ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white",
          )}
        >
          <Markdown>{m.content}</Markdown>
        </div>
        {m.role === "assistant" && (
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
            {m.meta.intent_label && <span className="rounded bg-slate-100 px-1.5 py-0.5">{m.meta.intent_label}</span>}
            {m.meta.confidence_breakdown?.policy_trigger ? (
              <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">Policy trigger: {humanize(m.meta.confidence_breakdown.policy_trigger)}</span>
            ) : (
              <ConfidenceBadge value={m.meta.confidence} />
            )}
            {m.meta.action && <span className="rounded bg-slate-100 px-1.5 py-0.5">{humanize(m.meta.action)}</span>}
            {m.meta.knowledge_gap && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">Knowledge gap</span>}
          </div>
        )}
        {m.meta.action_result && (
          <div className="mt-1 text-[11px]">
            <ActionChip action={m.meta.action_result} />
          </div>
        )}
      </div>
    </div>
  );
}
