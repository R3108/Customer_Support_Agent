"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Dropdown menu following the WAI-ARIA menu button pattern:
 * arrow keys / Home / End move between items, Escape closes and returns focus to the trigger.
 */
export function Menu({
  label,
  icon,
  disabled,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const triggerId = useId();

  const items = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = () => {
    setOpen(false);
    document.getElementById(triggerId)?.focus();
  };

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") focus(index + 1);
    else if (e.key === "ArrowUp") focus(index - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(list.length - 1);
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") return setOpen(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button
        id={triggerId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        disabled={disabled}
        className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        {icon} {label} <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
      {open && (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="absolute bottom-full right-0 z-20 mb-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-surface py-1 shadow-lg"
        >
          {children(() => close())}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ title, detail, onClick }: { title: string; detail?: string; onClick: () => void }) {
  return (
    <button role="menuitem" tabIndex={-1} onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 focus:bg-slate-100 focus:outline-none">
      <span className="block text-xs font-medium text-slate-800">{title}</span>
      {detail && <span className="block truncate text-[11px] text-slate-500">{detail}</span>}
    </button>
  );
}
