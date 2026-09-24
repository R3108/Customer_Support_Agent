"use client";

import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";

type Tone = "success" | "error" | "info";
type ToastItem = { id: number; tone: Tone; message: string };

type ToastApi = {
  success: (message: string) => void;
  info: (message: string) => void;
  /** Accepts a message or any thrown value (ApiError, Error, unknown). */
  error: (error: unknown, fallback?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const ICONS = { success: CheckCircle2, error: TriangleAlert, info: Info };
const TONES = {
  success: "text-emerald-600",
  error: "text-rose-600",
  info: "text-brand-600",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = nextId.current++;
      // Keep the stack short; the newest toast matters most.
      setItems((cur) => [...cur.slice(-3), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      info: (m) => push("info", m),
      error: (e, fallback) => push("error", typeof e === "string" ? e : errorMessage(e, fallback)),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:left-auto sm:right-4 sm:items-end">
        {/* Errors interrupt screen readers; confirmations wait politely. */}
        <div aria-live="polite" className="sr-only">
          {items.filter((t) => t.tone !== "error").map((t) => t.message).join(". ")}
        </div>
        <div role="alert" className="sr-only">
          {items.filter((t) => t.tone === "error").map((t) => t.message).join(". ")}
        </div>
        {items.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div
              key={t.id}
              className="animate-toast pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border border-slate-200 bg-surface px-3.5 py-3 text-sm text-slate-800 shadow-lg"
            >
              <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", TONES[t.tone])} aria-hidden />
              <p className="min-w-0 flex-1 break-words">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="-mr-1 rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
