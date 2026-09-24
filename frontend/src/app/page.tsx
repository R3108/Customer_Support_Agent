import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  Check,
  Code2,
  Gauge,
  Globe,
  Headset,
  Lightbulb,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Wand2,
  Webhook,
  Zap,
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ChatWidget } from "@/components/ChatWidget";
import { AgentOrbit } from "@/components/fx/AgentOrbit";
import { PipelineSimulator } from "@/components/fx/PipelineSimulator";
import { Tilt } from "@/components/fx/Tilt";
import { Logo, LogoMark } from "@/components/Logo";

/** Stagger index for `.reveal` / `.route-step`. */
const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

const AGENTS = [
  {
    icon: Brain,
    name: "Intent Classifier",
    body: "Understands what the customer wants, detects sentiment and urgency, extracts order numbers and emails, and rewrites follow-ups into standalone questions.",
  },
  {
    icon: BookOpen,
    name: "Knowledge Retriever",
    body: "Hybrid RAG over your help center plus live order and account data — with ownership checks and email verification before anything is revealed.",
  },
  {
    icon: MessageSquareText,
    name: "Support Agent",
    body: "Drafts grounded, on-brand replies with citations in the customer's language, applies your policies, and scores its own confidence.",
  },
  {
    icon: Zap,
    name: "Action Agent",
    body: "Actually resolves requests: cancels orders and starts returns once the customer confirms, and queues bigger refunds for one-click approval.",
  },
  {
    icon: Headset,
    name: "Escalation Agent",
    body: "Hands off to the right team with priority, SLA, a written briefing and a suggested reply — so customers never repeat themselves.",
  },
];

const FEATURES = [
  { icon: Zap, title: "Resolves, not just answers", body: "In-policy cancellations and returns happen in the chat. Anything above your limits waits for a specialist's Approve." },
  { icon: Globe, title: "Speaks your customers' language", body: "Detects the language of every message and replies in it, while policies and retrieval stay consistent." },
  { icon: Lightbulb, title: "Self-improving knowledge base", body: "Clusters the questions the AI couldn't answer and turns resolved tickets into draft articles, with personal data redacted." },
  { icon: Wand2, title: "Specialist copilot", body: "Rewrite replies friendlier, shorter or more formal, translate them, and insert macros filled with ticket details." },
  { icon: Code2, title: "One-line install", body: "Paste one script tag on any site. Brand name, colours, greeting and prompts are managed from Settings." },
  { icon: Webhook, title: "Webhooks & Slack alerts", body: "Signed events for tickets, approvals, SLA breaches and bad ratings — straight into Slack or your own systems." },
  { icon: Gauge, title: "Confidence scoring", body: "Every reply blends intent, evidence and generation scores. Below your threshold, a human takes over." },
  { icon: ShieldCheck, title: "Hard safety rails", body: "Fraud, chargebacks, injuries, prompt injection and explicit human requests are handled by rules, not model judgement." },
  { icon: BarChart3, title: "ROI you can show", body: "Hours and dollars saved, SLA compliance, automation rate, CSAT and CSV exports for your reporting." },
];

const PLANS = [
  {
    name: "Starter",
    price: "$0",
    period: "forever",
    body: "Deterministic offline engine. Perfect for evaluation.",
    features: ["Offline intent + RAG engine", "Embeddable widget", "Up to 3 knowledge articles", "1 agent seat"],
    cta: "Try the demo",
    href: "/demo",
  },
  {
    name: "Growth",
    price: "$349",
    period: "/ month",
    body: "LLM-powered support for growing brands.",
    features: ["Claude or OpenAI models", "Agentic actions & approvals", "Multilingual replies", "Copilot, macros & knowledge gaps", "Slack + webhooks, 10 seats"],
    cta: "Start 14-day trial",
    href: "/demo",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    body: "Security reviews, SSO and dedicated success.",
    features: ["SSO & audit logs", "Custom actions & escalation policies", "Private deployment", "99.9% uptime SLA"],
    cta: "Talk to sales",
    href: "/console",
  },
];

export default function Home() {
  return (
    <div className="bg-white">
      {/* Glass nav that slides in once the hero scrolls away; its bottom edge doubles as a reading-progress bar. */}
      <div className="landing-nav fixed inset-x-0 top-0 z-40 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Logo />
          <nav className="flex items-center gap-1 text-sm sm:gap-4">
            <a href="#how" className="hidden px-2 text-slate-600 hover:text-slate-900 sm:block">
              How it works
            </a>
            <a href="#pipeline" className="hidden px-2 text-slate-600 hover:text-slate-900 sm:block">
              See it route
            </a>
            <a href="#pricing" className="hidden px-2 text-slate-600 hover:text-slate-900 sm:block">
              Pricing
            </a>
            <Link href="/demo" className="btn-shine rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-500">
              Live demo
            </Link>
          </nav>
        </div>
        <div className="scroll-progress" aria-hidden />
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden bg-ink-950 text-white">
        <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="aurora-a absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-brand-600/30 blur-3xl" />
          <div className="aurora-b absolute -right-40 top-1/3 h-[380px] w-[520px] rounded-full bg-fuchsia-500/15 blur-3xl" />
          <div className="aurora-a absolute -bottom-32 -left-32 h-[340px] w-[480px] rounded-full bg-sky-500/10 blur-3xl [animation-delay:-8s]" />
        </div>
        <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Logo dark />
          <nav className="flex items-center gap-1 text-sm sm:gap-4">
            <a href="#how" className="hidden px-2 text-slate-300 hover:text-white sm:block">
              How it works
            </a>
            <a href="#pricing" className="hidden px-2 text-slate-300 hover:text-white sm:block">
              Pricing
            </a>
            <Link href="/console" className="px-2 text-slate-300 hover:text-white">
              Console
            </Link>
            <Link href="/demo" className="rounded-lg bg-white px-3 py-1.5 font-medium text-slate-900 hover:bg-slate-100">
              Live demo
            </Link>
          </nav>
        </header>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-24 pt-12 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div className="animate-rise">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-brand-200">
              <Sparkles className="h-3.5 w-3.5" /> Agentic support, built on LangGraph
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              AI support that knows{" "}
              <span className="animate-text-sweep bg-gradient-to-r from-brand-300 via-fuchsia-300 to-brand-300 bg-[length:200%_auto] bg-clip-text text-transparent">
                when to hand off.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-300">
              Relay resolves order, return, billing and product questions using your help center and live order data — and routes
              everything else to the right human with a full briefing.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="btn-shine inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-3 font-medium text-white shadow-lg shadow-brand-500/25 hover:bg-brand-400"
              >
                Try the live demo <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/console" className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-5 py-3 font-medium text-white hover:bg-white/5">
                Open agent console
              </Link>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-6">
              {[
                ["5", "specialized agents"],
                ["13", "languages detected"],
                ["1-click", "refund approvals"],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="text-2xl font-semibold tabular-nums">
                    {/^\d+$/.test(v) ? (
                      <>
                        <span className="sr-only">{v}</span>
                        <span aria-hidden className="count-up" style={{ "--to": v } as CSSProperties} />
                      </>
                    ) : (
                      v
                    )}
                  </dt>
                  <dd className="text-xs text-slate-400">{l}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Product preview */}
          <div className="animate-rise [animation-delay:350ms]">
          <Tilt max={10} restX={4} restY={-9} className="relative">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-2 shadow-2xl shadow-black/40 backdrop-blur">
              <div className="overflow-hidden rounded-xl bg-white text-slate-900">
                <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                  <LogoMark className="h-8 w-8" />
                  <div>
                    <div className="text-sm font-semibold">Relay · Aurora Outfitters</div>
                    <div className="text-[11px] text-slate-500">AI assistant · human help anytime</div>
                  </div>
                </div>
                <div className="space-y-3 bg-slate-50 p-4 text-sm">
                  <div className="animate-bubble ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-brand-600 px-3 py-2 text-white [animation-delay:700ms]">
                    I want a refund for the kayak I got last week
                  </div>
                  <div className="animate-bubble max-w-[88%] rounded-2xl rounded-bl-md border border-amber-200 bg-white px-3 py-2 [animation-delay:1300ms]">
                    I checked <b>ORD-10350</b> — it&apos;s within your 90-day window. Because the refund (<b>$1,248.05</b>) is over our self-service limit, a
                    specialist needs to approve it.
                    <div className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                      Ticket <b>TCK-302DCD</b> · Returns · <b>High</b> priority — reply within 4 business hours
                    </div>
                  </div>
                  <div className="animate-bubble flex flex-wrap gap-1.5 text-[11px] [animation-delay:1800ms]">
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 ring-1 ring-emerald-200">90% confidence</span>
                    <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-700">Returns & refunds</span>
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Policy escalation</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="tilt-depth absolute -bottom-16 left-6 hidden rounded-xl border border-white/10 bg-ink-950/90 p-3 text-xs shadow-xl shadow-black/40 sm:block">
              <div className="mb-1.5 text-slate-400">Agent route</div>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-200">
                <span className="route-step rounded bg-white/10 px-1.5 py-0.5" style={stagger(0)}>intent</span>→
                <span className="route-step rounded bg-white/10 px-1.5 py-0.5" style={stagger(1)}>retrieve</span>→
                <span className="route-step rounded bg-white/10 px-1.5 py-0.5" style={stagger(2)}>support</span>→
                <span className="route-step rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200" style={stagger(3)}>escalate</span>
              </div>
            </div>
          </Tilt>
          </div>
        </div>
      </section>

      {/* Agents */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-24">
        <div className="reveal flex items-center justify-between gap-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-brand-600">How it works</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Five agents. One accountable workflow.</h2>
            <p className="mt-4 text-slate-600">
              Each customer message runs through a LangGraph state machine. Every decision — intent, sources, confidence, escalation — is
              traced and visible to your team.
            </p>
          </div>
          <div className="-my-10 hidden shrink-0 lg:block">
            <AgentOrbit items={AGENTS} />
          </div>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {AGENTS.map(({ icon: Icon, name, body }, i) => (
            <div key={name} className="reveal" style={stagger(i)}>
              <Tilt spotlight max={6} className="relative h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="font-mono text-xs text-slate-400">0{i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold text-slate-900">{name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
              </Tilt>
            </div>
          ))}
        </div>

        <div className="reveal mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">Confidence you can audit</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                No single signal — especially not an over-confident model — can push a weak answer through. Relay blends independent
                scores and compares them to your threshold. Clarifying questions are treated as safe; policy triggers bypass scoring entirely.
              </p>
            </div>
            <div className="rounded-xl bg-ink-950 p-5 font-mono text-sm text-slate-200">
              <div className="text-slate-500"># blended per reply</div>
              <div>
                confidence = <span className="text-brand-300">0.20</span>·intent + <span className="text-brand-300">0.35</span>·evidence
              </div>
              <div className="pl-[7.5rem]">
                + <span className="text-brand-300">0.45</span>·generation − sentiment
              </div>
              <div className="mt-3 text-slate-500"># evidence = max(kb_relevance, order_grounding)</div>
              <div>
                if confidence &lt; <span className="text-amber-300">threshold</span>: <span className="text-emerald-300">escalate()</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive pipeline */}
      <section id="pipeline" className="mx-auto max-w-6xl px-6 pb-24">
        <div className="reveal mb-8 max-w-2xl">
          <p className="text-sm font-semibold text-brand-600">See it route</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Every message takes the right path.</h2>
          <p className="mt-4 text-slate-600">
            Pick a conversation and watch it travel the agent graph — including the moments a rule overrides the model and a human takes over.
          </p>
        </div>
        <div className="reveal">
          <PipelineSimulator />
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="reveal max-w-2xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Everything a support team needs on day one.</h2>
          <p className="reveal mt-3 max-w-2xl text-slate-600">
            <LockKeyhole className="mr-1 inline h-4 w-4 text-brand-600" />
            Order details are only shared with the verified owner, and Relay never asks for passwords, card numbers or 2FA codes.
          </p>
          <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }, i) => (
              <div key={title} className="reveal" style={stagger(i % 3)}>
                <Icon className="h-5 w-5 text-brand-600" />
                <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
        <div className="reveal text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Simple, predictable pricing</h2>
          <p className="mt-3 text-slate-600">Start free with the offline engine. Upgrade when you connect a model.</p>
        </div>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {PLANS.map((p, i) => (
            <div
              key={p.name}
              style={stagger(i)}
              className={
                p.featured
                  ? "reveal border-beam relative rounded-2xl bg-ink-950 p-7 text-white shadow-xl shadow-brand-500/20 ring-1 ring-brand-500/40"
                  : "reveal rounded-2xl border border-slate-200 bg-white p-7"
              }
            >
              {p.featured && <span className="absolute -top-3 left-7 rounded-full bg-brand-500 px-2.5 py-0.5 text-xs font-medium">Most popular</span>}
              <h3 className="font-semibold">{p.name}</h3>
              <p className={p.featured ? "mt-1 text-sm text-slate-400" : "mt-1 text-sm text-slate-500"}>{p.body}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">{p.price}</span>
                <span className={p.featured ? "text-sm text-slate-400" : "text-sm text-slate-500"}>{p.period}</span>
              </div>
              <ul className="mt-6 space-y-2.5 text-sm">
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
                    ? "mt-7 block rounded-lg bg-brand-500 py-2.5 text-center text-sm font-medium hover:bg-brand-400"
                    : "mt-7 block rounded-lg border border-slate-200 py-2.5 text-center text-sm font-medium text-slate-900 hover:bg-slate-50"
                }
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="reveal relative overflow-hidden rounded-3xl bg-brand-600 px-8 py-14 text-center text-white">
          <div aria-hidden className="grid-floor" />
          <div aria-hidden className="absolute inset-x-0 top-0 h-2/3 bg-gradient-to-b from-brand-500/60 to-transparent" />
          <h2 className="relative text-3xl font-semibold tracking-tight">See Relay handle a real conversation.</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-brand-100">
            Sign in as a demo customer, ask about an order, request a refund, or ask for a human — and watch every agent decision in the trace.
          </p>
          <Link href="/demo" className="relative mt-7 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 font-medium text-brand-700 hover:bg-brand-50">
            Launch the demo <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row">
          <Logo />
          <p>© {new Date().getFullYear()} Relay. Demo data for the fictional retailer Aurora Outfitters.</p>
        </div>
      </footer>

      <ChatWidget />
    </div>
  );
}
