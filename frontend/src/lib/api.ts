import type {
  AgentStep,
  Analytics,
  ArticleDraft,
  AuthMode,
  Me,
  TeamMember,
  UserRole,
  Conversation,
  ConversationDetail,
  CopilotMode,
  CustomerHealth,
  CustomerHealthReport,
  DemoCustomer,
  EvalOverview,
  EvalRun,
  EvalScenario,
  EvalScenarioInput,
  KBDocument,
  KBDocumentSummary,
  KnowledgeGap,
  Macro,
  Message,
  OrderAction,
  PublicConfig,
  PulseReport,
  SearchHit,
  Ticket,
  Webhook,
  WebhookDelivery,
  WorkspaceSettings,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const ADMIN_KEY_STORAGE = "relay.adminKey";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** A human-readable message for anything thrown by an API call. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "You're signed out. Sign in again to continue.";
    if (error.status === 403) return error.message || "You don't have permission to do that.";
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setAdminKey(key: string) {
  try {
    window.localStorage.setItem(ADMIN_KEY_STORAGE, key);
  } catch {
    /* storage unavailable */
  }
}

/** Fired when a console request comes back 401, so the auth layer can show the sign-in screen. */
export const UNAUTHORIZED_EVENT = "relay:unauthorized";

async function request<T>(path: string, init: RequestInit = {}, admin = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (admin && getAdminKey()) headers.set("X-Admin-Key", getAdminKey());
  // Required by the API on cookie-authenticated writes; foreign sites can't add it without passing CORS.
  headers.set("X-Relay-CSRF", "1");
  let res: Response;
  try {
    // credentials: include sends the HttpOnly session cookie to the API origin.
    res = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store", credentials: "include" });
  } catch {
    throw new ApiError(0, `Can't reach the Relay API at ${API_URL}. Is the backend running?`);
  }
  if (res.status === 401 && admin && typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

// ------------------------------------------------------------------ public
export const api = {
  config: () => request<PublicConfig>("/api/config"),
  health: () => request<{ status: string; provider: string; model: string | null; kb_documents: number; kb_chunks: number }>("/api/health"),
  demoCustomers: () => request<DemoCustomer[]>("/api/demo/customers"),
  conversation: (id: string) => request<{ conversation: Conversation; messages: Message[]; ticket: Ticket | null }>(`/api/conversations/${id}`),
  pollMessages: (id: string, afterId: number) =>
    request<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${id}/messages?after_id=${afterId}`),
  feedback: (id: string, rating: number, comment?: string) =>
    request<{ ok: boolean }>(`/api/conversations/${id}/feedback`, { method: "POST", body: JSON.stringify({ rating, comment }) }),

  // ---------------------------------------------------------------- admin
  conversations: (status?: string) => request<Conversation[]>(`/api/admin/conversations${status ? `?status=${status}` : ""}`, {}, true),
  conversationDetail: (id: string) => request<ConversationDetail>(`/api/admin/conversations/${id}`, {}, true),
  tickets: (status?: string) => request<Ticket[]>(`/api/admin/tickets${status ? `?status=${status}` : ""}`, {}, true),
  ticket: (id: string) => request<ConversationDetail & { ticket: Ticket }>(`/api/admin/tickets/${id}`, {}, true),
  replyTicket: (id: string, content: string, agentName: string, resolve: boolean) =>
    request<{ message: Message; ticket: Ticket }>(
      `/api/admin/tickets/${id}/reply`,
      { method: "POST", body: JSON.stringify({ content, agent_name: agentName, resolve }) },
      true,
    ),
  patchTicket: (id: string, patch: Partial<Pick<Ticket, "status" | "priority" | "assignee">>) =>
    request<Ticket>(`/api/admin/tickets/${id}`, { method: "PATCH", body: JSON.stringify(patch) }, true),
  analytics: () => request<Analytics>("/api/admin/analytics", {}, true),
  kbDocuments: () => request<KBDocumentSummary[]>("/api/admin/kb/documents", {}, true),
  kbDocument: (id: string) => request<KBDocument>(`/api/admin/kb/documents/${id}`, {}, true),
  kbSave: (id: string, doc: Omit<KBDocument, "id">) =>
    request<KBDocument>(`/api/admin/kb/documents/${id}`, { method: "PUT", body: JSON.stringify(doc) }, true),
  kbCreate: (doc: Omit<KBDocument, "id">) =>
    request<KBDocument>("/api/admin/kb/documents", { method: "POST", body: JSON.stringify(doc) }, true),
  kbDelete: (id: string) => request<{ ok: boolean }>(`/api/admin/kb/documents/${id}`, { method: "DELETE" }, true),
  kbSearch: (query: string, topK = 5) =>
    request<SearchHit[]>("/api/admin/kb/search", { method: "POST", body: JSON.stringify({ query, top_k: topK }) }, true),

  // ---------------------------------------------------------------- workspace & product features
  settings: () =>
    request<{ settings: WorkspaceSettings; provider: string; model: string | null; languages: Record<string, string> }>("/api/admin/settings", {}, true),
  saveSettings: (patch: Partial<WorkspaceSettings>) =>
    request<{ settings: WorkspaceSettings }>("/api/admin/settings", { method: "PATCH", body: JSON.stringify(patch) }, true),

  actions: (status?: string) => request<OrderAction[]>(`/api/admin/actions${status ? `?status=${status}` : ""}`, {}, true),
  approveAction: (id: string, agentName: string, resolveTicket = true) =>
    request<OrderAction>(`/api/admin/actions/${id}/approve`, { method: "POST", body: JSON.stringify({ agent_name: agentName, resolve_ticket: resolveTicket }) }, true),
  denyAction: (id: string, agentName: string, note?: string) =>
    request<OrderAction>(`/api/admin/actions/${id}/deny`, { method: "POST", body: JSON.stringify({ agent_name: agentName, note: note || null }) }, true),

  macros: () => request<Macro[]>("/api/admin/macros", {}, true),
  createMacro: (title: string, body: string) => request<Macro>("/api/admin/macros", { method: "POST", body: JSON.stringify({ title, body }) }, true),
  updateMacro: (id: string, title: string, body: string) =>
    request<Macro>(`/api/admin/macros/${id}`, { method: "PUT", body: JSON.stringify({ title, body }) }, true),
  deleteMacro: (id: string) => request<{ ok: boolean }>(`/api/admin/macros/${id}`, { method: "DELETE" }, true),

  rewrite: (text: string, mode: CopilotMode, conversationId?: string, language?: string) =>
    request<{ text: string; engine: "llm" | "offline"; language: string }>(
      "/api/admin/copilot/rewrite",
      { method: "POST", body: JSON.stringify({ text, mode, conversation_id: conversationId ?? null, language: language ?? null }) },
      true,
    ),

  knowledgeGaps: (days = 30) => request<KnowledgeGap[]>(`/api/admin/insights/knowledge-gaps?days=${days}`, {}, true),
  draftArticle: (questions: string[]) => request<ArticleDraft>("/api/admin/kb/drafts", { method: "POST", body: JSON.stringify({ questions }) }, true),
  draftArticleFromTicket: (ticketId: string) => request<ArticleDraft>(`/api/admin/kb/drafts/ticket/${ticketId}`, { method: "POST" }, true),

  webhooks: () => request<{ webhooks: Webhook[]; events: Record<string, string>; deliveries: WebhookDelivery[] }>("/api/admin/webhooks", {}, true),
  createWebhook: (hook: Pick<Webhook, "name" | "url" | "kind" | "events">) =>
    request<Webhook>("/api/admin/webhooks", { method: "POST", body: JSON.stringify(hook) }, true),
  updateWebhook: (id: string, patch: Partial<Pick<Webhook, "name" | "active" | "events">>) =>
    request<Webhook>(`/api/admin/webhooks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }, true),
  deleteWebhook: (id: string) => request<{ ok: boolean }>(`/api/admin/webhooks/${id}`, { method: "DELETE" }, true),
  testWebhook: (id: string) => request<WebhookDelivery>(`/api/admin/webhooks/${id}/test`, { method: "POST" }, true),

  resetDemoOrders: () => request<{ ok: boolean }>("/api/admin/demo/reset-orders", { method: "POST" }, true),

  pulse: () => request<PulseReport>("/api/admin/insights/pulse", {}, true),
  customerHealthReport: (limit = 8) => request<CustomerHealthReport>(`/api/admin/insights/customer-health?limit=${limit}`, {}, true),
  customerHealth: (id: string) => request<CustomerHealth>(`/api/admin/customers/${id}/health`, {}, true),

  evals: () => request<EvalOverview>("/api/admin/evals", {}, true),
  evalRun: (id: string) => request<EvalRun>(`/api/admin/evals/runs/${id}`, {}, true),
  startEvalRun: (scenarioIds?: string[]) =>
    request<EvalRun>("/api/admin/evals/runs", { method: "POST", body: JSON.stringify({ scenario_ids: scenarioIds ?? null }) }, true),
  createScenario: (scenario: EvalScenarioInput) =>
    request<EvalScenario>("/api/admin/evals/scenarios", { method: "POST", body: JSON.stringify(scenario) }, true),
  updateScenario: (id: string, scenario: EvalScenarioInput) =>
    request<EvalScenario>(`/api/admin/evals/scenarios/${id}`, { method: "PUT", body: JSON.stringify(scenario) }, true),
  deleteScenario: (id: string) => request<{ ok: boolean }>(`/api/admin/evals/scenarios/${id}`, { method: "DELETE" }, true),
  scenarioFromConversation: (conversationId: string) =>
    request<EvalScenario>(`/api/admin/evals/scenarios/from-conversation/${conversationId}`, { method: "POST" }, true),

  // ---------------------------------------------------------------- auth & team
  authConfig: () => request<{ mode: AuthMode; google_client_id: string | null }>("/api/auth/config"),
  me: () => request<Me>("/api/auth/me", {}, true), // sends a stored admin key too, so API-key mode reports its role
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  users: () => request<TeamMember[]>("/api/admin/users", {}, true),
  inviteUser: (email: string, role: UserRole) => request<TeamMember>("/api/admin/users", { method: "POST", body: JSON.stringify({ email, role }) }, true),
  updateUser: (id: string, patch: { role?: UserRole; status?: "active" | "disabled" }) =>
    request<TeamMember>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }, true),
  removeUser: (id: string) => request<{ ok: boolean }>(`/api/admin/users/${id}`, { method: "DELETE" }, true),
};

/** Download an admin CSV export (fetch + blob so the admin key header is sent). */
export async function downloadExport(kind: "tickets" | "conversations"): Promise<void> {
  const headers = new Headers();
  if (getAdminKey()) headers.set("X-Admin-Key", getAdminKey());
  const res = await fetch(`${API_URL}/api/admin/export/${kind}.csv`, { headers, cache: "no-store", credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `relay-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------ cross-page handoff
const KB_DRAFT_KEY = "relay.kbDraft";

export function stashArticleDraft(draft: ArticleDraft) {
  try {
    window.sessionStorage.setItem(KB_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable */
  }
}

export function takeArticleDraft(): ArticleDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KB_DRAFT_KEY);
    window.sessionStorage.removeItem(KB_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as ArticleDraft) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ streaming chat
export interface StreamHandlers {
  onConversation?: (c: Conversation) => void;
  onCustomerMessage?: (m: Message) => void;
  onStep?: (s: AgentStep) => void;
  onMessage?: (m: Message, c: Conversation) => void;
}

export async function streamChat(
  body: { message: string; conversation_id?: string | null; customer_id?: string | null },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, `Can't reach the Relay API at ${API_URL}. Is the backend running?`);
  }
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === "conversation") handlers.onConversation?.(payload.conversation);
      else if (event === "customer_message") handlers.onCustomerMessage?.(payload.message);
      else if (event === "step") handlers.onStep?.(payload.step);
      else if (event === "message") handlers.onMessage?.(payload.message, payload.conversation);
    }
  }
}
