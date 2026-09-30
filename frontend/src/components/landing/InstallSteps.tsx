"use client";

import { ArrowRight, BookOpenText, Check, Code2, Copy, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { useInView } from "@/hooks/useInView";
import { cx } from "@/lib/format";

const noop = () => () => {};
const useOrigin = () => useSyncExternalStore(noop, () => window.location.origin, () => "https://your-relay-app.com");

const STEPS = [
  {
    icon: Code2,
    title: "Paste one tag",
    body: "Drop the widget on any site. Colours, greeting and prompts are managed from Settings, so you never re-paste it.",
  },
  {
    icon: BookOpenText,
    title: "Add your knowledge",
    body: "Import help-center articles in Markdown. Relay indexes them for hybrid search and cites them in every answer.",
    href: "/knowledge",
    cta: "Open knowledge base",
  },
  {
    icon: SlidersHorizontal,
    title: "Set your rules",
    body: "Choose the refund limit, confidence threshold and escalation teams. Rehearse them in the Test Lab before going live.",
    href: "/settings",
    cta: "Open settings",
  },
];

/** Three-step onboarding with a live, copyable embed snippet that types itself out when scrolled into view. */
export function InstallSteps() {
  const origin = useOrigin();
  const [ref, seen] = useInView({ threshold: 0.5, once: true });
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${origin}/widget.js" async></script>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the snippet stays selectable.
    }
  };

  return (
    <div className="grid items-start gap-10 lg:grid-cols-2">
      <ol className="relative space-y-8">
        <span aria-hidden className="step-line absolute bottom-6 left-5 top-6 w-px bg-gradient-to-b from-brand-500 via-fuchsia-400 to-brand-200" />
        {STEPS.map(({ icon: Icon, title, body, href, cta }, i) => (
          <li key={title} className="reveal relative flex gap-5" style={{ "--i": i } as CSSProperties}>
            <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-brand-600 shadow-md ring-1 ring-slate-200">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="pt-1">
              <p className="font-mono text-xs text-slate-400">Step {i + 1}</p>
              <h3 className="mt-0.5 font-semibold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
              {href && (
                <Link href={href} className="group mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
                  {cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div ref={ref} className="reveal overflow-hidden rounded-2xl bg-ink-950 text-sm shadow-2xl shadow-slate-900/20 ring-1 ring-white/10">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
          <span className="font-mono text-xs text-slate-400">index.html</span>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-slate-400">
          <code>
            <span className="text-slate-500">{"<!-- anywhere before </body> -->"}</span>
            {"\n"}
            <span className={cx("typewriter", seen && "is-typing")} style={{ "--chars": snippet.length } as CSSProperties}>
              <span className="text-fuchsia-300">{"<script"}</span> <span className="text-sky-300">src</span>=
              <span className="text-emerald-300">&quot;{origin}/widget.js&quot;</span> <span className="text-sky-300">async</span>
              <span className="text-fuchsia-300">{"></script>"}</span>
            </span>
            <span aria-hidden className={cx("caret", seen && "is-typing")} />
          </code>
        </pre>
        <div className="border-t border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-400">
          Control it from your own code with <code className="text-slate-200">window.Relay.open()</code> ·{" "}
          <a href="/widget-demo.html" className="text-brand-300 underline-offset-2 hover:underline">
            see it on a sample store
          </a>
        </div>
      </div>
    </div>
  );
}
