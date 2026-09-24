"use client";

import { Check, CornerDownLeft, ExternalLink, Globe, Monitor, Moon, Search, Sun } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type ThemePreference, useTheme } from "@/hooks/useTheme";
import { cx } from "@/lib/format";
import { type NavItem, navTransition } from "@/lib/nav";

type Command = {
  id: string;
  group: "Go to" | "Theme" | "Resources";
  label: string;
  icon: typeof Search;
  keywords?: string;
  /** Keys shown on the right, e.g. ["G", "D"]. */
  hint?: string[];
  active?: boolean;
  run: () => void;
};

type Match = { command: Command; score: number; hits: number[] };

const RECENT_KEY = "relay.palette.recent";
const GROUPS: Command["group"][] = ["Go to", "Theme", "Resources"];

/**
 * Subsequence fuzzy match. Rewards consecutive characters and word starts so "kb" finds "Knowledge base"
 * and "anl" finds "Analytics". Returns the matched character positions for highlighting.
 */
function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, hits: [] };
  const t = text.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let from = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i === -1) return null;
    const prev = hits[hits.length - 1];
    score += 1 + (prev === i - 1 ? 3 : 0) + (i === 0 || t[i - 1] === " " ? 2 : 0);
    hits.push(i);
    from = i + 1;
  }
  return { score: score - t.length * 0.01, hits };
}

function readRecent(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 3)));
  } catch {
    /* storage unavailable: recents are a convenience */
  }
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

const noopSubscribe = () => () => {};

/** Modifier symbol for the shortcut hint; "Ctrl" during SSR so hydration matches, then ⌘ on Apple devices. */
function useModKey() {
  return useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

/**
 * ⌘K / Ctrl+K command palette plus Linear-style `G` then key navigation shortcuts.
 * Renders its own trigger button, so it can be dropped into the header as one element.
 */
export function CommandPalette({ nav }: { nav: NavItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const { preference, setPreference } = useTheme();
  const mod = useModKey();
  const [open, setOpen] = useState(false);
  const [chord, setChord] = useState(false);

  const go = useCallback(
    (href: string) => router.push(href, { transitionTypes: navTransition(pathname, href) }),
    [router, pathname],
  );

  const commands = useMemo<Command[]>(() => {
    const theme = (pref: ThemePreference, label: string, icon: typeof Sun): Command => ({
      id: `theme-${pref}`,
      group: "Theme",
      label,
      icon,
      keywords: "appearance mode colour color",
      active: preference === pref,
      run: () => setPreference(pref),
    });
    return [
      ...nav.map<Command>((item) => ({
        id: `go-${item.href}`,
        group: "Go to",
        label: item.label,
        icon: item.icon,
        hint: ["G", item.key.toUpperCase()],
        active: pathname.startsWith(item.href),
        run: () => go(item.href),
      })),
      theme("light", "Light theme", Sun),
      theme("dark", "Dark theme", Moon),
      theme("system", "Match system theme", Monitor),
      { id: "home", group: "Resources", label: "Marketing site", icon: Globe, keywords: "landing home pricing", run: () => router.push("/") },
      {
        id: "widget",
        group: "Resources",
        label: "Widget install demo",
        icon: ExternalLink,
        keywords: "embed script snippet",
        run: () => window.open("/widget-demo.html", "_blank", "noopener"),
      },
    ];
  }, [nav, pathname, preference, setPreference, go, router]);

  // Global shortcuts: ⌘K / Ctrl+K toggles the palette; G then a nav key jumps straight to that page.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let armed = false;
    const disarm = () => {
      armed = false;
      clearTimeout(timer);
      setChord(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Don't stack on top of a confirm/prompt dialog.
        if (document.querySelector("dialog[open]:not(.palette-dialog)")) return;
        setOpen((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("dialog[open]")) return;
      const key = e.key.toLowerCase();
      if (armed) {
        const item = nav.find((n) => n.key === key);
        disarm();
        if (item) {
          e.preventDefault();
          go(item.href);
        }
      } else if (key === "g") {
        armed = true;
        setChord(true);
        timer = setTimeout(disarm, 1200);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [nav, go]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-500 hover:border-slate-300 hover:text-slate-700"
        aria-label="Open command palette"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden lg:inline">Jump to…</span>
        <kbd className="hidden rounded border border-slate-200 bg-surface px-1 font-sans text-[10px] font-medium text-slate-500 lg:inline">{mod} K</kbd>
      </button>
      {open && <PaletteDialog commands={commands} onClose={() => setOpen(false)} />}
      {chord && (
        <div className="animate-toast pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-lg bg-ink-950/90 px-3 py-2 text-xs text-slate-300 shadow-xl backdrop-blur" role="status">
          <kbd className="mr-1.5 rounded bg-white/15 px-1.5 py-0.5 font-sans font-semibold text-white">G</kbd>
          then {nav.map((n) => n.key.toUpperCase()).join(" · ")}
        </div>
      )}
    </>
  );
}

function PaletteDialog({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent] = useState(readRecent);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Grouped, ranked results. With no query, recently used commands come first.
  const sections = useMemo(() => {
    if (query.trim()) {
      const matches = commands
        .map((command) => {
          const label = fuzzy(query, command.label);
          const extra = label ? null : fuzzy(query, `${command.label} ${command.keywords ?? ""}`);
          const m = label ?? (extra && { score: extra.score - 2, hits: [] });
          return m ? { command, ...m } : null;
        })
        .filter((m): m is Match => m !== null)
        .sort((a, b) => b.score - a.score);
      return matches.length ? [{ title: "Results", items: matches }] : [];
    }
    const byId = new Map(commands.map((c) => [c.id, c]));
    const recents = recent.map((id) => byId.get(id)).filter((c): c is Command => !!c);
    const plain = (c: Command): Match => ({ command: c, score: 0, hits: [] });
    return [
      ...(recents.length ? [{ title: "Recent", items: recents.map(plain) }] : []),
      ...GROUPS.map((g) => ({ title: g, items: commands.filter((c) => c.group === g && !recents.includes(c)).map(plain) })),
    ].filter((s) => s.items.length);
  }, [commands, query, recent]);

  const flat = sections.flatMap((s) => s.items);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (m: Match | undefined) => {
    if (!m) return;
    pushRecent(m.command.id);
    ref.current?.close();
    onClose();
    m.command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move) {
      e.preventDefault();
      setActive((current + move + flat.length) % Math.max(flat.length, 1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : flat.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(flat[current]);
    }
  };

  let index = -1;
  return (
    <dialog
      ref={ref}
      className="app-dialog palette-dialog"
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="w-[36rem] max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-surface text-slate-900 shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-4">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, themes and actions…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-slate-400 focus-visible:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={flat.length ? `palette-opt-${current}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Esc</kbd>
        </div>
        <div ref={listRef} id="palette-list" role="listbox" aria-label="Commands" className="max-h-[min(60vh,24rem)] overflow-y-auto p-2">
          {sections.length === 0 && <p className="px-3 py-8 text-center text-sm text-slate-500">No matches for “{query}”.</p>}
          {sections.map((section) => (
            <div key={section.title} role="group" aria-label={section.title} className="mb-1 last:mb-0">
              <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">{section.title}</div>
              {section.items.map((m) => {
                index += 1;
                const i = index;
                const selected = i === current;
                const { command } = m;
                const Icon = command.icon;
                return (
                  <div
                    key={command.id}
                    id={`palette-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={selected}
                    onPointerMove={() => i !== current && setActive(i)}
                    onClick={() => run(m)}
                    className={cx(
                      "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm",
                      selected ? "bg-brand-50 text-brand-800" : "text-slate-700",
                    )}
                  >
                    <Icon className={cx("h-4 w-4 shrink-0", selected ? "text-brand-600" : "text-slate-400")} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      <Highlight text={command.label} hits={m.hits} />
                    </span>
                    {command.active && <Check className="h-3.5 w-3.5 text-brand-600" aria-label="Current" />}
                    {command.hint && (
                      <span className="flex gap-1" aria-hidden>
                        {command.hint.map((k) => (
                          <kbd key={k} className="min-w-5 rounded border border-slate-200 bg-slate-50 px-1 text-center text-[10px] font-medium text-slate-500">
                            {k}
                          </kbd>
                        ))}
                      </span>
                    )}
                    {selected && <CornerDownLeft className="h-3.5 w-3.5 text-brand-500" aria-hidden />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
          <span>
            <kbd className="font-sans font-semibold">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-sans font-semibold">↵</kbd> open
          </span>
          <span className="ml-auto">
            Tip: press <kbd className="font-sans font-semibold">G</kbd> then a letter from anywhere
          </span>
        </div>
      </div>
    </dialog>
  );
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <mark key={i} className="bg-transparent font-semibold text-brand-700">
            {ch}
          </mark>
        ) : (
          ch
        ),
      )}
    </>
  );
}
