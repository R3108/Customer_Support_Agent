"use client";

import { ArrowLeft, Eye, FilePlus2, FileText, Info, Lightbulb, Loader2, Pencil, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorNotice } from "@/components/AppShell";
import { useAuth } from "@/components/auth/AuthProvider";
import { Markdown } from "@/components/Markdown";
import { useDialog } from "@/components/ui/Dialog";
import { SidePanel } from "@/components/ui/SidePanel";
import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useAsync } from "@/hooks/useAsync";
import { api, errorMessage, takeArticleDraft } from "@/lib/api";
import { cx, humanize, timeAgo } from "@/lib/format";
import type { ArticleDraft, KBDocument, SearchHit } from "@/lib/types";

const NEW_DOC: KBDocument = {
  id: "",
  title: "",
  category: "general",
  body: "# New article\n\n## First section\nWrite one topic per `##` section — each section becomes a retrievable chunk.\n",
};

function draftNote(draft: ArticleDraft, source: string) {
  return `Draft ${source}${draft.engine === "offline" ? " (offline template — fill in the TODOs)" : ""}. Review, then Create to publish.`;
}

const sameDoc = (a: KBDocument | null, b: KBDocument | null) => a?.title === b?.title && a?.category === b?.category && a?.body === b?.body;

export function KnowledgeManager() {
  const docs = useAsync(() => api.kbDocuments(), "kb-documents", undefined, ["kb"]);
  // null = default to the first article; "new" = drafting an unsaved article.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = selectedId === "new" ? null : (selectedId ?? docs.data?.[0]?.id ?? null);
  const [doc, setDoc] = useState<KBDocument | null>(null);
  // Last saved (or freshly loaded) version, to detect unsaved edits.
  const [pristine, setPristine] = useState<KBDocument | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [sideTab, setSideTab] = useState<"gaps" | "playground">("gaps");
  const [showInsights, setShowInsights] = useState(false);
  // On phones the list and the editor are separate screens.
  const [mobileEditor, setMobileEditor] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dialog = useDialog();
  const { isAdmin } = useAuth();
  const dirty = !!doc && !sameDoc(doc, pristine);

  const openDraft = (draft: ArticleDraft, source: string) => {
    setSelectedId("new");
    setDoc({ id: "", title: draft.title, category: draft.category, body: draft.body });
    setPristine(null);
    setPreview(true);
    setMobileEditor(true);
    setShowInsights(false);
    setNote(draftNote(draft, source));
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
      setPristine(null);
      setPreview(true);
      setMobileEditor(true);
      setNote(draftNote(draft, "created from a resolved ticket"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void Promise.resolve().then(() => !cancelled && setDocLoading(true));
    api
      .kbDocument(activeId)
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        setPristine(d);
        setNote(null);
      })
      .catch((e) => !cancelled && toast.error(e, "Couldn't open the article."))
      .finally(() => !cancelled && setDocLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeId, toast]);

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (docs.error) return <ErrorNotice error={docs.error} onRetry={docs.reload} />;

  const confirmDiscard = async () =>
    !dirty ||
    dialog.confirm({
      title: "Discard unsaved changes?",
      body: `Your edits to "${doc?.title || "this article"}" haven't been saved.`,
      confirmLabel: "Discard",
      tone: "danger",
    });

  const select = async (id: string) => {
    if (id === activeId) return setMobileEditor(true);
    if (!(await confirmDiscard())) return;
    setSelectedId(id);
    setMobileEditor(true);
  };

  const startNew = async () => {
    if (!(await confirmDiscard())) return;
    setSelectedId("new");
    setDoc({ ...NEW_DOC });
    setPristine(null);
    setPreview(false);
    setMobileEditor(true);
    setNote(null);
  };

  const save = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const saved = doc.id ? await api.kbSave(doc.id, doc) : await api.kbCreate(doc);
      setDoc(saved);
      setPristine(saved);
      setSelectedId(saved.id);
      setNote(null);
      toast.success(doc.id ? "Saved and re-indexed" : "Article published and indexed");
      docs.reload();
    } catch (e) {
      toast.error(e, "Couldn't save the article.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!doc?.id) return;
    const ok = await dialog.confirm({
      title: `Delete "${doc.title}"?`,
      body: "The assistant stops using this article immediately. This can't be undone.",
      confirmLabel: "Delete article",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.kbDelete(doc.id);
      toast.success("Article deleted");
      setDoc(null);
      setPristine(null);
      setSelectedId(null);
      setMobileEditor(false);
      docs.reload();
    } catch (e) {
      toast.error(e, "Couldn't delete the article.");
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_380px]">
      <aside className={cx("min-h-0 flex-col border-r border-slate-200 bg-surface", mobileEditor ? "hidden md:flex" : "flex")} aria-label="Articles">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Articles</h2>
            <p className="text-[11px] text-slate-500">
              {docs.data ? `${docs.data.length} docs · ${docs.data.reduce((n, d) => n + d.chunks, 0)} chunks indexed` : "Loading…"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowInsights(true)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 xl:hidden"
              title="Knowledge gaps & retrieval test"
              aria-label="Knowledge gaps and retrieval test"
            >
              <Lightbulb className="h-4 w-4" />
            </button>
            <button onClick={() => void startNew()} className="rounded-md p-1.5 text-brand-600 hover:bg-brand-50" title="New article" aria-label="New article">
              <FilePlus2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {!docs.data ? (
          <LoadingRegion label="Loading articles" className="space-y-1 p-2">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex gap-2 px-2.5 py-2">
                <Skeleton className="h-4 w-4 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </LoadingRegion>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            {docs.data.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => void select(d.id)}
                  aria-current={activeId === d.id ? "true" : undefined}
                  className={cx("flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition", activeId === d.id ? "bg-brand-50" : "hover:bg-slate-50")}
                >
                  <FileText className={cx("mt-0.5 h-4 w-4 shrink-0", activeId === d.id ? "text-brand-600" : "text-slate-500")} aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-slate-800">
                      {d.title}
                      {activeId === d.id && dirty && <span className="ml-1 text-amber-600" title="Unsaved changes">•</span>}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {d.category} · {d.chunks} sections · {timeAgo(d.updated_at)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
            {docs.data.length === 0 && <li className="p-6 text-center text-xs text-slate-500">No articles yet. Create one to teach the assistant.</li>}
          </ul>
        )}
      </aside>

      <section className={cx("min-h-0 flex-col bg-surface", mobileEditor ? "flex" : "hidden md:flex")} aria-label="Article editor">
        {doc && !docLoading ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-3 sm:px-5">
              <button onClick={() => setMobileEditor(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Back to articles">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <input
                value={doc.title}
                onChange={(e) => setDoc({ ...doc, title: e.target.value })}
                placeholder="Article title"
                aria-label="Article title"
                className="min-w-0 flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:text-slate-500"
              />
              <input
                value={doc.category}
                onChange={(e) => setDoc({ ...doc, category: e.target.value.toLowerCase() })}
                className="w-28 rounded-md border border-slate-200 bg-surface px-2 py-1 text-xs text-slate-700 outline-none focus:border-brand-400"
                aria-label="Category"
                title="Category (used to boost retrieval for matching intents)"
              />
              <button
                onClick={() => setPreview((p) => !p)}
                aria-pressed={preview}
                className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                {preview ? <Pencil className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />} {preview ? "Edit" : "Preview"}
              </button>
              {doc.id && isAdmin && (
                <button onClick={() => void remove()} className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete article" title="Delete article">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => void save()}
                disabled={busy || doc.title.trim().length < 2 || (!!doc.id && !dirty)}
                className="flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />} {doc.id ? "Save" : "Create"}
              </button>
            </div>
            {note && (
              <div className="flex items-center gap-1.5 bg-brand-50 px-5 py-1.5 text-xs text-brand-700">
                <Info className="h-3.5 w-3.5 shrink-0" aria-hidden /> {note}
              </div>
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
                aria-label="Article body (Markdown)"
                className="min-h-0 flex-1 resize-none bg-surface px-6 py-5 font-mono text-[13px] leading-relaxed text-slate-800 outline-none"
              />
            )}
          </>
        ) : docLoading || (!docs.data && !doc) ? (
          <LoadingRegion label="Loading article" className="space-y-4 p-6">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="mt-6 h-4 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </LoadingRegion>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Select or create an article.</div>
        )}
      </section>

      <SidePanel open={showInsights} onClose={() => setShowInsights(false)} label="Knowledge insights" className="bg-slate-50">
        <div role="tablist" aria-label="Insights view" className="grid grid-cols-2 gap-1 border-b border-slate-200 bg-surface p-2">
          {(
            [
              ["gaps", "Knowledge gaps", Lightbulb],
              ["playground", "Retrieval test", Search],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={sideTab === key}
              onClick={() => setSideTab(key)}
              className={cx(
                "flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
                sideTab === key ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
        {sideTab === "gaps" ? (
          <KnowledgeGaps
            onDraft={async (d, n) => {
              if (await confirmDiscard()) openDraft(d, `generated from ${n} customer question${n > 1 ? "s" : ""}`);
            }}
          />
        ) : (
          <RetrievalPlayground />
        )}
      </SidePanel>
    </div>
  );
}

function KnowledgeGaps({ onDraft }: { onDraft: (draft: ArticleDraft, questions: number) => void | Promise<void> }) {
  const gaps = useAsync(() => api.knowledgeGaps(30), "knowledge-gaps", 30000, ["messages", "kb"]);
  const [drafting, setDrafting] = useState<string | null>(null);
  const toast = useToast();

  const draft = async (id: string, examples: string[]) => {
    setDrafting(id);
    try {
      await onDraft(await api.draftArticle(examples), examples.length);
    } catch (e) {
      toast.error(e, "Couldn't draft an article.");
    } finally {
      setDrafting(null);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-slate-200 bg-surface px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">What customers asked that we couldn&apos;t answer</h2>
        <p className="text-[11px] text-slate-500">Last 30 days, grouped by topic. Draft an article and the AI answers it next time.</p>
      </div>
      <div className="space-y-2 p-4">
        {gaps.error ? <p className="text-xs text-rose-600">{errorMessage(gaps.error, "Couldn't load gaps")}</p> : null}
        {!gaps.data && !gaps.error && (
          <LoadingRegion label="Loading knowledge gaps" className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 rounded-lg border border-slate-200 bg-surface p-3">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-6 w-full" />
              </div>
            ))}
          </LoadingRegion>
        )}
        {gaps.data?.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 bg-surface p-5 text-center">
            <Lightbulb className="mx-auto h-6 w-6 text-slate-300" aria-hidden />
            <p className="mt-2 text-xs font-medium text-slate-700">No gaps detected</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Questions the help center can&apos;t answer will collect here.</p>
          </div>
        )}
        {gaps.data?.map((g) => (
          <div key={g.id} className="rounded-lg border border-slate-200 bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-slate-900">“{g.title}”</p>
              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800" title={`Asked ${g.count} times`}>
                {g.count}×
              </span>
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
              {drafting === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />} Draft article
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
  const [searching, setSearching] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setError(null);
    setSearching(true);
    try {
      setHits(await api.kbSearch(query));
    } catch (e) {
      setError(errorMessage(e, "Search failed"));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-200 bg-surface px-4 py-3">
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
            aria-label="Customer question"
            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-surface px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-brand-400"
          />
          <button disabled={searching} className="rounded-md bg-brand-600 px-2.5 text-white hover:bg-brand-700 disabled:opacity-60" aria-label="Search">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </button>
        </form>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4" aria-live="polite">
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {hits?.length === 0 && <p className="text-xs text-slate-500">No passages matched — the assistant would decline or escalate.</p>}
        {hits?.map((h, i) => (
          <div key={h.id} className="rounded-lg border border-slate-200 bg-surface p-3">
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
