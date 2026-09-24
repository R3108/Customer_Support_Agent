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
  UserPlus,
  Users,
  Webhook as WebhookIcon,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ErrorNotice } from "@/components/AppShell";
import { useAuth } from "@/components/auth/AuthProvider";
import { LogoMark } from "@/components/Logo";
import { useDialog } from "@/components/ui/Dialog";
import { CardSkeleton, LoadingRegion, Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { cx, timeAgo } from "@/lib/format";
import { brandStyle } from "@/lib/theme";
import type { Macro, UserRole, TeamMember, Webhook, WorkspaceSettings } from "@/lib/types";

type Tab = "workspace" | "widget" | "webhooks" | "macros" | "team";

const TABS: { key: Tab; label: string; icon: typeof Palette }[] = [
  { key: "workspace", label: "Workspace & AI", icon: SlidersHorizontal },
  { key: "widget", label: "Install widget", icon: Code2 },
  { key: "webhooks", label: "Webhooks & Slack", icon: WebhookIcon },
  { key: "macros", label: "Macros", icon: MessageSquareQuote },
  { key: "team", label: "Team", icon: Users },
];

export function SettingsManager() {
  const [tab, setTab] = useState<Tab>("workspace");
  const { isAdmin } = useAuth();
  if (!isAdmin) return <ErrorNotice error={{ status: 403 }} />;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-6">
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Brand the assistant, tune AI policies, install the widget and connect your tools. Changes apply instantly.</p>
        <div role="tablist" aria-label="Settings sections" className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-200">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
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
          {tab === "team" && <TeamTab />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ shared UI
function Card({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-surface p-5">
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

const inputClass = "w-full rounded-md border border-slate-200 bg-surface px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-slate-50"
    >
      <span className={cx("mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition", checked ? "bg-brand-600" : "bg-slate-300")} aria-hidden>
        <span className={cx("h-4 w-4 rounded-full bg-white shadow transition", checked && "translate-x-4")} />
      </span>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </button>
  );
}

function TwoColumnSkeleton() {
  return (
    <LoadingRegion label="Loading settings" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={3} />
      </div>
      <CardSkeleton lines={6} />
    </LoadingRegion>
  );
}

// ------------------------------------------------------------------ workspace
function WorkspaceTab() {
  const settings = useAsync(() => api.settings(), "workspace-settings");
  if (settings.error) return <ErrorNotice error={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return <TwoColumnSkeleton />;
  return <WorkspaceForm initial={settings.data.settings} provider={settings.data.provider} model={settings.data.model} />;
}

function WorkspaceForm({ initial, provider, model }: { initial: WorkspaceSettings; provider: string; model: string | null }) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Warn before closing the tab with unsaved settings.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.saveSettings(form);
      setForm(res.settings);
      setSaved(res.settings);
      toast.success("Settings saved — live for every new message");
    } catch (e) {
      toast.error(e, "Couldn't save settings.");
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
                  className="h-9 w-12 cursor-pointer rounded border border-slate-200 bg-surface p-0.5"
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
        <div className="rounded-xl border border-slate-200 bg-surface p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Palette className="h-3.5 w-3.5" /> Live preview
          </p>
          <ChatPreview settings={form} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-surface p-3">
          <span className={cx("whitespace-nowrap text-xs", dirty ? "font-medium text-amber-700" : "text-slate-500")}>{dirty ? "Unsaved changes" : "All changes saved"}</span>
          <div className="ml-auto flex gap-2 whitespace-nowrap">
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
    // force-light: customers always see the widget in light mode, so the preview does too.
    <div style={brandStyle(settings.accent_color)} className="force-light overflow-hidden rounded-xl border border-slate-200 bg-surface">
      <span className="sr-only">Preview of the customer chat widget</span>
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
        <LogoMark className="h-7 w-7" />
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-900">
            {settings.assistant_name} · {settings.company_name}
          </div>
          <div className="text-[11px] text-slate-500">AI assistant · human help anytime</div>
        </div>
      </div>
      <div className="space-y-2 bg-slate-50 p-3 text-xs">
        <p className="text-center text-slate-600">{settings.welcome_message}</p>
        <div className="flex flex-wrap justify-center gap-1">
          {settings.suggested_prompts.filter(Boolean).map((p) => (
            <span key={p} className="rounded-full border border-slate-200 bg-surface px-2 py-0.5 text-[11px] text-slate-700">
              {p}
            </span>
          ))}
        </div>
        <div className="ml-auto w-fit rounded-2xl rounded-br-md bg-brand-600 px-2.5 py-1.5 text-white">Please cancel my order</div>
        <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-surface px-2.5 py-1.5 text-slate-700">
          I can cancel <b>ORD-10460</b> right now. Reply <b>yes</b> to confirm.
        </div>
        <span className="inline-flex rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-medium text-white">Yes, cancel order</span>
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
  const toast = useToast();

  const attrs = [position === "left" ? ' data-position="left"' : "", openByDefault ? ' data-open="true"' : ""].join("");
  const snippet = `<script src="${origin}/widget.js"${attrs} async></script>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Your browser blocked clipboard access — select the snippet and copy it manually.");
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card title="Add Relay to any website" subtitle="Paste this tag before </body> on your storefront, help center or app. No build step or dependency.">
        <div className="relative overflow-x-auto rounded-lg bg-ink-950 p-4 pr-24 font-mono text-[13px] text-white/90">
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
  const data = useAsync(() => api.webhooks(), "webhooks", 10000, ["webhooks"]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Webhook["kind"]>("slack");
  const [events, setEvents] = useState<string[]>(["ticket.created", "sla.breached", "action.approval_requested"]);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  if (data.error) return <ErrorNotice error={data.error} onRetry={data.reload} />;
  if (!data.data) return <TwoColumnSkeleton />;
  const catalog = data.data.events;

  const create = async () => {
    setCreating(true);
    try {
      await api.createWebhook({ name: name.trim() || (kind === "slack" ? "Slack alerts" : "Webhook"), url: url.trim(), kind, events });
      setName("");
      setUrl("");
      toast.success("Webhook added");
      data.reload();
    } catch (e) {
      toast.error(e, "Couldn't add the webhook.");
    } finally {
      setCreating(false);
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
                    className={cx("rounded-md py-1 text-xs font-medium", kind === k ? "bg-surface text-slate-900 shadow-sm" : "text-slate-600")}
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
              {url.trim() && !/^https?:\/\/\S+$/.test(url.trim()) && <span className="text-xs text-rose-600">Enter a full http(s) URL</span>}
              <button
                onClick={() => void create()}
                disabled={creating || !/^https?:\/\/\S+$/.test(url.trim()) || events.length === 0}
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
  const [testing, setTesting] = useState(false);
  const toast = useToast();
  const dialog = useDialog();

  const test = async () => {
    setTesting(true);
    try {
      const d = await api.testWebhook(hook.id);
      if (d.ok) toast.success(`Test event delivered to ${hook.name} (${d.status_code})`);
      else toast.error(`Test delivery to ${hook.name} failed: ${d.error ?? d.status_code}`);
    } catch (e) {
      toast.error(e, "Couldn't send the test event.");
    } finally {
      setTesting(false);
    }
    onChanged();
  };

  const toggle = async () => {
    try {
      await api.updateWebhook(hook.id, { active: !hook.active });
      toast.success(hook.active ? `${hook.name} paused` : `${hook.name} resumed`);
      onChanged();
    } catch (e) {
      toast.error(e, "Couldn't update the webhook.");
    }
  };

  const remove = async () => {
    const ok = await dialog.confirm({
      title: `Delete "${hook.name}"?`,
      body: "Relay stops sending events to this endpoint immediately.",
      confirmLabel: "Delete webhook",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteWebhook(hook.id);
      toast.success("Webhook deleted");
      onChanged();
    } catch (e) {
      toast.error(e, "Couldn't delete the webhook.");
    }
  };

  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase", hook.kind === "slack" ? "bg-fuchsia-50 text-fuchsia-700" : "bg-slate-100 text-slate-700")}>
          {hook.kind}
        </span>
        <span className="text-sm font-medium text-slate-900">{hook.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">{hook.url}</span>
        <button
          role="switch"
          aria-checked={hook.active}
          aria-label={`${hook.name} delivery`}
          title={hook.active ? "Click to pause" : "Click to resume"}
          onClick={() => void toggle()}
          className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", hook.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}
        >
          {hook.active ? "Active" : "Paused"}
        </button>
        <button
          onClick={() => void test()}
          disabled={testing}
          className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Send className="h-3 w-3" aria-hidden /> {testing ? "Sending…" : "Test"}
        </button>
        <button
          onClick={() => void remove()}
          className="rounded-md p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
          aria-label={`Delete webhook ${hook.name}`}
          title="Delete webhook"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {hook.events.map((e) => (
          <span key={e} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600" title={catalog[e]}>
            {e}
          </span>
        ))}
      </div>
      {hook.secret && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
          Signing secret
          <code className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-slate-700">{showSecret ? hook.secret : "whsec_••••••••••••"}</code>
          <button
            onClick={() => setShowSecret((v) => !v)}
            className="text-slate-500 hover:text-slate-700"
            aria-label={showSecret ? "Hide signing secret" : "Show signing secret"}
            aria-pressed={showSecret}
          >
            {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ macros
const VARIABLES = ["{first_name}", "{order_id}", "{ticket_id}", "{agent_name}", "{company_name}"];

function MacrosTab() {
  const macros = useAsync(() => api.macros(), "macros", undefined, ["macros"]);
  const [editing, setEditing] = useState<Pick<Macro, "title" | "body"> & { id?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const dialog = useDialog();

  if (macros.error) return <ErrorNotice error={macros.error} onRetry={macros.reload} />;

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.id) await api.updateMacro(editing.id, editing.title, editing.body);
      else await api.createMacro(editing.title, editing.body);
      setEditing(null);
      toast.success("Macro saved");
      macros.reload();
    } catch (e) {
      toast.error(e, "Couldn't save the macro.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: Macro) => {
    const ok = await dialog.confirm({ title: `Delete "${m.title}"?`, body: "Specialists won't be able to insert it any more.", confirmLabel: "Delete macro", tone: "danger" });
    if (!ok) return;
    try {
      await api.deleteMacro(m.id);
      if (editing?.id === m.id) setEditing(null);
      toast.success("Macro deleted");
      macros.reload();
    } catch (e) {
      toast.error(e, "Couldn't delete the macro.");
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
        {!macros.data && (
          <LoadingRegion label="Loading macros" className="space-y-4 py-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ))}
          </LoadingRegion>
        )}
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
                onClick={() => void remove(m)}
                className="rounded-md p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                aria-label={`Delete macro ${m.title}`}
                title="Delete macro"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {macros.data?.length === 0 && <li className="py-6 text-center text-sm text-slate-500">No macros yet.</li>}
        </ul>
      </Card>

      <Card title={editing?.id ? "Edit macro" : editing ? "New macro" : "Editor"}>
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
                disabled={saving || !editing.title.trim() || !editing.body.trim()}
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

// ------------------------------------------------------------------ team
const ROLE_HELP: Record<UserRole, string> = {
  agent: "Works tickets, approves actions, edits the knowledge base",
  admin: "Everything agents can do, plus settings, webhooks, macros and the team",
};

function TeamTab() {
  const { mode, user: me } = useAuth();
  const members = useAsync(() => api.users(), "team", undefined, ["users"]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("agent");
  const [inviting, setInviting] = useState(false);
  const toast = useToast();
  const dialog = useDialog();
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  if (members.error) return <ErrorNotice error={members.error} onRetry={members.reload} />;

  const invite = async () => {
    setInviting(true);
    try {
      const created = await api.inviteUser(email.trim(), role);
      toast.success(`${created.email} can now sign in with Google as ${created.role === "admin" ? "an admin" : "an agent"}`);
      setEmail("");
      members.reload();
    } catch (e) {
      toast.error(e, "Couldn't invite them.");
    } finally {
      setInviting(false);
    }
  };

  const change = async (m: TeamMember, patch: { role?: UserRole; status?: "active" | "disabled" }, success: string) => {
    if (patch.status === "disabled") {
      const ok = await dialog.confirm({
        title: `Remove ${m.name ?? m.email}'s access?`,
        body: "They're signed out everywhere immediately and can't sign back in until you restore access.",
        confirmLabel: "Disable access",
        tone: "danger",
      });
      if (!ok) return;
    }
    try {
      await api.updateUser(m.id, patch);
      toast.success(success);
      members.reload();
    } catch (e) {
      toast.error(e, "Couldn't update the team member.");
    }
  };

  const remove = async (m: TeamMember) => {
    const ok = await dialog.confirm({
      title: `Remove ${m.name ?? m.email} from the team?`,
      body: "Their past replies keep their name. To let them back in you'll need to invite them again.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.removeUser(m.id);
      toast.success("Removed from the team");
      members.reload();
    } catch (e) {
      toast.error(e, "Couldn't remove them.");
    }
  };

  return (
    <div className="space-y-5">
      {mode !== "google" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Google sign-in is off, so the console is open to anyone who can reach it. Set <code className="font-mono">RELAY_GOOGLE_CLIENT_ID</code> and{" "}
          <code className="font-mono">RELAY_AUTH_ADMIN_EMAILS</code> in <code className="font-mono">backend/.env</code> to require sign-in; this team list is used
          once it&apos;s on.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Team members" subtitle="People who can sign in to this console with Google.">
          {!members.data ? (
            <LoadingRegion label="Loading team" className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </LoadingRegion>
          ) : members.data.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">No one yet. Invite your first teammate.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {members.data.map((m) => {
                const isMe = m.id === me?.id;
                const label = m.name ?? m.email;
                return (
                  <li key={m.id} className={cx("flex flex-wrap items-center gap-3 py-3", m.status === "disabled" && "opacity-60")}>
                    {m.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.picture} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600" aria-hidden>
                        {label[0]?.toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {label} {isMe && <span className="text-xs font-normal text-slate-500">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {m.name ? `${m.email} · ` : ""}
                        {m.status === "invited" ? "Invited — hasn't signed in yet" : m.status === "disabled" ? "Access disabled" : `Last active ${timeAgo(m.last_login_at)}`}
                      </p>
                    </div>
                    <select
                      value={m.role}
                      disabled={isMe}
                      onChange={(e) => void change(m, { role: e.target.value as UserRole }, `${label} is now ${e.target.value === "admin" ? "an admin" : "an agent"}`)}
                      className="rounded-md border border-slate-200 bg-surface px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
                      aria-label={`UserRole for ${label}`}
                      title={isMe ? "You can't change your own role" : ROLE_HELP[m.role]}
                    >
                      <option value="agent">Agent</option>
                      <option value="admin">Admin</option>
                    </select>
                    {!isMe &&
                      (m.status === "disabled" ? (
                        <button
                          onClick={() => void change(m, { status: "active" }, `${label}'s access restored`)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => void change(m, { status: "disabled" }, `${label}'s access disabled`)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          Disable
                        </button>
                      ))}
                    {!isMe && (
                      <button
                        onClick={() => void remove(m)}
                        className="rounded-md p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                        aria-label={`Remove ${label}`}
                        title="Remove from team"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Invite someone" subtitle="They sign in with the Google account for this email.">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (validEmail) void invite();
            }}
          >
            <Field label="Email">
              <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" autoComplete="off" />
            </Field>
            <fieldset>
              <legend className="text-xs font-medium text-slate-700">UserRole</legend>
              <div className="mt-1 space-y-1.5">
                {(["agent", "admin"] as const).map((r) => (
                  <label key={r} className={cx("flex cursor-pointer items-start gap-2 rounded-lg border p-2.5", role === r ? "border-brand-300 bg-brand-50" : "border-slate-200")}>
                    <input type="radio" name="invite-role" className="mt-0.5 accent-brand-600" checked={role === r} onChange={() => setRole(r)} />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">{r === "admin" ? "Admin" : "Agent"}</span>
                      <span className="block text-xs text-slate-500">{ROLE_HELP[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              type="submit"
              disabled={!validEmail || inviting}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              <UserPlus className="h-4 w-4" aria-hidden /> Send invite
            </button>
            <p className="text-[11px] text-slate-500">No email is sent — share the console link with them. They get in the first time they sign in with Google.</p>
          </form>
        </Card>
      </div>
    </div>
  );
}
