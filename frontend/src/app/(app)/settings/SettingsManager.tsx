"use client";

import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  MessageSquareQuote,
  Palette,
  Plus,
  Save,
  Send,
  SlidersHorizontal,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { ErrorNotice } from "@/components/AppShell";
import { LogoMark } from "@/components/Logo";
import { useAsync } from "@/hooks/useAsync";
import { ApiError, api } from "@/lib/api";
import { cx, timeAgo } from "@/lib/format";
import { brandStyle } from "@/lib/theme";
import type { Macro, Webhook, WorkspaceSettings } from "@/lib/types";

type Tab = "workspace" | "widget" | "webhooks" | "macros";

const TABS: { key: Tab; label: string; icon: typeof Palette }[] = [
  { key: "workspace", label: "Workspace & AI", icon: SlidersHorizontal },
  { key: "widget", label: "Install widget", icon: Code2 },
  { key: "webhooks", label: "Webhooks & Slack", icon: WebhookIcon },
  { key: "macros", label: "Macros", icon: MessageSquareQuote },
];

export function SettingsManager() {
  const [tab, setTab] = useState<Tab>("workspace");
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-6">
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Brand the assistant, tune AI policies, install the widget and connect your tools. Changes apply instantly.</p>
        <div className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-200">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cx(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition",
                tab === key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900",
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <div className="pt-6">
          {tab === "workspace" && <WorkspaceTab />}
          {tab === "widget" && <WidgetTab />}
          {tab === "webhooks" && <WebhooksTab />}
          {tab === "macros" && <MacrosTab />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ shared UI
function Card({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass = "w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-slate-50">
      <span className={cx("mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition", checked ? "bg-brand-600" : "bg-slate-300")}>
        <span className={cx("h-4 w-4 rounded-full bg-white shadow transition", checked && "translate-x-4")} />
      </span>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </button>
  );
}

function StatusLine({ status }: { status: string | null }) {
  if (!status) return null;
  return <span className={cx("text-xs", status.startsWith("Error") ? "text-rose-600" : "text-emerald-700")}>{status}</span>;
}

function errorText(e: unknown) {
  return `Error: ${e instanceof ApiError ? e.message : "something went wrong"}`;
}

// ------------------------------------------------------------------ workspace
function WorkspaceTab() {
  const settings = useAsync(() => api.settings(), "workspace-settings");
  if (settings.error) return <ErrorNotice error={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return <p className="text-sm text-slate-500">Loading…</p>;
  return <WorkspaceForm initial={settings.data.settings} provider={settings.data.provider} model={settings.data.model} />;
}

function WorkspaceForm({ initial, provider, model }: { initial: WorkspaceSettings; provider: string; model: string | null }) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.saveSettings(form);
      setForm(res.settings);
      setSaved(res.settings);
      setStatus("Saved — live for every new message ✓");
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card title="Brand" subtitle="How the assistant introduces itself in the widget and chat.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name">
              <input className={inputClass} value={form.company_name} onChange={(e) => set("company_name", e.target.value)} />
            </Field>
            <Field label="Assistant name">
              <input className={inputClass} value={form.assistant_name} onChange={(e) => set("assistant_name", e.target.value)} />
            </Field>
            <Field label="Accent colour" hint="Re-tints the widget, buttons and customer bubbles.">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.accent_color}
                  onChange={(e) => set("accent_color", e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                  aria-label="Accent colour picker"
                />
                <input className={cx(inputClass, "font-mono")} value={form.accent_color} onChange={(e) => set("accent_color", e.target.value)} />
              </div>
            </Field>
            <Field label="Suggested prompts" hint="One per line, up to 6. Shown as quick-start chips.">
              <textarea
                rows={3}
                className={cx(inputClass, "resize-none")}
                value={form.suggested_prompts.join("\n")}
                onChange={(e) => set("suggested_prompts", e.target.value.split("\n").slice(0, 6))}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Welcome message">
                <textarea rows={2} className={cx(inputClass, "resize-none")} value={form.welcome_message} onChange={(e) => set("welcome_message", e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="AI policies" subtitle={`Engine: ${provider === "offline" ? "offline rules (no API key)" : `${provider} · ${model}`}`}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`Confidence threshold · ${Math.round(form.confidence_threshold * 100)}%`} hint="Below this, answers go to a human.">
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.05}
                value={form.confidence_threshold}
                onChange={(e) => set("confidence_threshold", Number(e.target.value))}
                className="w-full accent-brand-600"
              />
            </Field>
            <Field label="Refund approval limit ($)" hint="Larger refunds need one-click approval.">
              <input type="number" min={0} className={inputClass} value={form.refund_approval_limit} onChange={(e) => set("refund_approval_limit", Number(e.target.value))} />
            </Field>
            <Field label="Friction turns before handoff" hint="Consecutive low-confidence or frustrated turns.">
              <input
                type="number"
                min={1}
                max={10}
                className={inputClass}
                value={form.low_confidence_streak_limit}
                onChange={(e) => set("low_confidence_streak_limit", Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-1 sm:grid-cols-2">
            <Toggle
              checked={form.auto_actions_enabled}
              onChange={(v) => set("auto_actions_enabled", v)}
              label="Agentic actions"
              hint="AI can cancel processing orders and start eligible returns after the customer confirms."
            />
            <Toggle
              checked={form.multilingual_enabled}
              onChange={(v) => set("multilingual_enabled", v)}
              label="Multilingual replies"
              hint="Detect the customer's language and answer in it."
            />
          </div>
        </Card>

        <Card title="ROI assumptions" subtitle="Used by Analytics to estimate time and cost saved by the AI.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minutes a human spends per ticket">
              <input type="number" min={0} className={inputClass} value={form.minutes_per_human_ticket} onChange={(e) => set("minutes_per_human_ticket", Number(e.target.value))} />
            </Field>
            <Field label="Fully loaded cost per agent hour ($)">
              <input type="number" min={0} className={inputClass} value={form.cost_per_agent_hour} onChange={(e) => set("cost_per_agent_hour", Number(e.target.value))} />
            </Field>
          </div>
        </Card>
      </div>

      <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Palette className="h-3.5 w-3.5" /> Live preview
          </p>
          <ChatPreview settings={form} />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <StatusLine status={status} />
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setForm(saved)}
              disabled={!dirty || busy}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Discard
            </button>
            <button
              onClick={() => void save()}
              disabled={!dirty || busy}
              className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" /> Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatPreview({ settings }: { settings: WorkspaceSettings }) {
  return (
    <div style={brandStyle(settings.accent_color)} className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
        <LogoMark className="h-7 w-7" />
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-900">
            {settings.assistant_name} · {settings.company_name}
          </div>
          <div className="text-[10px] text-slate-500">AI assistant · human help anytime</div>
        </div>
      </div>
      <div className="space-y-2 bg-slate-50 p-3 text-xs">
        <p className="text-center text-slate-600">{settings.welcome_message}</p>
        <div className="flex flex-wrap justify-center gap-1">
          {settings.suggested_prompts.filter(Boolean).map((p) => (
            <span key={p} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-700">
              {p}
            </span>
          ))}
        </div>
        <div className="ml-auto w-fit rounded-2xl rounded-br-md bg-brand-600 px-2.5 py-1.5 text-white">Please cancel my order</div>
        <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700">
          I can cancel <b>ORD-10460</b> right now. Reply <b>yes</b> to confirm.
        </div>
        <span className="inline-flex rounded-full bg-brand-600 px-2.5 py-1 text-[10px] font-medium text-white">Yes, cancel order</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ widget install
const emptySubscribe = () => () => {};

function WidgetTab() {
  const origin = useSyncExternalStore(emptySubscribe, () => window.location.origin, () => "https://your-relay-app.com");
  const [position, setPosition] = useState<"right" | "left">("right");
  const [openByDefault, setOpenByDefault] = useState(false);
  const [copied, setCopied] = useState(false);

  const attrs = [position === "left" ? ' data-position="left"' : "", openByDefault ? ' data-open="true"' : ""].join("");
  const snippet = `<script src="${origin}/widget.js"${attrs} async></script>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card title="Add Relay to any website" subtitle="Paste this tag before </body> on your storefront, help center or app. No build step or dependency.">
        <div className="relative overflow-x-auto rounded-lg bg-ink-950 p-4 pr-24 font-mono text-[13px] text-slate-100">
          <code className="whitespace-pre">{snippet}</code>
          <button
            onClick={() => void copy()}
            className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Launcher position">
            <select className={inputClass} value={position} onChange={(e) => setPosition(e.target.value as "right" | "left")}>
              <option value="right">Bottom right</option>
              <option value="left">Bottom left</option>
            </select>
          </Field>
          <div className="pt-4">
            <Toggle checked={openByDefault} onChange={setOpenByDefault} label="Open on page load" hint="Useful on dedicated help pages." />
          </div>
        </div>
        <ul className="mt-4 space-y-1.5 text-xs text-slate-600">
          <li>• Brand name, accent colour, welcome message and prompts come from <b>Workspace & AI</b> — no need to re-paste the snippet.</li>
          <li>• Conversations resume across page loads and hand off to your console like any other chat.</li>
          <li>
            • Signed-in shoppers: pass a verified identity from your backend. <code className="rounded bg-slate-100 px-1">data-customer-id</code> is for demos only.
          </li>
          <li>• Control it from your own code with <code className="rounded bg-slate-100 px-1">window.Relay.open()</code> and <code className="rounded bg-slate-100 px-1">window.Relay.close()</code>.</li>
        </ul>
      </Card>
      <Card title="Try it" subtitle="A sample storefront with the snippet installed.">
        <a
          href="/widget-demo.html"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Open sample storefront <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a
          href="/embed"
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Open chat full-page <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ webhooks
function WebhooksTab() {
  const data = useAsync(() => api.webhooks(), "webhooks", 10000);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Webhook["kind"]>("slack");
  const [events, setEvents] = useState<string[]>(["ticket.created", "sla.breached", "action.approval_requested"]);
  const [status, setStatus] = useState<string | null>(null);

  if (data.error) return <ErrorNotice error={data.error} onRetry={data.reload} />;
  if (!data.data) return <p className="text-sm text-slate-500">Loading…</p>;
  const catalog = data.data.events;

  const create = async () => {
    setStatus(null);
    try {
      await api.createWebhook({ name: name.trim() || (kind === "slack" ? "Slack alerts" : "Webhook"), url: url.trim(), kind, events });
      setName("");
      setUrl("");
      setStatus("Webhook added ✓");
      data.reload();
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Endpoints" subtitle="Relay POSTs events as they happen. Generic webhooks are signed with HMAC-SHA256.">
          {data.data.webhooks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              No endpoints yet. Add a Slack incoming-webhook URL to get escalation alerts in a channel.
            </p>
          ) : (
            <ul className="space-y-3">
              {data.data.webhooks.map((hook) => (
                <WebhookRow key={hook.id} hook={hook} catalog={catalog} onChanged={data.reload} />
              ))}
            </ul>
          )}
        </Card>

        <Card title="Add endpoint">
          <div className="space-y-3">
            <Field label="Type">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                {(["slack", "generic"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={cx("rounded-md py-1 text-xs font-medium", kind === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}
                  >
                    {k === "slack" ? "Slack" : "Generic JSON"}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "slack" ? "#support-escalations" : "Zendesk sync"} />
            </Field>
            <Field label="URL">
              <input
                className={cx(inputClass, "font-mono text-xs")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={kind === "slack" ? "https://hooks.slack.com/services/…" : "https://example.com/webhooks/relay"}
              />
            </Field>
            <Field label="Events">
              <div className="space-y-1">
                {Object.entries(catalog).map(([event, description]) => (
                  <label key={event} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-brand-600"
                      checked={events.includes(event)}
                      onChange={(e) => setEvents((cur) => (e.target.checked ? [...cur, event] : cur.filter((x) => x !== event)))}
                    />
                    <span>
                      <span className="font-mono text-slate-800">{event}</span>
                      <span className="block text-slate-500">{description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <div className="flex items-center justify-between gap-2">
              <StatusLine status={status} />
              <button
                onClick={() => void create()}
                disabled={!/^https?:\/\/\S+$/.test(url.trim()) || events.length === 0}
                className="ml-auto flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Recent deliveries" subtitle="Last 50 attempts across all endpoints.">
        {data.data.deliveries.length === 0 ? (
          <p className="text-xs text-slate-500">No deliveries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Event</th>
                  <th className="py-1.5 pr-3 font-medium">Endpoint</th>
                  <th className="py-1.5 pr-3 font-medium">Response</th>
                  <th className="py-1.5 pr-3 font-medium">Time</th>
                  <th className="py-1.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {data.data.deliveries.map((d) => (
                  <tr key={d.id} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3">
                      <span className={cx("rounded px-1.5 py-0.5 font-medium", d.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
                        {d.ok ? "Delivered" : "Failed"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-slate-800">{d.event}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{d.webhook_name ?? d.webhook_id}</td>
                    <td className="max-w-64 truncate py-1.5 pr-3 text-slate-600" title={d.error ?? undefined}>
                      {d.status_code ?? "—"} {d.error && !d.ok ? `· ${d.error}` : ""}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-slate-500">{d.duration_ms}ms</td>
                    <td className="py-1.5 text-slate-500">{timeAgo(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function WebhookRow({ hook, catalog, onChanged }: { hook: Webhook; catalog: Record<string, string>; onChanged: () => void }) {
  const [showSecret, setShowSecret] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const test = async () => {
    setNote("Sending…");
    try {
      const d = await api.testWebhook(hook.id);
      setNote(d.ok ? `Test delivered (${d.status_code}) ✓` : `Error: ${d.error ?? d.status_code}`);
    } catch (e) {
      setNote(errorText(e));
    }
    onChanged();
  };

  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", hook.kind === "slack" ? "bg-fuchsia-50 text-fuchsia-700" : "bg-slate-100 text-slate-700")}>
          {hook.kind}
        </span>
        <span className="text-sm font-medium text-slate-900">{hook.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">{hook.url}</span>
        <button
          onClick={() => void api.updateWebhook(hook.id, { active: !hook.active }).then(onChanged)}
          className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", hook.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}
        >
          {hook.active ? "Active" : "Paused"}
        </button>
        <button onClick={() => void test()} className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
          <Send className="h-3 w-3" /> Test
        </button>
        <button
          onClick={() => window.confirm(`Delete "${hook.name}"?`) && void api.deleteWebhook(hook.id).then(onChanged)}
          className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          aria-label="Delete webhook"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {hook.events.map((e) => (
          <span key={e} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600" title={catalog[e]}>
            {e}
          </span>
        ))}
      </div>
      {hook.secret && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
          Signing secret
          <code className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-slate-700">{showSecret ? hook.secret : "whsec_••••••••••••"}</code>
          <button onClick={() => setShowSecret((v) => !v)} className="text-slate-400 hover:text-slate-700" aria-label="Toggle secret">
            {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
      {note && <p className={cx("mt-1.5 text-[11px]", note.startsWith("Error") ? "text-rose-600" : "text-emerald-700")}>{note}</p>}
    </li>
  );
}

// ------------------------------------------------------------------ macros
const VARIABLES = ["{first_name}", "{order_id}", "{ticket_id}", "{agent_name}", "{company_name}"];

function MacrosTab() {
  const macros = useAsync(() => api.macros(), "macros");
  const [editing, setEditing] = useState<Pick<Macro, "title" | "body"> & { id?: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (macros.error) return <ErrorNotice error={macros.error} onRetry={macros.reload} />;

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await api.updateMacro(editing.id, editing.title, editing.body);
      else await api.createMacro(editing.title, editing.body);
      setEditing(null);
      setStatus("Macro saved ✓");
      macros.reload();
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card
        title="Saved replies"
        subtitle="Insert from the console composer. Variables are filled from the ticket automatically."
        actions={
          <button
            onClick={() => setEditing({ title: "", body: "" })}
            className="flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"
          >
            <Plus className="h-3.5 w-3.5" /> New macro
          </button>
        }
      >
        <ul className="divide-y divide-slate-100">
          {(macros.data ?? []).map((m) => (
            <li key={m.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{m.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{m.body}</p>
              </div>
              <button onClick={() => setEditing(m)} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
                Edit
              </button>
              <button
                onClick={() => window.confirm(`Delete "${m.title}"?`) && void api.deleteMacro(m.id).then(macros.reload)}
                className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                aria-label="Delete macro"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {macros.data?.length === 0 && <li className="py-6 text-center text-sm text-slate-500">No macros yet.</li>}
        </ul>
      </Card>

      <Card title={editing?.id ? "Edit macro" : editing ? "New macro" : "Editor"} actions={<StatusLine status={status} />}>
        {editing ? (
          <div className="space-y-3">
            <Field label="Title">
              <input className={inputClass} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </Field>
            <Field label="Reply">
              <textarea rows={7} className={cx(inputClass, "resize-none")} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-1">
              {VARIABLES.map((v) => (
                <button
                  key={v}
                  onClick={() => setEditing({ ...editing, body: `${editing.body}${v}` })}
                  className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-brand-50 hover:text-brand-700"
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={!editing.title.trim() || !editing.body.trim()}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Select a macro to edit, or create a new one. Available variables: {VARIABLES.join(", ")}.</p>
        )}
      </Card>
    </div>
  );
}
