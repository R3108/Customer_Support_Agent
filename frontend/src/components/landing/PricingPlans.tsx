"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { AnimatedValue } from "@/components/fx/AnimatedValue";
import { cx } from "@/lib/format";

type Plan = {
  name: string;
  /** Monthly price in USD; null for custom pricing. */
  monthly: number | null;
  body: string;
  features: string[];
  cta: string;
  href: string;
  featured?: boolean;
};

const PLANS: Plan[] = [
  {
    name: "Starter",
    monthly: 0,
    body: "Deterministic offline engine. Perfect for evaluation.",
    features: ["Offline intent + RAG engine", "Embeddable widget", "Up to 3 knowledge articles", "1 agent seat"],
    cta: "Try the demo",
    href: "/demo",
  },
  {
    name: "Growth",
    monthly: 349,
    body: "LLM-powered support for growing brands.",
    features: ["Claude or OpenAI models", "Agentic actions & approvals", "Multilingual replies", "Copilot, macros & knowledge gaps", "Slack + webhooks, 10 seats"],
    cta: "Start 14-day trial",
    href: "/demo",
    featured: true,
  },
  {
    name: "Enterprise",
    monthly: null,
    body: "Security reviews, SSO and dedicated success.",
    features: ["SSO & audit logs", "Custom actions & escalation policies", "Private deployment", "99.9% uptime SLA"],
    cta: "Talk to sales",
    href: "/console",
  },
];

/** Annual billing: two months free. */
const ANNUAL_FACTOR = 10 / 12;

export function PricingPlans() {
  const [annual, setAnnual] = useState(false);

  return (
    <>
      <div className="mt-8 flex items-center justify-center gap-3">
        <div role="radiogroup" aria-label="Billing period" className="relative grid grid-cols-2 rounded-full bg-slate-100 p-1 text-sm font-medium">
          <span
            aria-hidden
            className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{ transform: annual ? "translateX(100%)" : "none" }}
          />
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={annual === value}
              onClick={() => setAnnual(value)}
              className={cx("relative rounded-full px-5 py-1.5 transition-colors", annual === value ? "text-slate-900" : "text-slate-500 hover:text-slate-700")}
            >
              {value ? "Yearly" : "Monthly"}
            </button>
          ))}
        </div>
        <span className={cx("rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 transition", annual ? "opacity-100" : "opacity-60")}>
          2 months free
        </span>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {PLANS.map((p, i) => {
          const price = p.monthly === null ? "Custom" : `$${Math.round(p.monthly * (annual ? ANNUAL_FACTOR : 1))}`;
          const period = p.monthly === null ? "" : p.monthly === 0 ? "forever" : "/ month";
          return (
            <div
              key={p.name}
              style={{ "--i": i } as CSSProperties}
              className={
                p.featured
                  ? "reveal border-beam relative rounded-2xl bg-ink-950 p-7 text-white shadow-xl shadow-brand-500/20 ring-1 ring-brand-500/40 lg:-my-3 lg:py-10"
                  : "reveal rounded-2xl border border-slate-200 bg-white p-7 transition-shadow hover:shadow-lg"
              }
            >
              {p.featured && <span className="absolute -top-3 left-7 rounded-full bg-brand-500 px-2.5 py-0.5 text-xs font-medium">Most popular</span>}
              <h3 className="font-semibold">{p.name}</h3>
              <p className={p.featured ? "mt-1 text-sm text-slate-400" : "mt-1 text-sm text-slate-500"}>{p.body}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">
                  <AnimatedValue value={price} duration={500} />
                </span>
                <span className={p.featured ? "text-sm text-slate-400" : "text-sm text-slate-500"}>{period}</span>
              </div>
              <p className={cx("mt-1 h-4 text-xs", p.featured ? "text-slate-400" : "text-slate-500")}>
                {annual && p.monthly ? `$${(p.monthly * 10).toLocaleString("en-US")} billed yearly` : ""}
              </p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className={p.featured ? "h-4 w-4 text-brand-300" : "h-4 w-4 text-brand-600"} /> {f}
                  </li>
                ))}
              </ul>
              <Link
                href={p.href}
                className={
                  p.featured
                    ? "btn-shine mt-7 block rounded-lg bg-brand-500 py-2.5 text-center text-sm font-medium hover:bg-brand-400"
                    : "mt-7 block rounded-lg border border-slate-200 py-2.5 text-center text-sm font-medium text-slate-900 hover:bg-slate-50"
                }
              >
                {p.cta}
              </Link>
            </div>
          );
        })}
      </div>
    </>
  );
}
