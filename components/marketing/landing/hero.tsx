"use client";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronDown, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PERSONA_COPY } from "@/lib/landing";
import { EmailCapture } from "./email-capture";
import { PersonaSwitcher, usePersona } from "./persona";
import { RadarDemo } from "./radar-demo";
import { MarketplacePreview } from "./marketplace-preview";

/** Hero: the pitch is rewritten for whoever picked "I'm a…". */
export function Hero({ platformCount }: { platformCount: number }) {
  const { persona } = usePersona();
  const c = PERSONA_COPY[persona];
  const investor = persona === "investor";

  return (
    <div className="container relative grid grid-cols-1 items-center gap-10 py-12 md:py-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14">
      <div className="min-w-0 text-center lg:text-left">
        <PersonaSwitcher className="mb-7" />
        <div key={persona} className="animate-fade-in">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">{c.eyebrow}</p>
          <h1 className="text-[2.6rem] font-black leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
            {c.headline} <span className="gradient-text">{c.highlight}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground md:text-xl lg:mx-0">{c.sub(platformCount)}</p>
          <ul className="mx-auto mt-5 flex max-w-xl flex-col gap-2 text-left text-sm font-medium sm:text-base lg:mx-0">
            {c.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />{b}</li>
            ))}
          </ul>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 lg:items-start">
          {investor ? (
            <Button size="xl" variant="gradient" className="w-full max-w-md sm:w-auto" asChild>
              <Link href={c.cta.href} data-cta="hero-investor">{c.cta.label} <ArrowRight className="size-4" /></Link>
            </Button>
          ) : (
            <EmailCapture id="hero-email" cta={c.cta.label} href={c.cta.href} />
          )}
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-muted-foreground lg:justify-start">
            {(investor ? ["Verification first", "Direct or index", "Simulated settlement in beta"] : ["Free plan forever", "No card required", "You approve every send"]).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-success" />{t}</span>
            ))}
          </div>
          <Link href={c.secondary.href} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline" data-cta={`hero-secondary-${persona}`}>
            {c.secondary.label} <ChevronDown className="size-4" />
          </Link>
          {c.note && <p className="max-w-md text-[11px] text-muted-foreground">{c.note}</p>}
        </div>

        {!investor && (
          <div className="mt-8 grid grid-cols-1 gap-2 text-left sm:grid-cols-2 lg:max-w-xl">
            <Link href="#insurance" data-cta="hero-insurance-chip" className="group flex items-center gap-3 rounded-xl border bg-card/80 p-3 text-sm shadow-sm backdrop-blur transition hover:border-primary/50">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white"><ShieldCheck className="size-4" /></span>
              <span className="min-w-0"><span className="block font-semibold">Protect new orders</span><span className="block text-xs text-muted-foreground">Up to 80% back if cancelled</span></span>
            </Link>
            <Link href="#cards" data-cta="hero-cards-chip" className="group flex items-center gap-3 rounded-xl border bg-card/80 p-3 text-sm shadow-sm backdrop-blur transition hover:border-primary/50">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-primary text-white"><CreditCard className="size-4" /></span>
              <span className="min-w-0"><span className="block font-semibold">Debit &amp; credit cards</span><span className="block text-xs text-muted-foreground">Launch countdown is on</span></span>
            </Link>
          </div>
        )}
      </div>

      <div className="min-w-0">{investor ? <MarketplacePreview /> : <RadarDemo />}</div>
    </div>
  );
}

/** Closing call to action, in the same voice as the hero. */
export function FinalPitch() {
  const { persona } = usePersona();
  const c = PERSONA_COPY[persona];
  return (
    <div key={persona} className="flex animate-fade-in flex-col items-center gap-5">
      <h2 className="max-w-3xl text-3xl font-black leading-tight md:text-5xl">{c.final.title}</h2>
      <p className="max-w-xl text-white/90">{c.final.sub}</p>
      {persona === "investor" ? (
        <Button size="xl" variant="secondary" asChild>
          <Link href={c.cta.href} data-cta="final-investor">{c.cta.label} <ArrowRight className="size-4" /></Link>
        </Button>
      ) : (
        <EmailCapture id="final-email" cta={c.cta.label} href={c.cta.href} dark />
      )}
    </div>
  );
}
