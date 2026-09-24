"use client";

import { KeyRound, Loader2, LogOut, Monitor, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, ViewTransition } from "react";
import { useLiveStatus } from "@/hooks/useAsync";
import { type ThemePreference, useTheme } from "@/hooks/useTheme";
import { api, errorMessage, getAdminKey, setAdminKey } from "@/lib/api";
import { cx } from "@/lib/format";
import { NAV, navTransition } from "@/lib/nav";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginScreen } from "./auth/LoginScreen";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";
import { DialogProvider } from "./ui/Dialog";
import { ToastProvider } from "./ui/Toast";

/** Directional slide between product pages, keyed by the transition type the nav link attaches. */
const PAGE_SLIDE = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" };

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // data-app scopes dark mode to the product UI; dialogs and toasts render inside it so they theme too.
    <div data-app className="flex h-dvh flex-col bg-slate-50 text-slate-900">
      <AuthProvider>
        <ToastProvider>
          <DialogProvider>
            <Shell>{children}</Shell>
          </DialogProvider>
        </ToastProvider>
      </AuthProvider>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const auth = useAuth();
  const [health, setHealth] = useState<{ provider: string; model: string | null } | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api
      .health()
      .then((h) => setHealth(h))
      .catch(() => setOffline(true));
  }, []);

  const needsLogin = auth.status === "ready" && auth.mode === "google" && !auth.user;
  const nav = NAV.filter((item) => !item.adminOnly || auth.isAdmin);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Skip to content
      </a>
      <header className="vt-anchor-header flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-surface px-3 sm:gap-6 sm:px-6">
        <Logo />
        <nav className={cx("flex min-w-0 items-center gap-1 overflow-x-auto", needsLogin && "invisible")} aria-label="Main">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                transitionTypes={navTransition(pathname, href)}
                aria-current={active ? "page" : undefined}
                title={label}
                className={cx(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition",
                  active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="sr-only md:not-sr-only">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {offline ? (
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200">API unreachable</span>
          ) : health ? (
            <span
              className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 lg:flex"
              title={health.provider === "offline" ? "No LLM key configured — using the deterministic offline engine" : `Model: ${health.model}`}
            >
              <span className={cx("h-1.5 w-1.5 rounded-full", health.provider === "offline" ? "bg-amber-500" : "bg-emerald-500")} />
              {health.provider === "offline" ? "Offline engine" : `${health.provider} · ${health.model}`}
            </span>
          ) : null}
          {!needsLogin && <CommandPalette nav={nav} />}
          {auth.signedIn && <LiveIndicator />}
          <ThemeButton />
          {auth.mode === "api_key" && <AdminKeyButton />}
          {auth.user && <UserMenu />}
        </div>
      </header>
      <main id="main" className="min-h-0 flex-1">
        {auth.status === "loading" ? (
          <div className="flex h-full items-center justify-center" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden />
            <span className="sr-only">Loading…</span>
          </div>
        ) : needsLogin ? (
          <LoginScreen />
        ) : (
          // Keyed on the route so leaving one page and entering the next form an exit/enter pair.
          <ViewTransition key={pathname} enter={PAGE_SLIDE} exit={PAGE_SLIDE} default="none">
            <div className="h-full">{children}</div>
          </ViewTransition>
        )}
      </main>
    </>
  );
}

function LiveIndicator() {
  const status = useLiveStatus();
  if (status === "off") return null;
  const live = status === "live";
  return (
    <span
      className={cx(
        "hidden items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium sm:flex",
        live ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
      )}
      title={live ? "Connected — new tickets and replies appear instantly" : "Reconnecting to live updates…"}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", live ? "animate-pulse bg-emerald-500" : "bg-amber-500")} aria-hidden />
      {live ? "Live" : "Reconnecting"}
    </span>
  );
}

function Avatar({ name, picture, className }: { name: string; picture: string | null; className?: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return picture ? (
    // Google profile photos: no-referrer avoids Google's rate limit on hotlinked avatars.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={picture} alt="" referrerPolicy="no-referrer" className={cx("rounded-full object-cover", className)} />
  ) : (
    <span className={cx("flex items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700", className)} aria-hidden>
      {initials}
    </span>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full p-0.5 hover:ring-2 hover:ring-slate-200"
        aria-label={`Account: ${user.name}`}
        aria-expanded={open}
      >
        <Avatar name={user.name} picture={user.picture} className="h-7 w-7" />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-64 rounded-xl border border-slate-200 bg-surface p-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <Avatar name={user.name} picture={user.picture} className="h-9 w-9" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Role: <span className="font-medium text-slate-700">{user.role === "admin" ? "Admin" : "Agent"}</span>
          </p>
          <button
            onClick={async () => {
              setBusy(true);
              await signOut();
            }}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const THEME_ORDER: ThemePreference[] = ["system", "light", "dark"];
const THEME_META = {
  system: { icon: Monitor, label: "System theme" },
  light: { icon: Sun, label: "Light theme" },
  dark: { icon: Moon, label: "Dark theme" },
};

function ThemeButton() {
  const { preference, setPreference } = useTheme();
  const { icon: Icon, label } = THEME_META[preference];
  const next = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length];
  return (
    <button
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPreference(next, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      title={`${label} — click for ${THEME_META[next].label.toLowerCase()}`}
      aria-label={`${label}. Switch to ${THEME_META[next].label.toLowerCase()}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** Closes a popover on Escape or a click outside `ref`. */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onPointer = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [ref, open, close]);
}

function AdminKeyButton() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setValue(getAdminKey());
          setOpen((v) => !v);
        }}
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        title="Admin API key"
        aria-label="Admin API key"
        aria-expanded={open}
      >
        <KeyRound className="h-4 w-4" />
      </button>
      {open && (
        <form
          className="absolute right-0 top-10 z-50 w-72 rounded-xl border border-slate-200 bg-surface p-3 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            setAdminKey(value.trim());
            setOpen(false);
            window.location.reload();
          }}
        >
          <label className="text-xs font-medium text-slate-700" htmlFor="admin-key">
            Admin API key
          </label>
          <p className="mt-0.5 text-[11px] text-slate-500">Required when the backend sets RELAY_ADMIN_API_KEY. Stored in this browser only.</p>
          <input
            id="admin-key"
            autoFocus
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-2 w-full rounded-md border border-slate-200 bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand-400"
            placeholder="X-Admin-Key"
          />
          <button className="mt-2 w-full rounded-md bg-brand-600 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Save</button>
        </form>
      )}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const err = error as { status?: number };
  const { mode } = useAuth();
  const title = err.status === 401 ? (mode === "api_key" ? "Admin key required" : "Signed out") : err.status === 403 ? "No access" : "Couldn't load data";
  const body =
    err.status === 401 && mode === "api_key"
      ? "This backend is protected. Click the key icon in the top bar and enter your admin API key."
      : err.status === 403
        ? "Your role doesn't include this page. Ask a workspace admin if you need access."
        : errorMessage(error);
  return (
    <div role="alert" className="m-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-rose-700">{body}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-md bg-surface px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100">
          Retry
        </button>
      )}
    </div>
  );
}
