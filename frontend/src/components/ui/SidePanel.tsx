"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cx } from "@/lib/format";

/**
 * A right-hand column on extra-wide screens (xl+) that becomes a slide-over drawer below that,
 * so secondary panels stay reachable on laptops and tablets instead of disappearing or squashing the main view.
 */
export function SidePanel({
  open,
  onClose,
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 xl:hidden" onClick={onClose} aria-hidden />}
      <aside
        ref={ref}
        tabIndex={-1}
        aria-label={label}
        className={cx(
          "min-h-0 flex-col border-l border-slate-200 outline-none",
          open ? "fixed inset-y-0 right-0 z-40 flex w-[min(380px,92vw)] shadow-2xl xl:static xl:z-auto xl:w-auto xl:shadow-none" : "hidden xl:flex",
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-surface px-4 py-2.5 xl:hidden">
          <span className="text-sm font-semibold text-slate-900">{label}</span>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={`Close ${label.toLowerCase()}`}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
