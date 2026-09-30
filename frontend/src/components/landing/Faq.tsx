import { Plus } from "lucide-react";

const FAQS = [
  {
    q: "Does Relay need an LLM to work?",
    a: "No. The Starter plan runs a deterministic offline engine for intent detection and retrieval, which is ideal for evaluation. Connect Claude or OpenAI when you want generated, multilingual replies.",
  },
  {
    q: "Can the AI refund or cancel orders on its own?",
    a: "Only inside the limits you set. Cancellations and returns run after the customer confirms; refunds above your approval limit wait in the console for a specialist's one-click approval.",
  },
  {
    q: "How does it decide when to hand off to a human?",
    a: "Every reply gets a blended confidence score from intent, evidence and generation. Below your threshold it escalates. Fraud, chargebacks, injuries, prompt injection and explicit requests for a person are handled by rules and always go to a human.",
  },
  {
    q: "What happens to sensitive data customers paste into chat?",
    a: "Card numbers, SSNs, security codes, one-time codes and passwords are masked before a message is stored, logged, shown to specialists or sent to a model provider. Customer data can be exported or erased on request, and a retention policy anonymizes old conversations.",
  },
  {
    q: "Which languages are supported?",
    a: "Relay detects 13 languages, including Spanish, French, German, Japanese, Hindi and Arabic, and replies in the customer's language while your policies and knowledge base stay in English.",
  },
  {
    q: "How do I test changes before customers see them?",
    a: "The Test Lab replays scripted conversations against your current settings and knowledge base, so you can check routing, confidence and escalations before you publish.",
  },
];

/** Exclusive accordion built on native <details>; the open/close height animation is pure CSS (see `.faq`). */
export function Faq() {
  return (
    <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
      {FAQS.map(({ q, a }, i) => (
        <details key={q} name="faq" className="faq group" open={i === 0}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium text-slate-900 transition-colors hover:text-brand-700 [&::-webkit-details-marker]:hidden">
            {q}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-all duration-300 group-open:rotate-45 group-open:bg-brand-600 group-open:text-white">
              <Plus className="h-4 w-4" aria-hidden />
            </span>
          </summary>
          <p className="px-5 pb-5 pr-16 text-sm leading-relaxed text-slate-600">{a}</p>
        </details>
      ))}
    </div>
  );
}
