"use client";

import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleX,
  FlaskConical,
  Loader2,
  MessagesSquare,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ErrorNotice } from "@/components/AppShell";
import { useAuth } from "@/components/auth/AuthProvider";
import { Markdown } from "@/components/Markdown";
import { useDialog } from "@/components/ui/Dialog";
import { CardSkeleton, LoadingRegion, Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { cx, humanize, languageName, pct, timeAgo } from "@/lib/format";
import type { EvalCheck, EvalExpectations, EvalOverview, EvalResult, EvalScenario, EvalScenarioInput } from "@/lib/types";

type Catalog = EvalOverview["catalog"];

const SOURCE_LABELS: Record<EvalScenario["source"], string> = { builtin: "Built-in", custom: "Custom", conversation: "From a real chat" };

/** Short, human description of each expectation, e.g. "escalates · Fraud or account compromise". */
function describeExpectations(expect: EvalExpectations, catalog: Catalog): string[] {
  const chips: string[] = [];
  if (expect.intent) chips.push(`intent: ${catalog.intents[expect.intent] ?? humanize(expect.intent)}`);
  if (expect.escalated !== undefined) chips.push(expect.escalated ? "escalates" : "no escalation");
  if (expect.escalation_reason) chips.push(`reason: ${catalog.escalation_reasons[expect.escalation_reason] ?? humanize(expect.escalation_reason)}`);
  if (expect.action_type || expect.action_status) {
    const label = expect.action_type ? (catalog.action_types[expect.action_type] ?? humanize(expect.action_type)) : "any action";
    chips.push(`${label}${expect.action_status ? ` — ${humanize(expect.action_status).toLowerCase()}` : ""}`);
  }
  if (expect.language) chips.push(`replies in ${languageName(expect.language)}`);
  if (expect.knowledge_gap !== undefined) chips.push(expect.knowledge_gap ? "flags a knowledge gap" : "no knowledge gap");
  if (expect.min_confidence !== undefined) chips.push(`confidence ≥ ${pct(expect.min_confidence)}`);
  for (const phrase of expect.reply_contains ?? []) chips.push(`says “${phrase}”`);
  for (const phrase of expect.reply_excludes ?? []) chips.push(`never says “${phrase}”`);
  return chips;
}

function formatValue(check: string, value: unknown, catalog: Catalog): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return check === "reply_contains" || check === "reply_excludes" ? (value ? "present" : "absent") : value ? "yes" : "no";
  if (check === "min_confidence" && typeof value === "number") return pct(value);
  if (check === "intent") return catalog.intents[String(value)] ?? humanize(String(value));
  if (check === "escalation_reason") return catalog.escalation_reasons[String(value)] ?? humanize(String(value));
  if (check === "action_type") return catalog.action_types[String(value)] ?? humanize(String(value));
  if (check === "language") return languageName(String(value));
  return humanize(String(value));
}

export function TestLab() {
  // Runs write progress after every scenario; the live feed pushes those instantly, polling covers API-key mode.
  const { data, error, reload } = useAsync(() => api.evals(), "evals", 5000, ["evals"]);
  const { isAdmin } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [editing, setEditing] = useState<EvalScenario | "new" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const running = data?.running ?? false;
  const latestRun = data?.runs[0];

  // Tell the user when a run they were watching finishes.
  const watching = useRef<string | null>(null);
  useEffect(() => {
    if (!latestRun) return;
    if (latestRun.status === "running") watching.current = latestRun.id;
    else if (watching.current === latestRun.id) {
      watching.current = null;
      if (latestRun.failed) toast.error(`${latestRun.failed} of ${latestRun.total} scenarios failed`);
      else toast.success(`All ${latestRun.total} scenarios passed`);
    }
  }, [latestRun, toast]);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <TestLabSkeleton />;

  const { scenarios, runs, catalog } = data;
  const customerName = (id: string | null) => (id ? (catalog.customers.find((c) => c.id === id)?.name ?? id) : "Guest");
  const completed = runs.filter((r) => r.status !== "running");
  const lastCompleted = completed[0];
  const progress = latestRun?.status === "running" ? latestRun : null;

  const start = async (ids?: string[]) => {
    setStarting(ids?.[0] ?? "all");
    try {
      await api.startEvalRun(ids);
      reload();
    } catch (e) {
      toast.error(e, "Couldn't start the test run.");
    } finally {
      setStarting(null);
    }
  };

  const remove = async (scenario: EvalScenario) => {
    const ok = await dialog.confirm({
      title: "Delete this scenario?",
      body: <>“{scenario.name}” and its results will no longer be part of Test Lab runs.</>,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteScenario(scenario.id);
      toast.success("Scenario deleted");
      reload();
    } catch (e) {
      toast.error(e, "Couldn't delete the scenario.");
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
              <FlaskConical className="h-5 w-5 text-brand-600" aria-hidden /> Test Lab
            </h1>
            <p className="max-w-2xl text-sm text-slate-500">
              Regression tests for your AI agent. Each scenario replays a customer conversation through the live agents in a sandbox — real
              orders, tickets and integrations are never touched — and checks what the AI decided. Run it after changing a policy, an article or
              the model.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing("new")}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" aria-hidden /> New scenario
            </button>
            <button
              onClick={() => void start()}
              disabled={running || starting !== null || !scenarios.length}
              className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {running || starting === "all" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {running ? "Running…" : `Run all ${scenarios.length}`}
            </button>
          </div>
        </div>

        <section className="relative overflow-hidden rounded-2xl bg-ink-950 p-6 text-white ring-1 ring-inset ring-white/10">
          <div className="bg-grid absolute inset-0 opacity-60" />
          <div className="relative grid gap-6 md:grid-cols-[1.1fr_1fr_1.4fr]">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-indigo-200">
                <ShieldCheck className="h-4 w-4" aria-hidden /> {progress ? "Run in progress" : "Latest run"}
              </p>
              {progress ? (
                <>
                  <p className="mt-2 text-4xl font-semibold tracking-tight">
                    {progress.passed + progress.failed}
                    <span className="text-xl text-slate-400"> / {progress.total}</span>
                  </p>
                  <div className="mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${((progress.passed + progress.failed) / progress.total) * 100}%` }} />
                  </div>
                </>
              ) : lastCompleted ? (
                <>
                  <p className="mt-2 text-4xl font-semibold tracking-tight">{pct(lastCompleted.passed / Math.max(lastCompleted.total, 1))}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {lastCompleted.passed} passed · {lastCompleted.failed} failed · {timeAgo(lastCompleted.started_at)} on the {lastCompleted.engine ?? "—"} engine
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-300">No runs yet — press “Run all” to take a baseline.</p>
              )}
            </div>
            <div className="border-white/10 md:border-l md:pl-6">
              <p className="text-xs text-slate-400">Coverage</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{scenarios.length} scenarios</p>
              <p className="mt-1 text-[11px] text-slate-400">
                {scenarios.filter((s) => s.source === "builtin").length} built-in · {scenarios.filter((s) => s.source === "conversation").length} saved from
                real chats · {scenarios.filter((s) => s.source === "custom").length} custom
              </p>
            </div>
            <div className="border-white/10 md:border-l md:pl-6">
              <p className="text-xs text-slate-400">Pass rate over the last {Math.min(completed.length, 12) || "few"} runs</p>
              {completed.length ? (
                <div className="mt-3 flex h-14 items-end gap-1.5" role="img" aria-label="Pass rate history">
                  {completed
                    .slice(0, 12)
                    .reverse()
                    .map((r) => {
                      const rate = r.passed / Math.max(r.total, 1);
                      return (
                        <div
                          key={r.id}
                          title={`${pct(rate)} · ${r.passed}/${r.total} · ${new Date(r.started_at).toLocaleString()}`}
                          className={cx("w-4 rounded-t-sm", rate === 1 ? "bg-emerald-400" : rate >= 0.8 ? "bg-amber-400" : "bg-rose-400")}
                          style={{ height: `${Math.max(rate * 100, 6)}%` }}
                        />
                      );
                    })}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-300">History appears after your first run.</p>
              )}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-surface">
          {scenarios.length === 0 && <p className="p-6 text-sm text-slate-500">No scenarios yet. Create one, or save a conversation from the console as a test.</p>}
          <ul className="divide-y divide-slate-100">
            {scenarios.map((s) => {
              const result = s.last_result;
              const open = expanded === s.id;
              const stale = result && result.ran_at && new Date(s.updated_at) > new Date(result.ran_at);
              return (
                <li key={s.id}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <StatusIcon result={result} running={running} stale={Boolean(stale)} />
                    <button onClick={() => setExpanded(open ? null : s.id)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{s.name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{SOURCE_LABELS[s.source]}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {customerName(s.customer_id)} · “{s.turns[0]}”{s.turns.length > 1 ? ` +${s.turns.length - 1} more` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {describeExpectations(s.expect, catalog).map((chip) => (
                          <span key={chip} className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200">
                            {chip}
                          </span>
                        ))}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {result?.ran_at && <span className="mr-1 hidden text-[11px] text-slate-500 sm:inline">{timeAgo(result.ran_at)}</span>}
                      <IconButton label={`Run “${s.name}”`} disabled={running || starting !== null} onClick={() => void start([s.id])}>
                        {starting === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      </IconButton>
                      {isAdmin && (
                        <>
                          <IconButton label={`Edit “${s.name}”`} onClick={() => setEditing(s)}>
                            <Pencil className="h-4 w-4" />
                          </IconButton>
                          <IconButton label={`Delete “${s.name}”`} onClick={() => void remove(s)}>
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </>
                      )}
                      <IconButton label={open ? "Hide details" : "Show details"} onClick={() => setExpanded(open ? null : s.id)}>
                        <ChevronDown className={cx("h-4 w-4 transition", open && "rotate-180")} />
                      </IconButton>
                    </div>
                  </div>
                  {open && <ResultDetail result={result} catalog={catalog} />}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      {editing && (
        <ScenarioEditor
          scenario={editing === "new" ? null : editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={(saved, runNow) => {
            setEditing(null);
            reload();
            setExpanded(saved.id);
            if (runNow) void start([saved.id]);
          }}
        />
      )}
    </div>
  );
}

function StatusIcon({ result, running, stale }: { result: EvalResult | null | undefined; running: boolean; stale: boolean }) {
  if (!result)
    return running ? (
      <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-slate-400" aria-label="Waiting to run" />
    ) : (
      <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-label="Not run yet" />
    );
  return result.passed ? (
    <CircleCheck className={cx("mt-0.5 h-5 w-5 shrink-0 text-emerald-600", stale && "opacity-50")} aria-label={stale ? "Passed (edited since)" : "Passed"} />
  ) : (
    <CircleX className={cx("mt-0.5 h-5 w-5 shrink-0 text-rose-600", stale && "opacity-50")} aria-label={stale ? "Failed (edited since)" : "Failed"} />
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ResultDetail({ result, catalog }: { result: EvalResult | null | undefined; catalog: Catalog }) {
  if (!result) return <p className="border-t border-slate-100 bg-slate-50 px-12 py-3 text-xs text-slate-500">Run this scenario to see results.</p>;
  return (
    <div className="grid gap-4 border-t border-slate-100 bg-slate-50 px-4 py-4 sm:px-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checks</h3>
        {result.error && <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-800">Scenario crashed: {result.error}</p>}
        <ul className="mt-2 space-y-1.5">
          {result.checks.map((c, i) => (
            <CheckRow key={i} check={c} catalog={catalog} />
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-slate-500">Took {(result.duration_ms / 1000).toFixed(1)}s</p>
      </div>
      <div>
        <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> Transcript
        </h3>
        <ol className="mt-2 space-y-2">
          {result.turns.map((t, i) => (
            <li key={i} className="space-y-1.5">
              <p className="ml-auto w-fit max-w-[85%] rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs text-slate-800">{t.customer}</p>
              <div className="max-w-[92%] rounded-lg border border-slate-200 bg-surface px-2.5 py-1.5">
                <Markdown className="prose-chat text-xs text-slate-700">{t.reply || "_(no reply)_"}</Markdown>
                <p className="mt-1 text-[10px] text-slate-500">
                  {[t.intent && humanize(t.intent), t.confidence !== null && `confidence ${pct(t.confidence)}`, t.route?.map(humanize).join(" → ")]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function CheckRow({ check: c, catalog }: { check: EvalCheck; catalog: Catalog }) {
  const phrase = c.check === "reply_contains" || c.check === "reply_excludes";
  return (
    <li className={cx("flex items-start gap-2 rounded-md px-2 py-1.5 text-xs", c.passed ? "bg-emerald-50" : "bg-rose-50")}>
      {c.passed ? <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Passed" /> : <CircleX className="mt-px h-3.5 w-3.5 shrink-0 text-rose-600" aria-label="Failed" />}
      <span className={c.passed ? "text-emerald-800" : "text-rose-800"}>
        {phrase ? (
          <>
            Reply {c.check === "reply_contains" ? "mentions" : "avoids"} “{String(c.expected)}”
            {!c.passed && <> — it {c.check === "reply_contains" ? "didn't" : "did"}</>}
          </>
        ) : (
          <>
            <b className="font-medium">{humanize(c.check)}</b>: expected {formatValue(c.check, c.expected, catalog)}
            {!c.passed && <>, got {formatValue(c.check, c.actual, catalog)}</>}
          </>
        )}
      </span>
    </li>
  );
}

// ------------------------------------------------------------------ editor
type Tri = "" | "yes" | "no";
const tri = (v: boolean | undefined): Tri => (v === undefined ? "" : v ? "yes" : "no");
const fromTri = (v: Tri) => (v === "" ? undefined : v === "yes");
const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function ScenarioEditor({
  scenario,
  catalog,
  onClose,
  onSaved,
}: {
  scenario: EvalScenario | null;
  catalog: Catalog;
  onClose: () => void;
  onSaved: (s: EvalScenario, runNow: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const e = scenario?.expect ?? {};
  const [name, setName] = useState(scenario?.name ?? "");
  const [customerId, setCustomerId] = useState(scenario?.customer_id ?? "");
  const [turns, setTurns] = useState((scenario?.turns ?? []).join("\n"));
  const [intent, setIntent] = useState(e.intent ?? "");
  const [escalated, setEscalated] = useState<Tri>(tri(e.escalated));
  const [reason, setReason] = useState(e.escalation_reason ?? "");
  const [actionType, setActionType] = useState(e.action_type ?? "");
  const [actionStatus, setActionStatus] = useState(e.action_status ?? "");
  const [language, setLanguage] = useState(e.language ?? "");
  const [gap, setGap] = useState<Tri>(tri(e.knowledge_gap));
  const [minConfidence, setMinConfidence] = useState(e.min_confidence !== undefined ? String(Math.round(e.min_confidence * 100)) : "");
  const [contains, setContains] = useState((e.reply_contains ?? []).join("\n"));
  const [excludes, setExcludes] = useState((e.reply_excludes ?? []).join("\n"));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const build = (): EvalScenarioInput => {
    const expect: EvalExpectations = {};
    if (intent) expect.intent = intent;
    if (fromTri(escalated) !== undefined) expect.escalated = fromTri(escalated);
    if (reason) expect.escalation_reason = reason;
    if (actionType) expect.action_type = actionType;
    if (actionStatus) expect.action_status = actionStatus as EvalExpectations["action_status"];
    if (language.trim()) expect.language = language.trim().toLowerCase();
    if (fromTri(gap) !== undefined) expect.knowledge_gap = fromTri(gap);
    if (minConfidence.trim()) expect.min_confidence = Math.min(100, Math.max(0, Number(minConfidence))) / 100;
    if (lines(contains).length) expect.reply_contains = lines(contains);
    if (lines(excludes).length) expect.reply_excludes = lines(excludes);
    return { name: name.trim(), customer_id: customerId || null, turns: lines(turns), expect };
  };

  const draft = build();
  const invalid = !draft.name ? "Give the scenario a name." : !draft.turns.length ? "Add at least one customer message." : !Object.keys(draft.expect).length ? "Add at least one expectation." : null;

  const save = async (runNow: boolean) => {
    if (invalid) return;
    setSaving(true);
    try {
      const saved = scenario ? await api.updateScenario(scenario.id, draft) : await api.createScenario(draft);
      toast.success(scenario ? "Scenario updated" : "Scenario created");
      onSaved(saved, runNow);
    } catch (err) {
      toast.error(err, "Couldn't save the scenario.");
      setSaving(false);
    }
  };

  const field = "mt-1 w-full rounded-md border border-slate-200 bg-surface px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
  const label = "block text-xs font-medium text-slate-700";

  return (
    <dialog
      ref={ref}
      className="app-dialog"
      aria-labelledby="scenario-editor-title"
      onCancel={(ev) => {
        ev.preventDefault();
        onClose();
      }}
      onClick={(ev) => ev.target === ref.current && onClose()}
    >
      <form
        className="max-h-[90dvh] w-[44rem] max-w-full overflow-y-auto rounded-2xl border border-slate-200 bg-surface p-5 text-slate-900 shadow-2xl"
        onSubmit={(ev) => {
          ev.preventDefault();
          void save(true);
        }}
      >
        <h2 id="scenario-editor-title" className="text-base font-semibold">
          {scenario ? "Edit scenario" : "New scenario"}
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">Script what the customer says, then describe what the AI must do with it. Leave a check blank to skip it.</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_14rem]">
          <label className={label}>
            Name
            <input autoFocus value={name} onChange={(ev) => setName(ev.target.value)} placeholder="e.g. Late delivery is traced, not refunded" className={field} />
          </label>
          <label className={label}>
            Customer
            <select value={customerId} onChange={(ev) => setCustomerId(ev.target.value)} className={field}>
              <option value="">Guest (not signed in)</option>
              {catalog.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.tier}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={cx(label, "mt-3")}>
          Customer messages <span className="font-normal text-slate-500">— one per line, sent in order</span>
          <textarea value={turns} onChange={(ev) => setTurns(ev.target.value)} rows={3} placeholder={"Please cancel my order\nyes"} className={cx(field, "resize-y font-mono text-xs")} />
        </label>

        <fieldset className="mt-4 rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-700">The final reply must…</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={label}>
              Intent
              <select value={intent} onChange={(ev) => setIntent(ev.target.value)} className={field}>
                <option value="">Any</option>
                {Object.entries(catalog.intents).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Escalate to a human
              <select value={escalated} onChange={(ev) => setEscalated(ev.target.value as Tri)} className={field}>
                <option value="">Don&apos;t check</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className={label}>
              Escalation reason
              <select value={reason} onChange={(ev) => setReason(ev.target.value)} className={field}>
                <option value="">Any</option>
                {Object.entries(catalog.escalation_reasons).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Action
              <select value={actionType} onChange={(ev) => setActionType(ev.target.value)} className={field}>
                <option value="">Don&apos;t check</option>
                {Object.entries(catalog.action_types).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Action status
              <select value={actionStatus} onChange={(ev) => setActionStatus(ev.target.value)} className={field}>
                <option value="">Don&apos;t check</option>
                <option value="proposed">Offered to the customer</option>
                <option value="executed">Executed</option>
                <option value="pending_approval">Waiting for approval</option>
                <option value="failed">Refused by policy</option>
              </select>
            </label>
            <label className={label}>
              Knowledge gap
              <select value={gap} onChange={(ev) => setGap(ev.target.value as Tri)} className={field}>
                <option value="">Don&apos;t check</option>
                <option value="yes">Flagged</option>
                <option value="no">Not flagged</option>
              </select>
            </label>
            <label className={label}>
              Language (ISO code)
              <input value={language} onChange={(ev) => setLanguage(ev.target.value)} maxLength={5} placeholder="e.g. es" className={field} />
            </label>
            <label className={label}>
              Minimum confidence (%)
              <input type="number" min={0} max={100} value={minConfidence} onChange={(ev) => setMinConfidence(ev.target.value)} placeholder="e.g. 60" className={field} />
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Reply must mention <span className="font-normal text-slate-500">— one per line</span>
              <textarea value={contains} onChange={(ev) => setContains(ev.target.value)} rows={2} placeholder="ORD-10460" className={cx(field, "resize-y")} />
            </label>
            <label className={label}>
              Reply must never mention <span className="font-normal text-slate-500">— one per line</span>
              <textarea value={excludes} onChange={(ev) => setExcludes(ev.target.value)} rows={2} placeholder="guaranteed" className={cx(field, "resize-y")} />
            </label>
          </div>
        </fieldset>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {invalid && <p className="mr-auto text-xs text-slate-500">{invalid}</p>}
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={Boolean(invalid) || saving}
            onClick={() => void save(false)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Save
          </button>
          <button type="submit" disabled={Boolean(invalid) || saving} className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Save &amp; run
          </button>
        </div>
      </form>
    </dialog>
  );
}

function TestLabSkeleton() {
  return (
    <LoadingRegion label="Loading Test Lab" className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>
      <Skeleton className="h-36 rounded-2xl" />
      <CardSkeleton lines={8} />
    </LoadingRegion>
  );
}
