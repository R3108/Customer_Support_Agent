"use client";

import { TriangleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/lib/format";

type ConfirmOptions = {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button red, for deletes and denials. */
  tone?: "default" | "danger";
};

type PromptOptions = ConfirmOptions & {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  required?: boolean;
};

type DialogApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Resolves to the entered text, or null when cancelled. */
  prompt: (options: PromptOptions) => Promise<string | null>;
};

type Pending = { id: number } & (
  | { kind: "confirm"; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (v: string | null) => void }
);

const DialogContext = createContext<DialogApi | null>(null);

let dialogSeq = 0;

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ id: ++dialogSeq, kind: "confirm", options, resolve })),
    [],
  );
  const prompt = useCallback(
    (options: PromptOptions) => new Promise<string | null>((resolve) => setPending({ id: ++dialogSeq, kind: "prompt", options, resolve })),
    [],
  );
  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending && <DialogView key={pending.id} pending={pending} onDone={() => setPending(null)} />}
    </DialogContext.Provider>
  );
}

function DialogView({ pending, onDone }: { pending: Pending; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const settled = useRef(false);
  const { options } = pending;
  const isPrompt = pending.kind === "prompt";
  const promptOptions = options as PromptOptions;
  const [value, setValue] = useState(isPrompt ? (promptOptions.defaultValue ?? "") : "");
  const danger = options.tone === "danger";

  const finish = useCallback(
    (ok: boolean) => {
      if (settled.current) return;
      settled.current = true;
      if (pending.kind === "confirm") pending.resolve(ok);
      else pending.resolve(ok ? value.trim() : null);
      ref.current?.close();
      onDone();
    },
    [pending, value, onDone],
  );

  // showModal() gives us the top layer, a focus trap, inert background and Escape handling for free.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const inputClass =
    "mt-1 w-full rounded-md border border-slate-200 bg-surface px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
  const blocked = isPrompt && promptOptions.required && !value.trim();

  return (
    <dialog
      ref={ref}
      className="app-dialog"
      aria-labelledby="app-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself, outside the panel) cancels.
        if (e.target === ref.current) finish(false);
      }}
    >
      <form
        className="w-[26rem] max-w-full rounded-2xl border border-slate-200 bg-surface p-5 text-slate-900 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) finish(true);
        }}
      >
        <div className="flex items-start gap-3">
          {danger && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <TriangleAlert className="h-4.5 w-4.5" aria-hidden />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="app-dialog-title" className="text-base font-semibold">
              {options.title}
            </h2>
            {options.body && <div className="mt-1 text-sm text-slate-600">{options.body}</div>}
            {isPrompt && (
              <label className="mt-3 block text-xs font-medium text-slate-700">
                {promptOptions.label}
                {promptOptions.multiline ? (
                  <textarea
                    autoFocus
                    rows={3}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={promptOptions.placeholder}
                    className={cx(inputClass, "resize-none")}
                  />
                ) : (
                  <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={promptOptions.placeholder} className={inputClass} />
                )}
              </label>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => finish(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="submit"
            autoFocus={!isPrompt}
            disabled={blocked}
            className={cx(
              "rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40",
              danger ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-600 hover:bg-brand-700",
            )}
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used inside <DialogProvider>");
  return ctx;
}
