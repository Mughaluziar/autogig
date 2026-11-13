import Link from "next/link";
import {
  ArrowRight, BadgeCheck, Bell, Bitcoin, Bot, Briefcase, Building2, CheckCircle2, ChevronDown, Clock, CreditCard, Gauge,
  Hourglass, Landmark, Layers, Link2, LineChart, PenLine, PieChart, Plug, Radar, Rocket, ScanSearch, Send, ShieldCheck,
  Sparkles, Target, Timer, TrendingUp, Wallet, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_MATRIX } from "@/lib/platforms";
import { COVER, EARLY_PAY, FUNDING, LANDING_PLANS } from "@/lib/landing";
import { Reveal } from "@/components/marketing/landing/motion";
import { PersonaProvider } from "@/components/marketing/landing/persona";
import { Hero, FinalPitch } from "@/components/marketing/landing/hero";
import { OfferGrid } from "@/components/marketing/landing/offer-grid";
import { TimeCalculator } from "@/components/marketing/landing/time-calculator";
import { InsuranceCalculator } from "@/components/marketing/landing/insurance-calculator";
import { EarlyPayCalculator } from "@/components/marketing/landing/early-pay-calculator";
import { CardsSection } from "@/components/marketing/landing/cards-section";
import { FinancingForm, InvestorForm } from "@/components/marketing/landing/capital-forms";
import { InvestModes } from "@/components/marketing/landing/invest-modes";
import { StickyCta } from "@/components/marketing/landing/sticky-cta";
import { ScrollCapture } from "@/components/marketing/landing/scroll-capture";

const PLATFORM_COUNT = PLATFORM_MATRIX.length;
const JOB_SOURCES = PLATFORM_MATRIX.filter((p) => ["board", "network", "search", "company"].includes(p.category)).length;
const GIG_SOURCES = PLATFORM_MATRIX.filter((p) => ["marketplace", "creative"].includes(p.category)).length;
const MARQUEE = PLATFORM_MATRIX.filter((p) => ["marketplace", "network", "creative", "board"].includes(p.category)).slice(0, 32).map((p) => p.name);
const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const painFix = [
  { pain: "Ten tabs, ten inboxes", fix: "One ranked feed for every platform", icon: Layers },
  { pain: "Proposals eat your evenings", fix: "AI drafts them, you approve", icon: Hourglass },
  { pain: "Cancelled orders, lost income", fix: "Insure new orders for up to 80%", icon: ShieldCheck },
  { pain: "Paid in weeks, not days", fix: "Card, crypto and early pay", icon: Clock },
];

const faqs = [
  { q: "Will connecting my accounts get me banned?", a: "Autopilot uses each platform's official API where one exists, notification emails where it doesn't, and AI drafts you send yourself everywhere else. No bots, no scraping behind your login, and nothing is sent without your approval." },
  { q: "How does auto-finding jobs and gigs work?", a: `Job Radar and Gigs scan the sources you choose (${PLATFORM_COUNT} marketplaces, talent networks and job boards are supported) and score every listing against your skills, rate and history. New matches show up in your feed and in alerts, with a proposal draft ready when you want one.` },
  { q: "How do my clients pay me?", a: "Create an invoice, split it into milestones if you like, and share one secure pay link. Clients pay by debit card, credit card or crypto (USDC) without creating an account. Paid milestones show up in your Money dashboard automatically." },
  { q: "Is freelancer insurance real insurance?", a: `It's order protection backed by the Autopilot protection fund, not a policy from a licensed insurer. You can add cover to a new order in its first ${COVER.windowHours} hours, for up to ${Math.round(COVER.maxPct * 100)}% of its value (up to ${usd0(COVER.maxCover)}), for a one-time ${Math.round(COVER.premiumPct * 100)}% premium. If the platform cancels or refunds the order, you're paid the covered amount. Settlement is simulated during beta.` },
  { q: "When do Autopilot Cards launch?", a: "The countdown on this page runs to the planned launch date. Waitlist members get access first, plus founding-member perks. Cards will be issued by a partner bank, subject to approval." },
  { q: "Does joining a waitlist affect my credit?", a: "No. Waitlists only record your interest: there's no credit check and no application. Cards and financing will be offered through licensed partners, subject to approval." },
  { q: "Who can invest in the marketplace?", a: "Accredited or professional investors in eligible countries, after identity verification. You can back individual freelancers and agencies or the diversified Platform Index. Investing involves risk, including loss of principal, and settlement is simulated during beta." },
  { q: "How does the free trial work?", a: "Basic is free forever with 10 bids and 2 profiles, no card needed. Plus and Pro start with a 3-day free trial at checkout, extended to 7 days when you share Autopilot. Cancel any time during the trial." },
  { q: "Do I need crypto to use Autopilot?", a: "No. Crypto is optional. Clients can pay by card, and you can keep everything in US dollars." },
];

export default function HomePage() {
  return (
    <PersonaProvider>
      <div className="flex flex-col overflow-x-clip">
        {/* Hide reveal-on-scroll content only when JS will reveal it. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js-motion')" }} />

        {/* ---------------- Hero (rewritten per persona) ---------------- */}
        <section id="hero" className="relative overflow-hidden hero-grid">
          <div className="aurora absolute inset-0 -z-0" />
          <Hero platformCount={PLATFORM_COUNT} />
        </section>

        {/* ---------------- Trust strip ---------------- */}
        <section className="border-y bg-muted/30 py-8" aria-label="Supported platforms">
          <p className="mb-5 px-4 text-center text-sm font-medium text-muted-foreground">
            Works with the {PLATFORM_COUNT} platforms freelancers actually use
          </p>
          <div className="marquee-mask overflow-hidden">
            <div className="flex w-max animate-marquee gap-3 hover:[animation-play-state:paused]">
              {[...MARQUEE, ...MARQUEE].map((name, i) => (
                <span key={`${name}-${i}`} aria-hidden={i >= MARQUEE.length} className="whitespace-nowrap rounded-full border bg-card px-4 py-2 text-sm font-semibold text-foreground/80 shadow-sm">
                  {name}
                </span>
              ))}
            </div>
          </div>
          <div className="container mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-medium text-muted-foreground">
            {[
              { i: BadgeCheck, t: "Official APIs where they exist" },
              { i: ShieldCheck, t: "Nothing sent without your approval" },
              { i: Wallet, t: "Card, bank and crypto payouts" },
            ].map((x) => <span key={x.t} className="inline-flex items-center gap-1.5"><x.i className="size-4 text-primary" />{x.t}</span>)}
          </div>
          <p className="mt-3 px-4 text-center text-[11px] text-muted-foreground">
            Connection method varies: official API, email or guided setup. Platform names are trademarks of their owners; no endorsement implied.
          </p>
        </section>

        {/* ---------------- Pain → fix ---------------- */}
        <section className="py-16">
          <div className="container">
            <h2 className="mx-auto max-w-3xl text-center text-3xl font-black tracking-tight md:text-5xl">
              Freelancing shouldn&apos;t feel like <span className="gradient-text">five part-time jobs.</span>
            </h2>
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {painFix.map((p, i) => (
                <Reveal key={p.pain} delay={i * 70}>
                  <div className="h-full rounded-2xl border bg-card p-5">
                    <p className="text-sm text-muted-foreground line-through decoration-destructive/60">{p.pain}</p>
                    <p className="mt-2 flex items-start gap-2 font-semibold"><p.icon className="mt-0.5 size-5 shrink-0 text-primary" />{p.fix}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- Everything you get ---------------- */}
        <section id="offer" className="scroll-mt-20 border-t bg-muted/30 py-20">
          <div className="container">
            <SectionHeading eyebrow="Everything in one login" title="Find work. Get paid. Get protected. Get funded."
              subtitle="Thirteen tools that used to be thirteen subscriptions. The ones that fit you are marked." />
            <OfferGrid />
          </div>
        </section>

        {/* ---------------- AUTO-FIND (big and bold) ---------------- */}
        <section id="auto-find" className="relative scroll-mt-20 overflow-hidden py-20 md:py-28">
          <div className="aurora absolute inset-0" />
          <div className="container relative">
            <div className="mx-auto max-w-4xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-success">
                <span className="size-1.5 animate-pulse rounded-full bg-success" /> Auto-find · Live
              </span>
              <h2 className="mt-5 text-[2.5rem] font-black leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
                Jobs and gigs, found for you. <span className="gradient-text">Automatically.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground md:text-xl">
                Two radars run around the clock, one for jobs and one for gigs, so you never scroll a job board again.
                Every match is scored for you, with a proposal ready when you are.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Reveal className="h-full">
                <div className="relative h-full overflow-hidden rounded-3xl border bg-card p-6 md:p-8">
                  <div className="absolute -right-16 -top-16 size-56 rounded-full bg-cyan-400/15 blur-3xl" />
                  <div className="relative">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-primary text-white shadow-lg"><Radar className="size-7" /></span>
                    <p className="mt-5 text-xs font-bold uppercase tracking-wider text-cyan-500">Job Radar</p>
                    <h3 className="mt-1 text-2xl font-black md:text-3xl">Roles that fit you, before everyone else sees them.</h3>
                    <ul className="mt-5 space-y-3">
                      {[
                        `Full-time, contract and part-time roles from ${JOB_SOURCES} job boards, talent networks and career pages`,
                        "A match score on every role: skills, rate and seniority",
                        "Saved searches with alerts, so new roles come to you",
                        "Every application tracked from applied to offer",
                      ].map((b) => <li key={b} className="flex gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-cyan-500" /><span>{b}</span></li>)}
                    </ul>
                  </div>
                </div>
              </Reveal>
              <Reveal delay={120} className="h-full">
                <div className="relative h-full overflow-hidden rounded-3xl border bg-card p-6 md:p-8">
                  <div className="absolute -right-16 -top-16 size-56 rounded-full bg-fuchsia-400/15 blur-3xl" />
                  <div className="relative">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-primary text-white shadow-lg"><Briefcase className="size-7" /></span>
                    <p className="mt-5 text-xs font-bold uppercase tracking-wider text-fuchsia-500">Gigs</p>
                    <h3 className="mt-1 text-2xl font-black md:text-3xl">Projects you can win, with the pitch already written.</h3>
                    <ul className="mt-5 space-y-3">
                      {[
                        `Projects and buyer requests from ${GIG_SOURCES} marketplaces, including Upwork, Fiverr and Freelancer.com`,
                        "A tailored proposal for each one, in your voice",
                        "A bid pipeline, so no lead goes cold",
                        "AI Gig Builder writes your own listings with 3-tier pricing",
                      ].map((b) => <li key={b} className="flex gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-fuchsia-500" /><span>{b}</span></li>)}
                    </ul>
                  </div>
                </div>
              </Reveal>
            </div>

            {/* Scan → Match → Send */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { i: ScanSearch, t: "Scan", d: "Your sources, around the clock" },
                { i: Target, t: "Match", d: "Ranked by how well each fits you" },
                { i: Send, t: "Send", d: "Review the draft, then send it yourself" },
              ].map((s, idx) => (
                <div key={s.t} className="flex items-center gap-4 rounded-2xl border bg-card/80 p-4 backdrop-blur">
                  <span className="text-4xl font-black text-primary/30">{idx + 1}</span>
                  <div>
                    <p className="flex items-center gap-2 text-lg font-black"><s.i className="size-5 text-primary" />{s.t}</p>
                    <p className="text-sm text-muted-foreground">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-1 items-stretch gap-5 lg:grid-cols-2">
              <Reveal className="h-full"><TimeCalculator /></Reveal>
              <Reveal delay={120} className="h-full">
                <div className="panel flex h-full flex-col p-6">
                  <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-purple-500 text-white"><Bot className="size-4" /></span>
                    <div>
                      <p className="font-semibold">Or put it on full autopilot</p>
                      <p className="text-xs text-muted-foreground">The agent fleet, for busy freelancers and agencies</p>
                    </div>
                  </div>
                  <ul className="mt-5 grid gap-2.5">
                    {[
                      { i: ScanSearch, t: "Scout", d: "Scans your sources and saves the best matches" },
                      { i: PenLine, t: "Writer", d: "Drafts proposals and gig copy in your voice" },
                      { i: Send, t: "Applier", d: "Prepares applications and tracks every one" },
                      { i: Bell, t: "Closer", d: "Flags replies and drafts your answers" },
                    ].map((a) => (
                      <li key={a.t} className="flex items-center gap-3 rounded-xl border bg-background/60 px-3 py-2.5">
                        <a.i className="size-4 shrink-0 text-primary" />
                        <p className="min-w-0 text-sm"><span className="font-semibold">{a.t}</span> <span className="text-muted-foreground">· {a.d}</span></p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-sm text-muted-foreground">
                    Agents work inside rules you set: daily caps, quiet hours, and approval before anything is sent. One kill switch stops them all.
                  </p>
                  <Button variant="outline" className="mt-auto w-full" asChild>
                    <Link href="/signup" data-cta="auto-find-fleet">Meet the agent fleet <ArrowRight className="size-4" /></Link>
                  </Button>
                </div>
              </Reveal>
            </div>

            <div className="mt-10 text-center">
              <Button size="xl" variant="gradient" className="h-auto min-h-14 whitespace-normal px-8 py-3 text-lg font-bold" asChild>
                <Link href="/signup" data-cta="auto-find-start">Turn on auto-find, free <ArrowRight className="size-5" /></Link>
              </Button>
              <p className="mt-3 text-sm text-muted-foreground">Your first scan runs within two minutes of signing up.</p>
            </div>
          </div>
        </section>

        {/* ---------------- INSURANCE (big and bold) ---------------- */}
        <section id="insurance" className="relative scroll-mt-20 overflow-hidden bg-gradient-to-br from-zinc-950 via-purple-950 to-zinc-900 py-20 text-white md:py-28">
          <div className="absolute -left-24 top-10 size-96 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="absolute -right-24 bottom-0 size-96 rounded-full bg-primary/30 blur-3xl" />
          <div className="container relative grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Reveal>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-300">
                <ShieldCheck className="size-3.5" /> Freelancer insurance · Beta
              </span>
              <h2 className="mt-5 text-[2.5rem] font-black leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
                Order cancelled? <span className="bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">You still get paid.</span>
              </h2>
              <p className="mt-5 max-w-xl text-lg text-white/80 md:text-xl">
                Insure every new order in its first {COVER.windowHours} hours. If the marketplace cancels or refunds it, you&apos;re paid up to {Math.round(COVER.maxPct * 100)}% of its value.
              </p>
              <div className="mt-8 grid grid-cols-3 gap-3">
                {[
                  { v: `${Math.round(COVER.maxPct * 100)}%`, l: "of the order covered" },
                  { v: `${COVER.windowHours}h`, l: "window to add cover" },
                  { v: `${Math.round(COVER.premiumPct * 100)}%`, l: "one-time premium" },
                ].map((s) => (
                  <div key={s.l} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-3xl font-black md:text-5xl">{s.v}</p>
                    <p className="mt-1 text-xs text-white/70 md:text-sm">{s.l}</p>
                  </div>
                ))}
              </div>
              <ol className="mt-8 space-y-3">
                {[
                  { i: Timer, t: "A new order arrives and a cover offer pops up with a 24-hour countdown." },
                  { i: ShieldCheck, t: "Add cover in one tap. The premium is a one-time fee." },
                  { i: Wallet, t: "If the platform's own data shows a cancellation or refund, the payout is yours." },
                ].map((s) => (
                  <li key={s.t} className="flex gap-3 text-white/85"><s.i className="mt-0.5 size-5 shrink-0 text-emerald-300" />{s.t}</li>
                ))}
              </ol>
            </Reveal>
            <Reveal delay={120}>
              <InsuranceCalculator />
              <p className="mt-4 text-[11px] leading-relaxed text-white/60">
                Order protection is backed by the Autopilot protection fund, not a licensed insurer. Cover is up to {usd0(COVER.maxCover)} per order, for
                fixed-price orders confirmed through the Upwork or Freelancer.com API. Claims follow the platform&apos;s own cancellation or refund data.
                Settlement is simulated during beta.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------- Cards + 90-day countdown ---------------- */}
        <section id="cards" className="relative scroll-mt-20 overflow-hidden border-b bg-muted/30 py-20">
          <div className="aurora absolute inset-0" />
          <div className="container relative">
            <div className="mx-auto mb-10 max-w-3xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-fuchsia-500">
                <CreditCard className="size-3.5" /> Autopilot Debit &amp; Credit · Launch countdown
              </span>
              <h2 className="mt-5 text-4xl font-black tracking-tight md:text-6xl">
                Cards built for people <span className="gradient-text">paid by the gig.</span>
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Spend what you earn the moment it lands, and get credit that understands freelance income. Reserve yours before launch to lock in founding-member perks.
              </p>
            </div>
            <CardsSection />
          </div>
        </section>

        {/* ---------------- Get paid ---------------- */}
        <section id="get-paid" className="scroll-mt-20 py-20">
          <div className="container">
            <SectionHeading eyebrow="Get paid" title="Invoices and milestones, paid in-app by debit, credit or crypto."
              subtitle="Create an invoice in under a minute, split it into milestones, and share one secure link. Clients pay the way they like; you see it land." />
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
              <Reveal>
                <div className="panel p-5 md:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-muted-foreground">Invoice INV-0042 · Brightline Studio</p>
                      <p className="text-2xl font-bold">$5,000.00</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">2 of 3 paid</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-muted"><div className="h-full w-4/5 rounded-full bg-gradient-to-r from-primary via-fuchsia-400 to-cyan-400" /></div>
                  <ul className="mt-5 space-y-2.5">
                    {[
                      { t: "Discovery & wireframes", a: "$1,500", s: "Paid · Debit card", tone: "text-success", icon: CreditCard },
                      { t: "Build & integration", a: "$2,500", s: "Paid · 2,500 USDC", tone: "text-success", icon: Bitcoin },
                      { t: "Launch & handover", a: "$1,000", s: "Due Dec 12", tone: "text-warning", icon: Clock },
                    ].map((m) => (
                      <li key={m.t} className="flex items-center gap-3 rounded-xl border bg-background/60 px-3 py-2.5">
                        <m.icon className={`size-4 shrink-0 ${m.tone}`} />
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{m.t}</p><p className={`text-xs ${m.tone}`}>{m.s}</p></div>
                        <p className="text-sm font-semibold">{m.a}</p>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
                    <span className="text-xs text-muted-foreground">Client pays by</span>
                    {[{ l: "Debit card", i: CreditCard }, { l: "Credit card", i: CreditCard }, { l: "Crypto (USDC)", i: Bitcoin }].map((m) => (
                      <span key={m.l} className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs font-medium"><m.i className="size-3.5 text-primary" />{m.l}</span>
                    ))}
                  </div>
                  <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary"><Link2 className="size-3.5" />One pay link, no client login</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">Illustrative invoice.</p>
                </div>
              </Reveal>
              <Reveal delay={120}><EarlyPayCalculator /></Reveal>
            </div>
          </div>
        </section>

        {/* ---------------- Funding ---------------- */}
        <section id="funding" className="scroll-mt-20 border-t bg-muted/30 py-20">
          <div className="container">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-primary">Funding · Early access</p>
              <h2 className="text-4xl font-black tracking-tight md:text-6xl">
                Access up to <span className="gradient-text">{usd0(FUNDING.financingMax)}</span> in business financing.
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">Build your business with access to capital, based on how it actually performs.</p>
            </div>
            <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
              <Reveal>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {[
                    { icon: Layers, t: "Flexible financing options" },
                    { icon: TrendingUp, t: "Funding based on business performance" },
                    { icon: CreditCard, t: "Credit options for freelancers and agencies" },
                    { icon: Rocket, t: "Build your business with access to capital" },
                  ].map((b) => (
                    <li key={b.t} className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm font-semibold">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><b.icon className="size-4" /></span>{b.t}
                    </li>
                  ))}
                </ul>
                {/* Funding ladder */}
                <p className="mb-3 mt-8 text-sm font-semibold">Your funding grows with your track record</p>
                <ol className="relative space-y-3 border-l-2 border-primary/30 pl-5">
                  {[
                    { i: Zap, t: "Early pay", v: `Up to ${Math.round(EARLY_PAY.advancePct * 100)}% of a verified order`, d: `Flat ${Math.round(EARLY_PAY.feePct * 100)}% fee, repaid within ${EARLY_PAY.termDays} days.`, s: "Beta" },
                    { i: Gauge, t: "Project funding", v: `Up to ${usd0(FUNDING.projectMax)}`, d: "An agency can borrow to hire additional developers, purchase equipment or expand its operations.", s: "Early access" },
                    { i: Landmark, t: "Business financing", v: `Up to ${usd0(FUNDING.financingMax)}`, d: "Credit lines and term financing sized to your business performance.", s: "Early access" },
                  ].map((r) => (
                    <li key={r.t} className="relative rounded-2xl border bg-card p-4">
                      <span className="absolute -left-[31px] top-5 flex size-5 items-center justify-center rounded-full bg-primary text-white ring-4 ring-background"><r.i className="size-3" /></span>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold">{r.t}</p>
                        <Badge variant="secondary">{r.s}</Badge>
                      </div>
                      <p className="mt-1 text-xl font-black gradient-text">{r.v}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{r.d}</p>
                    </li>
                  ))}
                </ol>
              </Reveal>
              <Reveal delay={120}>
                <FinancingForm />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ---------------- Invest: marketplace, portfolios, revenue sharing ---------------- */}
        <section id="invest" className="scroll-mt-20 py-20">
          <div className="container">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-primary">For investors · Beta</p>
              <h2 className="text-4xl font-black tracking-tight md:text-6xl">
                The investment marketplace for <span className="gradient-text">the freelance economy.</span>
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Invest directly in freelancers and agencies, or in the platform itself through an index spread across high-rated talent. Pool shares are held as permissioned tokens.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { icon: Bitcoin, t: "Crypto marketplace", d: "Back verified freelancers and agencies, or the Platform Index. Holdings are permissioned tokens with every mint, transfer and distribution on-chain." },
                { icon: PieChart, t: "Investment portfolios", d: "Track your investments, performance, distributions and risk in one portfolio view." },
                { icon: LineChart, t: "Revenue-sharing agreements", d: "Fund an agency and receive a defined percentage of its eligible revenue for a defined period." },
              ].map((c, i) => (
                <Reveal key={c.t} delay={i * 80}>
                  <div className="h-full rounded-2xl border bg-card p-6">
                    <span className="flex size-11 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-purple-500 text-white"><c.icon className="size-5" /></span>
                    <h3 className="mt-4 text-lg font-bold">{c.t}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{c.d}</p>
                  </div>
                </Reveal>
              ))}
            </div>

            <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
              <Reveal><InvestModes /></Reveal>
              <Reveal delay={120}>
                <div className="space-y-6">
                  <div className="panel p-5 md:p-6">
                    <p className="flex items-center gap-2 font-semibold"><LineChart className="size-4 text-primary" /> How revenue sharing works</p>
                    <ol className="mt-4 space-y-3 text-sm">
                      <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">1</span>An agency raises, for example, $20,000 for 8% of eligible revenue over 24 months.</li>
                      <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">2</span>Each month it earns $30,000 of eligible revenue, investors share $2,400, split by stake.</li>
                      <li className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">3</span>Distributions, performance and risk show in your portfolio. A slow month pays less.</li>
                    </ol>
                    <p className="mt-3 text-[11px] text-muted-foreground">Example numbers only, not a projection or offer.</p>
                  </div>
                  <InvestorForm />
                </div>
              </Reveal>
            </div>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" variant="gradient" asChild>
                <Link href="/signup/investor" data-cta="invest-signup">Create an investor account <ArrowRight className="size-4" /></Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/signup" data-cta="invest-raise"><Building2 className="size-4" /> Raise for my agency</Link>
              </Button>
            </div>
            <p className="mx-auto mt-4 max-w-3xl text-center text-[11px] text-muted-foreground">
              This page is not an offer to sell securities. Investing involves risk, including loss of principal. Open to accredited or professional investors
              in eligible countries only. Settlement is simulated during beta, and tokens run on test networks until regulatory approvals are in place.
            </p>
          </div>
        </section>

        {/* ---------------- How it works ---------------- */}
        <section id="how" className="scroll-mt-20 border-t bg-muted/30 py-20">
          <div className="container">
            <SectionHeading eyebrow="How it works" title="Up and running in three steps" subtitle="Your first job scan runs within two minutes of signing up." />
            <div className="relative grid gap-6 md:grid-cols-3">
              <div className="absolute left-0 right-0 top-8 hidden h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent md:block" />
              {[
                { icon: Plug, title: "Connect your platforms", desc: "Link Upwork, Fiverr, Freelancer.com and the rest. Official APIs where they exist, email or guided setup where they don't." },
                { icon: Sparkles, title: "Let Autopilot find the work", desc: "It scans for jobs and gigs, ranks them, and drafts proposals. You review, approve and send." },
                { icon: Rocket, title: "Get paid, protected and funded", desc: "Invoice by milestone, collect by card or crypto, insure new orders and unlock capital as you grow." },
              ].map((s, i) => (
                <Reveal key={s.title} delay={i * 120}>
                  <div className="relative text-center">
                    <div className="relative mx-auto flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-purple-500 text-white shadow-lg">
                      <s.icon className="size-7" />
                      <span className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border-2 border-background bg-fuchsia-500 text-xs font-bold">{i + 1}</span>
                    </div>
                    <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
                    <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">{s.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- Pricing ---------------- */}
        <section id="pricing" className="scroll-mt-20 py-20">
          <div className="container">
            <SectionHeading eyebrow="Pricing" title="Start free. Upgrade when Autopilot pays for itself."
              subtitle="A single small project can cover a year of Pro. Paid plans start with a free trial." />
            <div className="grid gap-4 md:grid-cols-3">
              {LANDING_PLANS.map((t) => (
                <div key={t.id} className={`relative flex flex-col rounded-2xl border bg-card p-6 ${t.hot ? "border-2 border-primary shadow-xl glow-primary md:-translate-y-2" : ""}`}>
                  {t.hot && <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-3 py-0.5 text-xs font-semibold text-white">Most popular</span>}
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{t.name}</h3>
                    {t.price > 0 && <Badge variant="outline" className="font-normal">Free trial</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{t.who}</p>
                  <p className="mt-3 text-4xl font-extrabold">${t.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                  <ul className="my-5 space-y-2 text-sm">
                    {t.features.map((f) => <li key={f} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />{f}</li>)}
                  </ul>
                  <Button className="mt-auto" variant={t.hot ? "gradient" : "outline"} asChild>
                    <Link href={t.href} data-cta={`pricing-${t.id}`}>{t.cta}</Link>
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              3-day free trial on paid plans, extended to 7 days when you share. Cancel any time during the trial.{" "}
              <Link href="/pricing" className="font-medium text-primary hover:underline">Compare all plans</Link>
            </p>
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section id="faq" className="scroll-mt-20 border-t bg-muted/30 py-20">
          <div className="container max-w-3xl">
            <SectionHeading eyebrow="Questions" title="Everything you're wondering, answered" subtitle="The short version: you stay in control, and nothing is hidden." />
            <div className="space-y-3">
              {faqs.map((f) => (
                <details key={f.q} className="group rounded-xl border bg-card px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {f.q}
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              <Link href="/contact" className="font-medium text-primary hover:underline">Ask us anything</Link>
            </p>
          </div>
        </section>

        {/* ---------------- Final CTA ---------------- */}
        <section id="final-cta" className="py-20">
          <div className="container">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-purple-600 to-fuchsia-600 p-6 text-center text-white sm:p-8 md:p-14">
              <div className="absolute -left-20 -top-20 size-72 rounded-full bg-cyan-400/30 blur-3xl" />
              <div className="absolute -bottom-24 -right-16 size-72 rounded-full bg-fuchsia-300/30 blur-3xl" />
              <div className="relative flex flex-col items-center gap-6">
                <FinalPitch />
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-white/85">
                  {["Free plan forever", "No card required", "You approve every send"].map((t) => (
                    <span key={t} className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4" /> {t}</span>
                  ))}
                </div>
                <div className="flex flex-wrap justify-center gap-3 pt-2">
                  {[
                    { href: "#cards", icon: CreditCard, label: "Reserve a card" },
                    { href: "#insurance", icon: ShieldCheck, label: "Insure orders" },
                    { href: "#funding", icon: Landmark, label: "Funding early access" },
                    { href: "#invest", icon: LineChart, label: "Invest" },
                  ].map((b) => (
                    <Button key={b.href} variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white" asChild>
                      <Link href={b.href}><b.icon className="size-4" /> {b.label}</Link>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <StickyCta />
        <ScrollCapture />
      </div>
    </PersonaProvider>
  );
}

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="mx-auto mb-12 max-w-3xl text-center">
      <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
      <h2 className="text-3xl font-black tracking-tight md:text-5xl">{title}</h2>
      <p className="mt-4 text-muted-foreground md:text-lg">{subtitle}</p>
    </div>
  );
}
