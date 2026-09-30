import { Database, Eye, ShieldCheck, Sparkles } from "lucide-react";

/**
 * Looping, CSS-only illustration of the privacy layer: a scan passes over a customer message and the card
 * number is replaced exactly as the backend does it (`privacy.redact`) before anything is stored or sent on.
 */
export function RedactionDemo() {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-ink-950 p-6 text-white shadow-2xl shadow-slate-900/20 ring-1 ring-white/10 sm:p-8">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
      <div aria-hidden className="aurora-a pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl" />

      <p className="relative text-xs font-medium uppercase tracking-wide text-slate-400">Incoming message</p>
      <div className="redact-card relative mt-3 overflow-hidden rounded-2xl rounded-bl-md bg-white/10 px-4 py-3 text-[15px] leading-relaxed text-slate-100">
        <span aria-hidden className="redact-scan" />
        My card is{" "}
        <span className="inline-grid align-baseline">
          <span aria-hidden className="redact-original col-start-1 row-start-1 whitespace-nowrap font-mono text-rose-200">4242 4242 4242 4242</span>
          <span className="redact-masked col-start-1 row-start-1 whitespace-nowrap rounded bg-emerald-400/15 px-1 font-mono text-emerald-200 ring-1 ring-emerald-400/30">
            [card ending 4242]
          </span>
        </span>{" "}
        — why was it charged twice?
      </div>

      <div className="redact-notice relative mt-3 flex gap-2 rounded-xl bg-white/5 p-3 text-xs leading-relaxed text-slate-300 ring-1 ring-white/10">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
        For your security, I&apos;ve hidden the card number you shared — it isn&apos;t stored or seen by anyone.
      </div>

      <ul className="relative mt-6 grid gap-2 text-xs sm:grid-cols-3">
        {[
          { icon: Database, label: "Database & logs" },
          { icon: Sparkles, label: "LLM provider" },
          { icon: Eye, label: "Specialist console" },
        ].map(({ icon: Icon, label }, i) => (
          <li
            key={label}
            className="redact-dest rounded-lg bg-white/5 px-3 py-2 ring-1 ring-white/10"
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            <span className="flex items-center gap-2 whitespace-nowrap text-slate-300">
              <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              {label}
            </span>
            <span className="mt-1 block font-mono text-[10px] text-emerald-300">✓ masked</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
