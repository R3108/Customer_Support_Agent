import type { CSSProperties } from "react";

// Questions the demo knowledge base covers, in a sample of the 13 languages Relay detects.
const ROWS: [string, string][][] = [
  [
    ["EN", "Where is order ORD-10342?"],
    ["ES", "¿Puedo devolver unas botas usadas una vez?"],
    ["EN", "Cancel my order, I picked the wrong size"],
    ["FR", "Quand ma commande sera-t-elle livrée ?"],
    ["EN", "Why was I charged twice?"],
    ["DE", "Wie lange dauert eine Rückerstattung?"],
    ["EN", "Can I change my shipping address?"],
    ["JA", "注文をキャンセルできますか？"],
  ],
  [
    ["EN", "Do you ship to Canada?"],
    ["PT", "Meu pedido chegou danificado"],
    ["EN", "What does the warranty cover?"],
    ["IT", "Come posso cambiare la taglia?"],
    ["HI", "मेरा रिफंड कब आएगा?"],
    ["EN", "Let me talk to a real person"],
    ["NL", "Waar is mijn bestelling?"],
    ["EN", "How do I reset my password?"],
  ],
];

/**
 * Two rows of customer questions drifting in opposite directions. Each row is rendered twice so the
 * loop is seamless; the duplicate is hidden from assistive tech. Hover pauses the motion.
 */
export function QuestionMarquee() {
  return (
    <div className="marquee-mask space-y-3 py-2" role="list" aria-label="Examples of customer questions Relay handles">
      {ROWS.map((row, r) => (
        <div key={r} className="marquee" style={{ "--marquee-duration": `${48 + r * 10}s`, "--marquee-dir": r ? "reverse" : "normal" } as CSSProperties}>
          {[0, 1].map((copy) => (
            <div key={copy} className="marquee-track" aria-hidden={copy === 1 || undefined}>
              {row.map(([lang, q]) => (
                <div
                  key={q}
                  role={copy === 0 ? "listitem" : undefined}
                  className="flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-1.5 pr-4 text-sm text-slate-700 shadow-sm"
                >
                  <span className="rounded-full bg-brand-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-700">{lang}</span>
                  {q}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
