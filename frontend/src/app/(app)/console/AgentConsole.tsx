"use client";

import {
  ArrowLeft,
  BookPlus,
  Brain,
  CheckCheck,
  Clock,
  Crown,
  FlaskConical,
  Globe,
  Inbox,
  Loader2,
  MessageSquareQuote,
  MessagesSquare,
  PanelRight,
  Search,
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
import { HealthBadge } from "@/components/HealthBadge";
import { LogoMark } from "@/components/Logo";
import { Markdown } from "@/components/Markdown";
import { useDialog } from "@/components/ui/Dialog";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { SidePanel } from "@/components/ui/SidePanel";
import { CardSkeleton, ListRowsSkeleton, LoadingRegion, Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useAgentName } from "@/hooks/useAgentName";
import { useAsync } from "@/hooks/useAsync";
import { useWorkspaceConfig } from "@/hooks/useWorkspaceConfig";
import { api, stashArticleDraft } from "@/lib/api";
import { clockTime, cx, humanize, languageName, money, timeAgo } from "@/lib/format";
import type { Conversation, ConversationDetail, CopilotMode, Macro, Message, OrderAction, Ticket } from "@/lib/types";

type Tab = "open" | "resolved" | "conversations";
type Selection = { kind: "ticket"; id: string } | { kind: "conversation"; id: string } | null;
type SortKey = "priority" | "sla" | "newest" | "oldest";

const PRIORITIES: Ticket["priority"][] = ["urgent", "high", "normal", "low"];
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATUS_LABELS: Record<Ticket["status"], string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };
const SORT_LABELS: Record<SortKey, string> = { priority: "Priority", sla: "SLA due", newest: "Newest", oldest: "Oldest" };

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY);

function sortTickets(list: Ticket[], sort: SortKey): Ticket[] {
  const byNewest = (a: Ticket, b: Ticket) => time(b.created_at) - time(a.created_at);
  return [...list].sort((a, b) => {
    if (sort === "newest") return byNewest(a, b);
    if (sort === "oldest") return -byNewest(a, b);
    if (sort === "sla") return time(a.sla_due_at) - time(b.sla_due_at) || byNewest(a, b);
    return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || time(a.sla_due_at) - time(b.sla_due_at);
  });
}

function ticketMatches(t: Ticket, q: string) {
  return [t.id, t.customer_name, t.reason, t.category, t.assignee].some((v) => v?.toLowerCase().includes(q));
}

/** True when a keystroke belongs to a text field rather than to the console's shortcuts. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

const selectClass = "rounded-md border border-slate-200 bg-surface px-1.5 py-1 text-xs text-slate-700 outline-none focus:border-brand-400";

export function AgentConsole() {
  const [tab, setTab] = useState<Tab>("open");
  const [chosen, setChosen] = useState<Selection>(null);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<"all" | Ticket["priority"]>("all");
  const [sort, setSort] = useState<SortKey>("priority");
  const searchRef = useRef<HTMLInputElement>(null);
  const tickets = useAsync(
    () => api.tickets().then((ts) => ts.map((t) => ({ ...t, overdue: t.status !== "resolved" && !!t.sla_due_at && new Date(t.sla_due_at).getTime() < Date.now() }))),
    "tickets",
    5000,
    ["tickets", "actions", "conversations"],
  );
  const conversations = useAsync(() => api.conversations(), "conversations", 8000, ["conversations", "messages"]);

  // Deep link from elsewhere in the app (e.g. at-risk customers in Analytics): /console?conversation=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("conversation");
    if (!id) return;
    void Promise.resolve().then(() => {
      setTab("conversations");
      setChosen({ kind: "conversation", id });
    });
  }, []);

  const q = query.trim().toLowerCase();
  const allTickets = tickets.data ?? [];
  const filtered = allTickets.filter((t) => (priority === "all" || t.priority === priority) && (!q || ticketMatches(t, q)));
  const openTickets = sortTickets(
    filtered.filter((t) => t.status !== "resolved"),
    sort,
  );
  const resolvedTickets = sortTickets(
    filtered.filter((t) => t.status === "resolved"),
    sort === "priority" ? "newest" : sort,
  );
  const chats = (conversations.data ?? []).filter((c) => !q || [c.id, c.title, c.customer_id, c.last_intent].some((v) => v?.toLowerCase().includes(q)));
  const openCount = allTickets.filter((t) => t.status !== "resolved").length;
  const filtering = !!q || priority !== "all";

  // Until the agent picks something, focus the most urgent open ticket (on wide screens; phones start on the list).
  const selection: Selection = chosen ?? (openTickets[0] ? { kind: "ticket", id: openTickets[0].id } : null);
  const rows: NonNullable<Selection>[] =
    tab === "conversations"
      ? chats.map((c) => ({ kind: "conversation", id: c.id }))
      : (tab === "open" ? openTickets : resolvedTickets).map((t) => ({ kind: "ticket", id: t.id }));

  // Keyboard shortcuts: j / k move through the list, "/" jumps to search.
  // The handler is registered once and reads the latest list through a ref.
  const navRef = useRef({ rows, selection });
  useEffect(() => {
    navRef.current = { rows, selection };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("dialog[open]")) return;
      const { rows: list, selection: current } = navRef.current;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if ((e.key === "j" || e.key === "k") && list.length) {
        e.preventDefault();
        const index = list.findIndex((r) => r.kind === current?.kind && r.id === current.id);
        const next = list[index === -1 ? 0 : Math.min(list.length - 1, Math.max(0, index + (e.key === "j" ? 1 : -1)))];
        setChosen(next);
        document.getElementById(`row-${next.kind}-${next.id}`)?.scrollIntoView({ block: "nearest" });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (tickets.error) return <ErrorNotice error={tickets.error} onRetry={tickets.reload} />;

  const listLoading = tab === "conversations" ? !conversations.data && !conversations.error : !tickets.data;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
      <aside className={cx("min-h-0 flex-col border-r border-slate-200 bg-surface", chosen ? "hidden md:flex" : "flex")} aria-label="Ticket queue">
        <div role="tablist" aria-label="Queue view" className="grid grid-cols-3 gap-1 border-b border-slate-200 p-2">
          {(
            [
              ["open", `Queue (${openCount})`, Inbox],
              ["resolved", "Resolved", CheckCheck],
              ["conversations", "All chats", MessagesSquare],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cx(
                "flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
                tab === key ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>

        <div className="space-y-2 border-b border-slate-200 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
              placeholder={tab === "conversations" ? "Search chats…" : "Search tickets, customers…"}
              aria-label="Search the queue"
              className="w-full rounded-md border border-slate-200 bg-surface py-1.5 pl-8 pr-8 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 px-1 font-mono text-[11px] text-slate-500 md:block">
              /
            </kbd>
          </div>
          {tab !== "conversations" && (
            <div className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-slate-500">
                Priority
                <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={cx(selectClass, "min-w-0 flex-1")}>
                  <option value="all">All</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {humanize(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-slate-500">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={cx(selectClass, "min-w-0 flex-1")}>
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {listLoading ? (
            <ListRowsSkeleton />
          ) : (
            <ul>
              {tab !== "conversations" &&
                (tab === "open" ? openTickets : resolvedTickets).map((t) => (
                  <li key={t.id}>
                    <TicketRow ticket={t} active={selection?.kind === "ticket" && selection.id === t.id} onClick={() => setChosen({ kind: "ticket", id: t.id })} />
                  </li>
                ))}
              {tab === "conversations" &&
                chats.map((c) => (
                  <li key={c.id}>
                    <ConversationRow
                      conversation={c}
                      active={selection?.kind === "conversation" && selection.id === c.id}
                      onClick={() => setChosen({ kind: "conversation", id: c.id })}
                    />
                  </li>
                ))}
            </ul>
          )}
          {!listLoading && rows.length === 0 && (
            filtering ? (
              <EmptyState title="No matches" body="Nothing in this view matches your search or filters.">
                <button
                  onClick={() => {
                    setQuery("");
                    setPriority("all");
                  }}
                  className="mt-3 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Clear filters
                </button>
              </EmptyState>
            ) : tab === "open" ? (
              <EmptyState title="Queue is clear" body="Escalations from Relay land here with an AI briefing and a suggested reply." />
            ) : tab === "resolved" ? (
              <EmptyState title="Nothing resolved yet" body="Resolved tickets are kept here for reference." />
            ) : (
              <EmptyState title="No conversations yet" body="Start one from the live demo." />
            )
          )}
        </div>
        <p className="hidden border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500 md:block">
          <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> next / previous · <kbd className="font-mono">/</kbd> search ·{" "}
          <kbd className="font-mono">Ctrl</kbd>+<kbd className="font-mono">Enter</kbd> send
        </p>
      </aside>

      <section className={cx("min-h-0 bg-slate-50", chosen ? "block" : "hidden md:block")}>
        {selection ? (
          <Workspace key={`${selection.kind}-${selection.id}`} selection={selection} onChanged={tickets.reload} onBack={() => setChosen(null)} />
        ) : listLoading ? (
          <WorkspaceSkeleton />
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
      id={`row-ticket-${t.id}`}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cx(
        "block w-full border-b border-l-2 border-b-slate-100 px-4 py-3 text-left transition",
        active ? "border-l-brand-600 bg-brand-50/60" : "border-l-transparent hover:bg-slate-50",
      )}
    >
      <div className="flex items-center gap-2">
        <PriorityPill priority={t.priority} />
        <span className="font-mono text-[11px] text-slate-500">{t.id}</span>
        <span className="ml-auto text-[11px] text-slate-500">{timeAgo(t.created_at)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-sm font-medium text-slate-900">
        {t.customer_name}
        {t.customer_tier === "Aurora+" && <Crown className="h-3 w-3 text-amber-500" aria-label="Aurora+ member" />}
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{t.reason}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{t.category}</span>
        {!!t.pending_actions && (
          <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
            <ShieldCheck className="h-3 w-3" aria-hidden /> Approval needed
          </span>
        )}
        {t.language && t.language !== "en" && (
          <span className="flex items-center gap-0.5 text-sky-700">
            <Globe className="h-3 w-3" aria-hidden /> {languageName(t.language)}
          </span>
        )}
        {t.status === "in_progress" && <span className="text-sky-700">In progress{t.assignee ? ` · ${t.assignee}` : ""}</span>}
        {t.overdue && (
          <span className="flex items-center gap-0.5 font-medium text-rose-600">
            <Clock className="h-3 w-3" aria-hidden /> SLA breached
          </span>
        )}
      </div>
    </button>
  );
}

function ConversationRow({ conversation: c, active, onClick }: { conversation: Conversation; active: boolean; onClick: () => void }) {
  return (
    <button
      id={`row-conversation-${c.id}`}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cx(
        "block w-full border-b border-l-2 border-b-slate-100 px-4 py-3 text-left transition",
        active ? "border-l-brand-600 bg-brand-50/60" : "border-l-transparent hover:bg-slate-50",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cx(
            "rounded px-1.5 py-0.5 text-[11px] font-semibold",
            c.status === "escalated" ? "bg-amber-100 text-amber-800" : c.status === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-brand-50 text-brand-700",
          )}
        >
          {c.status === "ai" ? "AI" : humanize(c.status)}
        </span>
        <span className="truncate text-xs text-slate-500">{c.customer_id ?? "Guest"}</span>
        <span className="ml-auto text-[11px] text-slate-500">{timeAgo(c.updated_at)}</span>
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

function EmptyState({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center p-8 text-center">
      <Inbox className="h-8 w-8 text-slate-300" aria-hidden />
      <p className="mt-2 text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-1 max-w-xs text-xs text-slate-500">{body}</p>
      {children}
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <LoadingRegion label="Loading ticket" className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-h-0 flex-col">
        <div className="space-y-2 border-b border-slate-200 bg-surface px-5 py-3.5">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <div className="flex-1 space-y-5 px-5 py-5">
          {["w-3/5", "w-2/5", "w-4/5", "w-1/3"].map((width, i) => (
            <div key={width} className={cx("flex gap-2.5", i % 2 === 0 && "flex-row-reverse")}>
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <Skeleton className={cx("h-14 rounded-xl", width)} />
            </div>
          ))}
        </div>
      </div>
      <div className="hidden space-y-3 border-l border-slate-200 bg-surface p-4 xl:block">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={3} />
      </div>
    </LoadingRegion>
  );
}

function Workspace({ selection, onChanged, onBack }: { selection: NonNullable<Selection>; onChanged: () => void; onBack: () => void }) {
  const detail = useAsync<ConversationDetail & { ticket?: Ticket }>(
    () => (selection.kind === "ticket" ? api.ticket(selection.id) : api.conversationDetail(selection.id)),
    `${selection.kind}:${selection.id}`,
    4000,
    ["messages", "tickets", "actions", "conversations"],
  );
  const [reply, setReply] = useState("");
  const [agentName, setAgentName, nameFromAccount] = useAgentName();
  const [busy, setBusy] = useState(false);
  const [assistBusy, setAssistBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const config = useWorkspaceConfig();
  const macros = useAsync(() => api.macros(), "macros", undefined, ["macros"]);
  const toast = useToast();
  const dialog = useDialog();

  const messageCount = detail.data?.messages.length ?? 0;
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messageCount]);

  if (detail.error) return <ErrorNotice error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <WorkspaceSkeleton />;

  const { conversation, messages, customer, memory, ticket, actions } = detail.data;
  const language = conversation.language ?? "en";
  const specialistReplied = messages.some((m) => m.role === "human_agent");

  /** The specialist's name is shown to customers, so ask for it once instead of inventing one. */
  const requireName = async (): Promise<string | null> => {
    if (agentName.trim()) return agentName.trim();
    const name = await dialog.prompt({
      title: "What's your name?",
      body: "Customers see this next to your replies and decisions. It's remembered in this browser.",
      label: "Display name",
      placeholder: "e.g. Sam",
      confirmLabel: "Continue",
      required: true,
    });
    if (name) setAgentName(name);
    return name;
  };

  const runCopilot = async (mode: CopilotMode) => {
    if (!reply.trim()) return;
    setAssistBusy(true);
    try {
      const res = await api.rewrite(reply, mode, conversation.id, mode === "translate" ? language : undefined);
      setReply(res.text);
      if (res.engine === "offline") toast.info("Rewritten with offline rules — connect an LLM for richer rewrites.");
    } catch (e) {
      toast.error(e, "Copilot is unavailable right now.");
    } finally {
      setAssistBusy(false);
    }
  };

  const insertMacro = (macro: Macro) => {
    const vars: Record<string, string> = {
      first_name: customer?.name.split(" ")[0] ?? "there",
      order_id: String(memory.entities.active_order_id ?? "your order"),
      ticket_id: ticket?.id ?? "",
      agent_name: agentName.trim() || "the support team",
      company_name: config?.company_name ?? "our",
    };
    const text = macro.body.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
    setReply((cur) => (cur.trim() ? `${cur.trim()}\n\n${text}` : text));
  };

  const draftArticle = async () => {
    if (!ticket) return;
    setAssistBusy(true);
    try {
      stashArticleDraft(await api.draftArticleFromTicket(ticket.id));
      router.push("/knowledge");
    } catch (e) {
      toast.error(e, "Couldn't draft an article.");
      setAssistBusy(false);
    }
  };

  const saveAsTest = async () => {
    setAssistBusy(true);
    try {
      const scenario = await api.scenarioFromConversation(conversation.id);
      toast.success(`Saved to Test Lab as “${scenario.name}”. It runs with every test run.`);
    } catch (e) {
      toast.error(e, "Couldn't save this conversation as a test.");
    } finally {
      setAssistBusy(false);
    }
  };

  const send = async (resolve: boolean) => {
    if (!ticket || busy || (!reply.trim() && !resolve)) return;
    const name = await requireName();
    if (!name) return;
    setBusy(true);
    try {
      if (reply.trim()) await api.replyTicket(ticket.id, reply.trim(), name, resolve);
      else await api.patchTicket(ticket.id, { status: "resolved", assignee: name });
      toast.success(reply.trim() ? (resolve ? "Reply sent and ticket resolved" : "Reply sent") : "Ticket resolved");
      setReply("");
      detail.reload();
      onChanged();
    } catch (e) {
      // Keep the draft so nothing the agent typed is lost.
      toast.error(e, "Couldn't send the reply. Your draft is still here.");
    } finally {
      setBusy(false);
    }
  };

  const updateTicket = async (patch: Partial<Pick<Ticket, "status" | "priority" | "assignee">>, success: string) => {
    if (!ticket) return;
    try {
      await api.patchTicket(ticket.id, patch);
      toast.success(success);
      detail.reload();
      onChanged();
    } catch (e) {
      toast.error(e, "Couldn't update the ticket.");
    }
  };

  const context = (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-surface p-4">
      {actions.length > 0 && (
        <ActionsCard
          actions={actions}
          requireName={requireName}
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
                onChange={(e) => void updateTicket({ priority: e.target.value as Ticket["priority"] }, `Priority set to ${humanize(e.target.value).toLowerCase()}`)}
                className={cx(selectClass, "mt-0.5 w-full text-slate-800")}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {humanize(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-slate-500">
              Status
              <select
                value={ticket.status}
                onChange={async (e) => {
                  const status = e.target.value as Ticket["status"];
                  const name = await requireName();
                  if (name) void updateTicket({ status, assignee: name }, `Marked ${STATUS_LABELS[status].toLowerCase()}`);
                }}
                className={cx(selectClass, "mt-0.5 w-full text-slate-800")}
              >
                {(Object.keys(STATUS_LABELS) as Ticket["status"][]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {ticket.sla_due_at && ticket.status !== "resolved" && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500">
              <Clock className="h-3 w-3" aria-hidden /> SLA due {new Date(ticket.sla_due_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
        </Card>
      )}

      <Card icon={<UserRound className="h-4 w-4 text-slate-600" />} title="Customer">
        {customer ? (
          <div className="space-y-2 text-xs">
            <div>
              <div className="flex items-center gap-1 font-medium text-slate-900">
                {customer.name} {customer.tier === "Aurora+" && <Crown className="h-3 w-3 text-amber-500" aria-label="Aurora+ member" />}
              </div>
              <div className="text-slate-500">{customer.email}</div>
              <div className="text-slate-500">
                {customer.tier} · since {customer.member_since} · {customer.rewards_points.toLocaleString()} pts
              </div>
            </div>
            {customer.health && (
              <div className="rounded-md bg-slate-50 px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-700">Customer health</span>
                  <HealthBadge score={customer.health.score} risk={customer.health.risk} />
                </div>
                {customer.health.factors.some((f) => f.impact < 0) ? (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                    {customer.health.factors
                      .filter((f) => f.impact < 0)
                      .slice(0, 3)
                      .map((f) => (
                        <li key={f.label} className="flex justify-between gap-2">
                          <span className="truncate">{f.label}</span>
                          <span className="shrink-0 font-mono text-rose-700">{f.impact}</span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-500">No churn signals in the last {customer.health.window_days} days.</p>
                )}
              </div>
            )}
            <ul className="space-y-1">
              {customer.recent_orders.map((o) => (
                <li key={o.order_id} className="rounded-md bg-slate-50 px-2 py-1.5">
                  <div className="flex justify-between">
                    <span className="font-mono text-[11px] text-slate-800">{o.order_id}</span>
                    <span className="text-[11px] text-slate-500">{humanize(o.status)}</span>
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {o.items} · {money(o.total)}
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
    </div>
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* Transcript + composer */}
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-surface px-3 py-3 sm:gap-3 sm:px-5">
          <button onClick={onBack} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 md:hidden" aria-label="Back to queue">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {ticket && <PriorityPill priority={ticket.priority} />}
              <h2 className="truncate text-sm font-semibold text-slate-900">{ticket ? ticket.reason : conversation.title}</h2>
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              {ticket ? `${ticket.id} · ${ticket.category} · opened ${timeAgo(ticket.created_at)}` : `${conversation.id} · ${humanize(conversation.status)}`}
              {language !== "en" && (
                <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">
                  <Globe className="h-3 w-3" aria-hidden /> {languageName(language)}
                </span>
              )}
            </p>
          </div>
          {ticket && specialistReplied && (
            <button
              onClick={() => void draftArticle()}
              disabled={assistBusy}
              className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Turn how this was resolved into a help-center article so the AI can answer it next time"
            >
              <BookPlus className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Save as KB article</span>
              <span className="sr-only sm:hidden">Save as KB article</span>
            </button>
          )}
          {messages.some((m) => m.role === "assistant") && (
            <button
              onClick={() => void saveAsTest()}
              disabled={assistBusy}
              className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Freeze how the AI handled this conversation into a Test Lab regression test"
            >
              <FlaskConical className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Save as test</span>
              <span className="sr-only sm:hidden">Save as test</span>
            </button>
          )}
          {ticket && ticket.status !== "resolved" && (
            <button
              onClick={() => void send(true)}
              disabled={busy}
              className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Resolve
            </button>
          )}
          <button
            onClick={() => setShowDetails(true)}
            className="relative flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 xl:hidden"
            aria-label="Show ticket details"
          >
            <PanelRight className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Details</span>
            {actions.some((a) => a.status === "pending_approval") && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-amber-500" aria-label="Approval needed" />
            )}
          </button>
        </div>

        <div ref={transcriptRef} role="log" aria-live="polite" aria-label="Conversation transcript" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-5">
          {messages.map((m) => (
            <TranscriptMessage key={m.id} message={m} />
          ))}
        </div>

        {ticket && ticket.status !== "resolved" ? (
          <form
            className="border-t border-slate-200 bg-surface p-3 sm:p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send(false);
            }}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {nameFromAccount ? (
                <span className="text-xs text-slate-500">
                  Replying as <span className="font-medium text-slate-700">{agentName}</span>
                </span>
              ) : (
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Replying as
                  <input
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="Your name"
                    className="w-32 rounded border border-slate-200 bg-surface px-1.5 py-0.5 text-xs text-slate-900 outline-none placeholder:text-slate-500 focus:border-brand-400"
                  />
                </label>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Menu label="Macros" icon={<MessageSquareQuote className="h-3.5 w-3.5" aria-hidden />}>
                  {(close) =>
                    macros.data?.length ? (
                      macros.data.map((m) => (
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
                      <p className="px-3 py-2 text-xs text-slate-500">{macros.data ? "No macros yet — add them in Settings." : "Loading macros…"}</p>
                    )
                  }
                </Menu>
                <Menu
                  label="Copilot"
                  icon={assistBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                  disabled={!reply.trim() || assistBusy}
                >
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
                    type="button"
                    onClick={() => setReply(ticket.suggested_reply)}
                    className="flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                  >
                    <Wand2 className="h-3.5 w-3.5" aria-hidden /> Use AI draft
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send(false);
                }
              }}
              rows={4}
              aria-label="Reply to customer"
              placeholder="Write a reply — the customer sees it instantly in their chat."
              className="w-full resize-none rounded-lg border border-slate-200 bg-surface p-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <span className="mr-auto hidden text-[11px] text-slate-500 sm:inline">Ctrl + Enter to send</span>
              <button
                type="button"
                onClick={() => void send(true)}
                disabled={busy || !reply.trim()}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Send & resolve
              </button>
              <button
                type="submit"
                disabled={busy || !reply.trim()}
                className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />} Send
              </button>
            </div>
          </form>
        ) : ticket ? (
          <div className="border-t border-slate-200 bg-surface p-3 text-center text-xs text-slate-500">
            Resolved {timeAgo(ticket.resolved_at)} ·{" "}
            <button className="font-medium text-brand-600 hover:underline" onClick={() => void updateTicket({ status: "open" }, "Ticket reopened")}>
              Reopen
            </button>
          </div>
        ) : null}
      </div>

      <SidePanel open={showDetails} onClose={() => setShowDetails(false)} label="Ticket details">
        {context}
      </SidePanel>
    </div>
  );
}

function ActionsCard({ actions, requireName, onChanged }: { actions: OrderAction[]; requireName: () => Promise<string | null>; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();
  const dialog = useDialog();
  const pending = actions.filter((a) => a.status === "pending_approval");
  const history = actions.filter((a) => a.status !== "pending_approval");

  const decide = async (action: OrderAction, approve: boolean) => {
    let note: string | undefined;
    if (approve) {
      const ok = await dialog.confirm({
        title: `Approve ${action.label.toLowerCase()}?`,
        body: (
          <>
            This executes <b>{money(action.amount)}</b> on <span className="font-mono">{action.order_id}</span>, notifies the customer and resolves the ticket.
          </>
        ),
        confirmLabel: "Approve",
      });
      if (!ok) return;
    } else {
      const input = await dialog.prompt({
        title: `Deny ${action.label.toLowerCase()}?`,
        body: "The customer is told the request was declined.",
        label: "Message to the customer (optional)",
        placeholder: "Explain the decision…",
        multiline: true,
        confirmLabel: "Deny request",
        tone: "danger",
      });
      if (input === null) return;
      note = input || undefined;
    }
    const name = await requireName();
    if (!name) return;
    setBusyId(action.id);
    try {
      if (approve) await api.approveAction(action.id, name);
      else await api.denyAction(action.id, name, note);
      toast.success(approve ? `${action.label} approved` : `${action.label} denied`);
      onChanged();
    } catch (e) {
      toast.error(e, "Couldn't update the action.");
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
              {busyId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCheck className="h-3.5 w-3.5" aria-hidden />} Approve
            </button>
            <button
              onClick={() => void decide(a, false)}
              disabled={busyId === a.id}
              className="flex items-center justify-center gap-1 rounded-md border border-amber-300 bg-surface py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Deny
            </button>
          </div>
        </div>
      ))}
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
      <div className="shrink-0" aria-hidden>
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
      <div className={cx("max-w-[85%] sm:max-w-[78%]", customer && "text-right")}>
        <div className="mb-0.5 text-[11px] text-slate-500">
          {customer ? "Customer" : human ? `${m.meta.agent_name ?? "Specialist"} (human)` : "Relay AI"} · {clockTime(m.created_at)}
        </div>
        <div
          className={cx(
            "inline-block rounded-xl border px-3 py-2 text-left text-sm text-slate-800",
            customer ? "border-brand-200 bg-brand-50" : human ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-surface",
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
