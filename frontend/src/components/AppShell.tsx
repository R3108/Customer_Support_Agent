"use client";

import { BarChart3, BookOpenText, Headset, KeyRound, MessagesSquare, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getAdminKey, setAdminKey } from "@/lib/api";
import { cx } from "@/lib/format";
import { Logo } from "./Logo";

const NAV = [
  { href: "/demo", label: "Live demo", icon: MessagesSquare },
  { href: "/console", label: "Agent console", icon: Headset },
  { href: "/knowledge", label: "Knowledge base", icon: BookOpenText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [health, setHealth] = useState<{ provider: string; model: string | null } | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api
      .health()
      .then((h) => setHealth(h))
      .catch(() => setOffline(true));
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-slate-200 bg-white px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cx(
                "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition",
                pathname.startsWith(href) ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden md:inline">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {offline ? (
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200">API unreachable</span>
          ) : health ? (
            <span
              className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 sm:flex"
              title={health.provider === "offline" ? "No LLM key configured — using the deterministic offline engine" : `Model: ${health.model}`}
            >
              <span className={cx("h-1.5 w-1.5 rounded-full", health.provider === "offline" ? "bg-amber-500" : "bg-emerald-500")} />
              {health.provider === "offline" ? "Offline engine" : `${health.provider} · ${health.model}`}
            </span>
          ) : null}
          <AdminKeyButton />
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}

function AdminKeyButton() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  return (
    <div className="relative">
      <button
        onClick={() => {
          setValue(getAdminKey());
          setOpen((v) => !v);
        }}
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        title="Admin API key"
        aria-label="Admin API key"
      >
        <KeyRound className="h-4 w-4" />
      </button>
      {open && (
        <form
          className="absolute right-0 top-10 z-50 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            setAdminKey(value.trim());
            setOpen(false);
            window.location.reload();
          }}
        >
          <label className="text-xs font-medium text-slate-700">Admin API key</label>
          <p className="mt-0.5 text-[11px] text-slate-500">Required when the backend sets RELAY_ADMIN_API_KEY. Stored in this browser only.</p>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400"
            placeholder="X-Admin-Key"
          />
          <button className="mt-2 w-full rounded-md bg-brand-600 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Save</button>
        </form>
      )}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const err = error as { status?: number; message?: string };
  return (
    <div className="m-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <p className="font-medium">{err.status === 401 ? "Admin key required" : "Couldn't load data"}</p>
      <p className="mt-1 text-rose-700">
        {err.status === 401 ? "This backend is protected. Click the key icon in the top bar and enter your admin API key." : err.message}
      </p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-md bg-white px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100">
          Retry
        </button>
      )}
    </div>
  );
}
