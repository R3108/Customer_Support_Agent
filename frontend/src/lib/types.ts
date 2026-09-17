export type Role = "customer" | "assistant" | "human_agent" | "system";

export interface SourceRef {
  id: string;
  title: string;
  section: string;
  score: number;
}

export interface ConfidenceBreakdown {
  intent?: number;
  retrieval?: number;
  grounding?: number;
  evidence?: number;
  generation?: number;
  sentiment_penalty?: number;
  clarify_floor?: boolean;
  policy_trigger?: string;
  matched?: string;
  final?: number;
}

export interface MessageMeta {
  intent?: string;
  intent_label?: string;
  intent_confidence?: number;
  sentiment?: string;
  confidence?: number;
  confidence_breakdown?: ConfidenceBreakdown;
  action?: "answer" | "clarify" | "escalate";
  escalated?: boolean;
  escalation_reason?: string;
  ticket_id?: string | null;
  sources?: SourceRef[];
  mode?: string;
  latency_ms?: number;
  route?: string[];
  agent_name?: string;
  handoff?: boolean;
  resolved?: boolean;
  error?: boolean;
  language?: string;
  action_proposal?: ActionProposal | null;
  action_result?: ActionSummary | null;
  knowledge_gap?: boolean;
}

export type ActionType = "cancel_order" | "start_return" | "refund";
export type ActionStatus = "pending_approval" | "executed" | "denied" | "failed";

export interface ActionProposal {
  type: ActionType;
  order_id: string;
  label: string;
}

export interface ActionSummary extends ActionProposal {
  id: string;
  status: ActionStatus;
  amount: number | null;
}

export interface OrderAction extends ActionSummary {
  conversation_id: string | null;
  ticket_id: string | null;
  customer_id: string | null;
  result: { message?: string; error?: string; rma?: string };
  requested_by: string;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface Message {
  id: number;
  conversation_id: string;
  role: Role;
  content: string;
  meta: MessageMeta;
  created_at: string;
}

export type ConversationStatus = "ai" | "escalated" | "resolved";

export interface Conversation {
  id: string;
  customer_id: string | null;
  status: ConversationStatus;
  title: string | null;
  last_intent: string | null;
  last_confidence: number | null;
  csat: number | null;
  language?: string | null;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message?: string;
}

export interface AgentStep {
  node: string;
  label: string;
  data: Record<string, unknown>;
}

export type Priority = "low" | "normal" | "high" | "urgent";

export interface Ticket {
  id: string;
  conversation_id: string;
  customer_id: string | null;
  customer_name?: string;
  customer_tier?: string | null;
  status: "open" | "in_progress" | "resolved";
  priority: Priority;
  category: string;
  reason: string;
  summary: string;
  suggested_reply: string;
  confidence: number | null;
  assignee: string | null;
  sla_due_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  overdue?: boolean;
  pending_actions?: number;
  language?: string;
}

export interface DemoCustomer {
  id: string;
  name: string;
  email: string;
  tier: string;
  orders: { id: string; status: string; total: number }[];
}

export interface CustomerSummary {
  customer_id: string;
  name: string;
  email: string;
  tier: string;
  member_since: string;
  rewards_points: number;
  recent_orders: { order_id: string; placed_at: string; status: string; total: number; items: string }[];
}

export interface AgentMemory {
  entities: Record<string, unknown>;
  summary: string;
  messages_in_window: number;
  low_confidence_streak: number;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  customer: CustomerSummary | null;
  memory: AgentMemory;
  ticket?: Ticket;
  actions: OrderAction[];
}

export interface PublicConfig {
  assistant_name: string;
  company_name: string;
  accent_color: string;
  welcome_message: string;
  suggested_prompts: string[];
  provider: string;
  model: string | null;
  confidence_threshold: number;
  refund_approval_limit: number;
  auto_actions_enabled: boolean;
  multilingual_enabled: boolean;
  admin_key_required: boolean;
}

export interface WorkspaceSettings {
  company_name: string;
  assistant_name: string;
  accent_color: string;
  welcome_message: string;
  suggested_prompts: string[];
  confidence_threshold: number;
  refund_approval_limit: number;
  low_confidence_streak_limit: number;
  auto_actions_enabled: boolean;
  multilingual_enabled: boolean;
  minutes_per_human_ticket: number;
  cost_per_agent_hour: number;
}

export interface Macro {
  id: string;
  title: string;
  body: string;
  updated_at: string;
}

export type CopilotMode = "friendlier" | "shorter" | "formal" | "empathetic" | "fix_grammar" | "translate";

export interface KnowledgeGap {
  id: string;
  title: string;
  count: number;
  conversations: number;
  examples: string[];
  top_terms: string[];
  intent: string;
  last_seen: string;
}

export interface ArticleDraft {
  title: string;
  category: string;
  body: string;
  engine: "llm" | "offline";
}

export interface Webhook {
  id: string;
  name: string;
  url: string;
  kind: "generic" | "slack";
  events: string[];
  secret: string | null;
  active: boolean;
  created_at: string;
}

export interface WebhookDelivery {
  id: number;
  webhook_id: string;
  webhook_name: string | null;
  event: string;
  ok: number | boolean;
  status_code: number | null;
  error: string | null;
  duration_ms: number;
  created_at: string;
}

export interface KBDocumentSummary {
  id: string;
  title: string;
  category: string;
  chunks: number;
  characters: number;
  updated_at: string;
}

export interface KBDocument {
  id: string;
  title: string;
  category: string;
  body: string;
}

export interface SearchHit extends SourceRef {
  doc_id: string;
  category: string;
  text: string;
}

export interface Analytics {
  total_conversations: number;
  ai_resolved_conversations: number;
  escalated_conversations: number;
  deflection_rate: number;
  open_tickets: number;
  resolved_tickets: number;
  ai_replies: number;
  avg_confidence: number | null;
  avg_latency_ms: number | null;
  csat_avg: number | null;
  csat_count: number;
  intents: Record<string, number>;
  confidence_buckets: Record<string, number>;
  tickets_by_priority: Record<string, number>;
  tickets_by_category: Record<string, number>;
  conversations_per_day: { day: string; count: number }[];
  roi: { handled_by_ai: number; hours_saved: number; cost_saved: number; minutes_per_human_ticket: number; cost_per_agent_hour: number };
  sla: {
    tickets_with_sla: number;
    breached: number;
    open_breached: number;
    compliance_rate: number | null;
    avg_first_response_minutes: number | null;
    avg_resolution_minutes: number | null;
  };
  automation: {
    executed_actions: number;
    automated_actions: number;
    approved_actions: number;
    pending_approvals: number;
    denied_actions: number;
    refunded_amount: number;
    by_type: Record<string, number>;
  };
  languages: Record<string, number>;
  knowledge_gaps: number;
}
