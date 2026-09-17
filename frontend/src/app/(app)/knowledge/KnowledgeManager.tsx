"use client";

import { Eye, FilePlus2, FileText, Lightbulb, Loader2, Pencil, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorNotice } from "@/components/AppShell";
import { Markdown } from "@/components/Markdown";
import { useAsync } from "@/hooks/useAsync";
import { ApiError, api, takeArticleDraft } from "@/lib/api";
import { cx, humanize, timeAgo } from "@/lib/format";
import type { ArticleDraft, KBDocument, SearchHit } from "@/lib/types";

const NEW_DOC: KBDocument = {
  id: "",
  title: "",
  category: "general",
  body: "# New article\n\n## First section\nWrite one topic per `##` section — each section becomes a retrievable chunk.\n",
};

function draftStatus(draft: ArticleDraft, source: string) {
  return `Draft ${source}${draft.engine === "offline" ? " (offline template — fill in the TODOs)" : ""}. Review, then Create to publish.`;
}

export function KnowledgeManager() {
  const docs = useAsync(() => api.kbDocuments(), "kb-documents");
  // null = default to the first article; "new" = drafting an unsaved article.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = selectedId === "new" ? null : (selectedId ?? docs.data?.[0]?.id ?? null);
  const [doc, setDoc] = useState<KBDocument | null>(null);
  const [preview, setPreview] = useState(false);
  const [sideTab, setSideTab] = useState<"gaps" | "playground">("gaps");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openDraft = (draft: ArticleDraft, source: string) => {
    setSelectedId("new");
    setDoc({ id: "", title: draft.title, category: draft.category, body: draft.body });
    setPreview(true);
    setStatus(draftStatus(draft, source));
  };

  // A draft handed over from the console ("Save as KB article").
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const draft = takeArticleDraft();
      if (!draft) return;
      setSelectedId("new");
      setDoc({ id: "", title: draft.title, category: draft.category, body: draft.body });
      setPreview(true);
      setStatus(draftStatus(draft, "created from a resolved ticket"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    api.kbDocument(activeId).then((d) => {
      if (!cancelled) {
        setDoc(d);
        setStatus(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  if (docs.error) return <ErrorNotice error={docs.error} onRetry={docs.reload} />;

  const save = async () => {
    if (!doc) return;
    setBusy(true);
    setStatus(null);
    try {
      const saved = doc.id ? await api.kbSave(doc.id, doc) : await api.kbCreate(doc);
      setDoc(saved);
      setSelectedId(saved.id);
      setStatus("Saved and re-indexed ✓");
      docs.reload();
    } catch (e) {
      setStatus(e instanceof ApiError ? `Error: ${e.message}` : "Error saving");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!doc?.id || !window.confirm(`Delete "${doc.title}"? The assistant will stop using it immediately.`)) return;
    await api.kbDelete(doc.id);
    setDoc(null);
    setSelectedId(null);
    docs.reload();
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_380px]">
      <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Articles</h2>
            <p className="text-[11px] text-slate-500">
              {docs.data?.length ?? 0} docs · {docs.data?.reduce((n, d) => n + d.chunks, 0) ?? 0} chunks indexed
            </p>
          </div>
          <button
            onClick={() => {
              setSelectedId("new");
              setDoc({ ...NEW_DOC });
              setPreview(false);
              setStatus(null);
            }}
            className="rounded-md p-1.5 text-brand-600 hover:bg-brand-50"
            title="New article"
            aria-label="New article"
          >
            <FilePlus2 className="h-4 w-4" />
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {docs.data?.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => setSelectedId(d.id)}
                className={cx(
                  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition",
                  activeId === d.id ? "bg-brand-50" : "hover:bg-slate-50",
                )}
              >
                <FileText className={cx("mt-0.5 h-4 w-4 shrink-0", activeId === d.id ? "text-brand-600" : "text-slate-400")} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-slate-800">{d.title}</div>
                  <div className="text-[11px] text-slate-500">
                    {d.category} · {d.chunks} sections · {timeAgo(d.updated_at)}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-h-0 flex-col bg-white">
        {doc ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-3">
              <input
                value={doc.title}
                onChange={(e) => setDoc({ ...doc, title: e.target.value })}
                placeholder="Article title"
                className="min-w-0 flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none"
              />
              <input
                value={doc.category}
                onChange={(e) => setDoc({ ...doc, category: e.target.value.toLowerCase() })}
                className="w-28 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-brand-400"
                aria-label="Category"
                title="Category (used to boost retrieval for matching intents)"
              />
              <button
                onClick={() => setPreview((p) => !p)}
                className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {preview ? "Edit" : "Preview"}
              </button>
              {doc.id && (
                <button onClick={remove} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete article">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={save}
                disabled={busy || doc.title.trim().length < 2}
                className="flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" /> {doc.id ? "Save" : "Create"}
              </button>
            </div>
            {status && (
              <div className={cx("px-5 py-1.5 text-xs", status.startsWith("Error") ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>{status}</div>
            )}
            {preview ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <Markdown className="prose-kb">{doc.body}</Markdown>
              </div>
            ) : (
              <textarea
                value={doc.body}
                onChange={(e) => setDoc({ ...doc, body: e.target.value })}
                spellCheck
                className="min-h-0 flex-1 resize-none px-6 py-5 font-mono text-[13px] leading-relaxed text-slate-800 outline-none"
              />
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Select or create an article.</div>
        )}
      </section>

      <aside className="hidden min-h-0 flex-col border-l border-slate-200 bg-slate-50 xl:flex">
        <div className="grid grid-cols-2 gap-1 border-b border-slate-200 bg-white p-2">
          {(
            [
              ["gaps", "Knowledge gaps", Lightbulb],
              ["playground", "Retrieval test", Search],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setSideTab(key)}
              className={cx(
                "flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
                sideTab === key ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        {sideTab === "gaps" ? <KnowledgeGaps onDraft={(d, n) => openDraft(d, `generated from ${n} customer question${n > 1 ? "s" : ""}`)} /> : <RetrievalPlayground />}
      </aside>
    </div>
  );
}

function KnowledgeGaps({ onDraft }: { onDraft: (draft: ArticleDraft, questions: number) => void }) {
  const gaps = useAsync(() => api.knowledgeGaps(30), "knowledge-gaps", 30000);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draft = async (id: string, examples: string[]) => {
    setDrafting(id);
    setError(null);
    try {
      onDraft(await api.draftArticle(examples), examples.length);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't draft an article");
    } finally {
      setDrafting(null);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">What customers asked that we couldn&apos;t answer</h2>
        <p className="text-[11px] text-slate-500">Last 30 days, grouped by topic. Draft an article and the AI answers it next time.</p>
      </div>
      <div className="space-y-2 p-4">
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {gaps.error ? <p className="text-xs text-rose-600">{gaps.error instanceof Error ? gaps.error.message : "Couldn't load gaps"}</p> : null}
        {gaps.data?.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white p-5 text-center">
            <Lightbulb className="mx-auto h-6 w-6 text-slate-300" />
            <p className="mt-2 text-xs font-medium text-slate-700">No gaps detected</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Questions the help center can&apos;t answer will collect here.</p>
          </div>
        )}
        {gaps.data?.map((g) => (
          <div key={g.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-slate-900">“{g.title}”</p>
              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{g.count}×</span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {humanize(g.intent)} · {g.conversations} conversation{g.conversations > 1 ? "s" : ""} · {timeAgo(g.last_seen)}
            </p>
            {g.examples.length > 1 && (
              <ul className="mt-1.5 space-y-0.5 border-l-2 border-slate-100 pl-2">
                {g.examples.slice(1, 4).map((q) => (
                  <li key={q} className="truncate text-[11px] text-slate-600">
                    {q}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => void draft(g.id, g.examples)}
              disabled={drafting !== null}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-md bg-brand-600 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {drafting === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Draft article
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RetrievalPlayground() {
  const [query, setQuery] = useState("How long do refunds take?");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    try {
      setHits(await api.kbSearch(query));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Retrieval playground</h2>
        <p className="text-[11px] text-slate-500">Test what the Knowledge Retriever finds for a customer question.</p>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400"
          />
          <button className="rounded-md bg-slate-900 px-2.5 text-white hover:bg-slate-700" aria-label="Search">
            <Search className="h-4 w-4" />
          </button>
        </form>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {hits?.length === 0 && <p className="text-xs text-slate-500">No passages matched — the assistant would decline or escalate.</p>}
        {hits?.map((h, i) => (
          <div key={h.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-slate-800">
                {i + 1}. {h.section}
              </span>
              <span
                className={cx(
                  "shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]",
                  h.score >= 0.75 ? "bg-emerald-50 text-emerald-700" : h.score >= 0.45 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700",
                )}
              >
                {h.score.toFixed(2)}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">{h.title}</p>
            <p className="mt-1.5 line-clamp-5 text-xs leading-relaxed text-slate-600">{h.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
