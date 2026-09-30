import {
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  Brain,
  Code2,
  EyeOff,
  FileLock2,
  Fingerprint,
  Gauge,
  Globe,
  Headset,
  Lightbulb,
  LockKeyhole,
  MessageSquareText,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wand2,
  Webhook,
  Zap,
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ChatWidget } from "@/components/ChatWidget";
import { AgentOrbit } from "@/components/fx/AgentOrbit";
import { PipelineSimulator } from "@/components/fx/PipelineSimulator";
import { Tilt } from "@/components/fx/Tilt";
import { ConsoleShowcase } from "@/components/landing/ConsoleShowcase";
import { Faq } from "@/components/landing/Faq";
import { HeroPreview } from "@/components/landing/HeroPreview";
import { InstallSteps } from "@/components/landing/InstallSteps";
import { PricingPlans } from "@/components/landing/PricingPlans";
import { QuestionMarquee } from "@/components/landing/QuestionMarquee";
import { RedactionDemo } from "@/components/landing/RedactionDemo";
import { RoiCalculator } from "@/components/landing/RoiCalculator";
import { Logo } from "@/components/Logo";
import { cx } from "@/lib/format";
import { NAV } from "@/lib/nav";

/** Stagger index for `.reveal`. */
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

const SAFEGUARDS = [
  { icon: EyeOff, title: "Sensitive data masked on arrival", body: "Card numbers, SSNs, security and one-time codes, PINs and passwords never reach storage, logs or a model." },
  { icon: Fingerprint, title: "Verified ownership", body: "Order details are only revealed to the verified owner, after an email check when needed." },
  { icon: ShieldAlert, title: "Injection-proof scope", body: "Prompt-injection and off-topic requests are caught by rules before the model ever sees them." },
  { icon: FileLock2, title: "Export, erase & retain", body: "One-click data export and erasure requests, plus a retention policy that anonymizes old conversations." },
  { icon: ScrollText, title: "Audit trail", body: "Approvals, setting changes and purges are recorded with who did what, and when." },
  { icon: Webhook, title: "Signed webhooks", body: "Every outgoing event is signed, so your systems can verify it came from Relay." },
];

const EXPLORE = [
  { href: "#how", label: "How it works" },
  { href: "#tour", label: "Console tour" },
  { href: "#roi", label: "ROI calculator" },
  { href: "#security", label: "Security" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

function SectionIntro({ eyebrow, title, body, center = false }: { eyebrow: string; title: string; body?: ReactNode; center?: boolean }) {
  return (
    <div className={cx("reveal max-w-2xl", center && "mx-auto text-center")}>
      <p className="text-sm font-semibold text-brand-600">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-slate-600">{body}</p>}
    </div>
  );
}

export default function Home() {
  return (
    <div id="top" className="bg-white">
      {/* Glass nav that slides in once the hero scrolls away; its bottom edge doubles as a reading-progress bar. */}
      <div className="landing-nav fixed inset-x-0 top-0 z-40 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Logo />
          <nav className="flex items-center gap-1 text-sm lg:gap-3">
            {EXPLORE.map(({ href, label }, i) => (
              <a key={href} href={href} className={cx("px-2 text-slate-600 hover:text-slate-900", i < 3 ? "hidden md:block" : "hidden lg:block")}>
                {label}
              </a>
            ))}
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
            <a href="#security" className="hidden px-2 text-slate-300 hover:text-white md:block">
              Security
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
            <HeroPreview />
          </div>
        </div>
      </section>

      {/* Questions marquee */}
      <section aria-labelledby="marquee-title" className="border-b border-slate-200 bg-slate-50 py-10">
        <p id="marquee-title" className="reveal mb-5 px-6 text-center text-sm font-medium text-slate-500">
          Handles the questions your team answers all day — in 13 languages
        </p>
        <QuestionMarquee />
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
        <div className="mb-8">
          <SectionIntro
            eyebrow="See it route"
            title="Every message takes the right path."
            body="Pick a conversation and watch it travel the agent graph — including the moments a rule overrides the model and a human takes over."
          />
        </div>
        <div className="reveal">
          <PipelineSimulator />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <SectionIntro
            eyebrow="Features"
            title="Everything a support team needs on day one."
            body={
              <>
                <LockKeyhole className="mr-1 inline h-4 w-4 text-brand-600" />
                Order details are only shared with the verified owner, and Relay never asks for passwords, card numbers or 2FA codes.
              </>
            }
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }, i) => (
              <div key={title} className="reveal" style={stagger(i % 3)}>
                <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 transition duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-xl hover:shadow-brand-900/5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition-all duration-300 group-hover:scale-110 group-hover:bg-brand-600 group-hover:text-white group-hover:ring-brand-600">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Console tour */}
      <section id="tour" className="mx-auto max-w-6xl px-6 py-24">
        <div className="mb-12">
          <SectionIntro
            eyebrow="For the humans in the loop"
            title="A console your specialists will actually like."
            body="When Relay hands off, the ticket arrives with the history, the policy and a suggested reply. Your team approves, edits and teaches — the AI gets better every week."
          />
        </div>
        <ConsoleShowcase />
      </section>

      {/* ROI */}
      <section id="roi" className="relative overflow-hidden border-y border-slate-200 bg-slate-50">
        <div aria-hidden className="pointer-events-none absolute -left-40 top-10 h-96 w-96 rounded-full bg-brand-200/40 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 py-24">
          <div className="mb-12">
            <SectionIntro
              eyebrow="ROI calculator"
              title="See what automation is worth to you."
              body="Move the sliders to match your team. The same formula powers the savings card in Relay's Analytics, using your real conversations."
            />
          </div>
          <div className="reveal">
            <RoiCalculator />
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="mx-auto max-w-6xl px-6 py-24">
        <div className="mb-12">
          <SectionIntro
            eyebrow="Security & privacy"
            title="Safe by construction, not by prompt."
            body="The riskiest decisions are made by code you can read, not by a model's judgement. Sensitive data is stripped before anything is stored or sent."
          />
        </div>
        <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div className="reveal lg:sticky lg:top-24">
            <RedactionDemo />
          </div>
          <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2">
            {SAFEGUARDS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="reveal" style={stagger(i % 2)}>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                  <Icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Install */}
      <section id="install" className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-12">
            <SectionIntro
              eyebrow="Go live"
              title="Live on your site in an afternoon."
              body="No SDK, no rebuild. Paste one tag, point Relay at your help center, and set the rules it has to follow."
            />
          </div>
          <InstallSteps />
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
        <SectionIntro
          center
          eyebrow="Pricing"
          title="Simple, predictable pricing"
          body="Start free with the offline engine. Upgrade when you connect a model."
        />
        <PricingPlans />
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <div className="reveal">
            <p className="text-sm font-semibold text-brand-600">FAQ</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Questions, answered.</h2>
            <p className="mt-4 text-slate-600">Still curious? Ask Relay itself — the assistant in the corner runs on the same engine.</p>
            <Link href="/demo" className="group mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
              Or explore the full demo <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
          <div className="reveal">
            <Faq />
          </div>
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

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
              Agentic customer support that resolves what it can and hands off the rest — with a full briefing.
            </p>
          </div>
          <nav aria-label="Product">
            <p className="text-sm font-semibold text-slate-900">Product</p>
            <ul className="mt-3 space-y-2 text-sm">
              {NAV.map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} className="text-slate-500 transition-colors hover:text-slate-900">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="On this page">
            <p className="text-sm font-semibold text-slate-900">On this page</p>
            <ul className="mt-3 space-y-2 text-sm">
              {EXPLORE.map(({ href, label }) => (
                <li key={href}>
                  <a href={href} className="text-slate-500 transition-colors hover:text-slate-900">
                    {label}
                  </a>
                </li>
              ))}
              <li>
                <a href="/widget-demo.html" className="text-slate-500 transition-colors hover:text-slate-900">
                  Widget on a sample store
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <div className="border-t border-slate-200">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-slate-500 sm:flex-row">
            <p>© {new Date().getFullYear()} Relay. Demo data for the fictional retailer Aurora Outfitters.</p>
            <a href="#top" className="group inline-flex items-center gap-1.5 hover:text-slate-900">
              Back to top <ArrowUp className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" aria-hidden />
            </a>
          </div>
        </div>
      </footer>

      <ChatWidget />
    </div>
  );
}
