"use client";
import * as React from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Gift, Loader2, Percent, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CARD_COUNTDOWN_DAYS, CARD_LAUNCH_AT, FOUNDING_PERKS, QUIZ, buildOffer, type QuizAnswers } from "@/lib/landing";
import { isEmail, joinWaitlist } from "./waitlist";

/* ------------------------------------------------------------------ */
/* Countdown                                                            */
/* ------------------------------------------------------------------ */
function useCountdown(target: string) {
  const end = React.useMemo(() => new Date(target).getTime(), [target]);
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null || Number.isNaN(end)) return null;
  const ms = Math.max(0, end - now);
  return {
    done: ms === 0,
    ms,
    d: Math.floor(ms / 86_400_000), h: Math.floor(ms / 3_600_000) % 24, m: Math.floor(ms / 60_000) % 60, s: Math.floor(ms / 1000) % 60,
  };
}

/** Countdown to the fixed card launch date. `compact` for tight spaces. */
export function Countdown({ compact }: { compact?: boolean }) {
  const c = useCountdown(CARD_LAUNCH_AT);
  const launch = new Date(CARD_LAUNCH_AT);
  const dateLabel = Number.isNaN(launch.getTime()) ? "" : launch.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (c?.done) {
    return <p className="text-center text-lg font-semibold text-primary">Rolling out now, waitlist members first.</p>;
  }
  const total = CARD_COUNTDOWN_DAYS * 86_400_000;
  const elapsedPct = c ? Math.min(100, Math.max(2, ((total - Math.min(c.ms, total)) / total) * 100)) : 2;
  const cells: [string, number | undefined][] = [["Days", c?.d], ["Hours", c?.h], ["Minutes", c?.m], ["Seconds", c?.s]];
  return (
    <div className="text-center">
      <div className={cn("mx-auto grid grid-cols-4", compact ? "max-w-md gap-2" : "max-w-2xl gap-2 sm:gap-4")} role="timer" aria-label={dateLabel ? `Cards launch ${dateLabel}` : "Cards launch countdown"}>
        {cells.map(([label, v]) => (
          <div key={label} className="rounded-2xl border bg-card/80 px-1 py-3 shadow-sm backdrop-blur sm:py-5">
            <p className={cn("font-black tabular-nums gradient-text", compact ? "text-2xl" : "text-4xl sm:text-6xl")} aria-hidden>
              {v === undefined ? "--" : String(v).padStart(2, "0")}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">{label}</p>
          </div>
        ))}
      </div>
      {!compact && (
        <div className="mx-auto mt-5 max-w-2xl">
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-gradient-to-r from-primary via-fuchsia-400 to-cyan-400 transition-all duration-1000" style={{ width: `${elapsedPct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {c ? `${CARD_COUNTDOWN_DAYS}-day countdown · ${c.d} day${c.d === 1 ? "" : "s"} to go` : `${CARD_COUNTDOWN_DAYS}-day countdown`}
            {dateLabel && ` · planned launch ${dateLabel}`}
          </p>
        </div>
      )}
      {compact && dateLabel && <p className="mt-3 text-xs text-muted-foreground">Planned launch: {dateLabel}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card art                                                             */
/* ------------------------------------------------------------------ */
function CardArt({ kind, className }: { kind: "debit" | "credit"; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative aspect-[1.586] w-full max-w-sm overflow-hidden rounded-2xl p-5 text-white shadow-2xl ring-1 ring-white/10",
        kind === "debit"
          ? "bg-gradient-to-br from-cyan-400 via-primary to-purple-600"
          : "bg-gradient-to-br from-zinc-900 via-purple-900 to-fuchsia-700",
        className,
      )}
    >
      <div className="card-sheen absolute inset-0 animate-shine" />
      <div className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <p className="text-sm font-bold tracking-wide">Autopilot</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/80">{kind}</p>
        </div>
        <div className="h-7 w-10 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 opacity-90" />
        <div className="flex items-end justify-between">
          <p className="font-mono text-sm tracking-[0.2em] text-white/90">•••• 2027</p>
          <p className="text-[10px] uppercase tracking-wider text-white/70">Founding member</p>
        </div>
      </div>
    </div>
  );
}

const inputCls = "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm";

/* ------------------------------------------------------------------ */
/* Debit waitlist                                                       */
/* ------------------------------------------------------------------ */
const PAYOUTS = ["Upwork", "Fiverr", "Freelancer.com", "Direct clients", "Crypto"];

function DebitSignup() {
  const [email, setEmail] = React.useState("");
  const [payout, setPayout] = React.useState<string[]>([]);
  const [state, setState] = React.useState<"idle" | "busy" | "done">("idle");
  const [msg, setMsg] = React.useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) { setMsg("Enter a valid email address."); return; }
    setState("busy"); setMsg("");
    const r = await joinWaitlist({ email, product: "debit-card", answers: payout.length ? { payout } : undefined });
    if (!r.ok) { setState("idle"); setMsg(r.error); return; }
    setState("done");
    setMsg(r.demo ? "Demo mode: nothing was sent." : r.already ? "You're already on the list. We'll be in touch." : "You're on the list. Watch your inbox on launch day.");
  };
  if (state === "done") {
    return <p role="status" className="flex items-center gap-2 rounded-lg bg-success/15 px-3 py-2.5 text-sm font-medium text-success"><CheckCircle2 className="size-4 shrink-0" />{msg}</p>;
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Where do you get paid today? <span className="font-normal">(optional)</span></legend>
        <div className="flex flex-wrap gap-1.5">
          {PAYOUTS.map((p) => {
            const on = payout.includes(p);
            return (
              <button key={p} type="button" aria-pressed={on} onClick={() => setPayout(on ? payout.filter((x) => x !== p) : [...payout, p])}
                className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/50")}>
                {p}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="debit-email" className="sr-only">Email for the debit card waitlist</label>
        <input id="debit-email" type="email" autoComplete="email" placeholder="you@work.com" value={email} onChange={(e) => setEmail(e.target.value)} className={cn(inputCls, "sm:flex-1")} />
        <Button type="submit" variant="outline" size="lg" className="shrink-0 px-5" disabled={state === "busy"} data-cta="debit-waitlist">
          {state === "busy" ? <Loader2 className="size-4 animate-spin" /> : null} Reserve my debit card
        </Button>
      </div>
      {msg && <p role="alert" className="text-xs text-destructive">{msg}</p>}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Personalized credit-card signup — inline, four quick questions       */
/* ------------------------------------------------------------------ */
const EMPTY: QuizAnswers = { role: "", revenue: "", spend: [], rewards: "" };
const STEPS = [
  { key: "role", q: "What do you do?", multi: false },
  { key: "revenue", q: "Roughly how much do you bill each month?", multi: false },
  { key: "spend", q: "What would you use the card for?", multi: true, hint: "Pick up to three" },
  { key: "rewards", q: "How would you like your rewards?", multi: false },
] as const;

function CreditFlow({ onExit }: { onExit: () => void }) {
  const [step, setStep] = React.useState(0);
  const [a, setA] = React.useState<QuizAnswers>(EMPTY);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [result, setResult] = React.useState("");
  const top = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => { top.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [step]);

  const offerStep = STEPS.length;
  const s = STEPS[step];
  const value = s ? a[s.key] : null;
  const answered = s ? (Array.isArray(value) ? value.length > 0 : !!value) : true;
  const pct = Math.round((Math.min(step, offerStep) / offerStep) * 100);
  const offer = step >= offerStep ? buildOffer(a) : null;

  const pick = (id: string) => {
    if (!s) return;
    if (s.multi) {
      const list = a[s.key] as string[];
      const next = list.includes(id) ? list.filter((x) => x !== id) : list.length >= 3 ? list : [...list, id];
      setA({ ...a, [s.key]: next });
    } else {
      setA({ ...a, [s.key]: id });
      setTimeout(() => setStep((n) => n + 1), 180);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) { setErr("Enter a valid email address."); return; }
    setBusy(true); setErr("");
    const r = await joinWaitlist({ email, name, product: "credit-card", answers: { ...a, offer: offer?.id } });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setResult(r.demo ? "Demo mode: nothing was sent, but this is the offer you'd reserve." : r.already ? "You're already on the list. We've kept your original answers." : `Your offer is reserved. We'll email ${email.trim()} the moment Autopilot Credit opens.`);
  };

  const options = s ? (QUIZ[s.key] as { id: string; label: string; hint?: string }[]) : [];

  return (
    <div ref={top} className="scroll-mt-24">
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Offer progress">
          <div className="h-full rounded-full bg-gradient-to-r from-primary via-fuchsia-400 to-cyan-400 transition-all duration-500" style={{ width: `${Math.max(pct, 6)}%` }} />
        </div>
        <span className="text-xs font-medium text-muted-foreground">{step < offerStep ? `${step + 1} of ${offerStep}` : "Your offer"}</span>
      </div>

      {s && (
        <div key={step} className="mt-5 animate-fade-in">
          <h4 className="text-lg font-bold">{s.q}</h4>
          {"hint" in s && s.hint && <p className="text-sm text-muted-foreground">{s.hint}</p>}
          <div className={cn("mt-4 grid gap-2", options.length > 4 && "grid-cols-2")}>
            {options.map((o) => {
              const on = Array.isArray(value) ? value.includes(o.id) : value === o.id;
              return (
                <button key={o.id} type="button" aria-pressed={on} onClick={() => pick(o.id)}
                  className={cn("flex items-center justify-between gap-2 rounded-xl border px-3 py-3 text-left text-sm transition sm:px-4",
                    on ? "border-primary bg-primary/10 ring-1 ring-primary" : "hover:border-primary/50 hover:bg-accent")}>
                  <span className="min-w-0"><span className="font-medium">{o.label}</span>{o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}</span>
                  {on && <CheckCircle2 className="size-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
          <div className="mt-5 flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={() => (step === 0 ? onExit() : setStep(step - 1))}><ArrowLeft className="size-4" /> Back</Button>
            {s.multi && <Button type="button" variant="gradient" size="sm" disabled={!answered} onClick={() => setStep(step + 1)}>Next <ArrowRight className="size-4" /></Button>}
          </div>
        </div>
      )}

      {offer && (
        <div className="mt-5 animate-fade-in">
          <div className="rounded-2xl bg-gradient-to-br from-zinc-900 via-purple-900 to-fuchsia-700 p-5 text-white">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/80"><Sparkles className="size-3.5" /> Picked for you</p>
            <p className="mt-1 text-xl font-bold">{offer.card}</p>
            <p className="text-sm text-white/80">{offer.tagline}</p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {offer.rewards.map((r) => (
                <div key={r.category} className="rounded-xl bg-white/10 px-3 py-2">
                  <p className="flex items-baseline gap-0.5 text-2xl font-black">{r.pct}<Percent className="size-4" /></p>
                  <p className="text-[11px] leading-tight text-white/80">back on {r.category.toLowerCase()}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-white/70">Planned reward targets, not final terms. The issuing bank sets rates at launch.</p>
          </div>
          <ul className="mt-4 space-y-2">
            {offer.highlights.map((h) => (
              <li key={h} className="flex gap-2 text-sm"><Gift className="mt-0.5 size-4 shrink-0 text-fuchsia-500" />{h}</li>
            ))}
          </ul>
          {result ? (
            <p role="status" className="mt-5 flex items-start gap-2 rounded-lg bg-success/15 px-3 py-2.5 text-sm font-medium text-success"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{result}</p>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-2" noValidate>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor="cc-name" className="sr-only">First name</label>
                  <input id="cc-name" autoComplete="given-name" placeholder="First name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label htmlFor="cc-email" className="sr-only">Email</label>
                  <input id="cc-email" type="email" autoComplete="email" placeholder="you@work.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                </div>
              </div>
              {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
              <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={busy} data-cta="credit-offer-claim">
                {busy && <Loader2 className="size-4 animate-spin" />} Reserve my offer
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                This is not a credit application and won&apos;t affect your credit score. We&apos;ll email you about early access; unsubscribe anytime.
                Cards will be issued by a partner bank, subject to approval. Rates, limits and rewards are set at launch.
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep(offerStep - 1)}><ArrowLeft className="size-4" /> Change my answers</Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section                                                              */
/* ------------------------------------------------------------------ */
export function CardsSection() {
  const [flow, setFlow] = React.useState(false);
  return (
    <>
      <div className="mb-12"><Countdown /></div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="panel flex min-w-0 flex-col p-5 md:p-8">
          <CardArt kind="debit" />
          <h3 className="mt-6 text-2xl font-bold">Autopilot Debit</h3>
          <p className="mt-1 text-muted-foreground">Spend what you earn, the moment you earn it.</p>
          <ul className="my-5 space-y-2 text-sm">
            {["Invoice and milestone payouts land straight on your card", "Spend in dollars, top up from USDC", "Every swipe flows into your Money dashboard", "Virtual card the day you're approved"].map((f) => (
              <li key={f} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />{f}</li>
            ))}
          </ul>
          <div className="mt-auto"><DebitSignup /></div>
        </div>

        <div className="panel relative flex min-w-0 flex-col overflow-hidden p-5 ring-1 ring-primary/40 md:p-8">
          <span className="absolute right-4 top-4 z-10 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">Personalized</span>
          {flow ? (
            <>
              <h3 className="mb-4 pr-24 text-2xl font-bold">Autopilot Credit</h3>
              <CreditFlow onExit={() => setFlow(false)} />
            </>
          ) : (
            <>
              <CardArt kind="credit" />
              <h3 className="mt-6 text-2xl font-bold">Autopilot Credit</h3>
              <p className="mt-1 text-muted-foreground">Credit that understands freelance income.</p>
              <ul className="my-5 space-y-2 text-sm">
                {["Limits informed by your platform earnings, not just a credit score", "Rewards on what you actually buy: software, ads, equipment", "Team cards with spending limits for agencies", "Build business credit as you grow"].map((f) => (
                  <li key={f} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />{f}</li>
                ))}
              </ul>
              <div className="mt-auto">
                <Button variant="gradient" size="xl" className="w-full" onClick={() => setFlow(true)} data-cta="credit-quiz-open">
                  Get my personalized offer <ArrowRight className="size-4" />
                </Button>
                <p className="mt-2 text-center text-xs text-muted-foreground">4 quick questions · about 20 seconds · no credit check</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-dashed p-5 text-center">
        <p className="text-sm font-semibold">Founding-member perks for everyone on the waitlist</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {FOUNDING_PERKS.map((p) => <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><Gift className="size-3.5" />{p}</span>)}
        </div>
      </div>
      <p className="mx-auto mt-4 max-w-3xl text-center text-[11px] leading-relaxed text-muted-foreground">
        Autopilot Cards are not available yet. Features shown are planned and may change. Joining the waitlist is not an application for credit and
        does not affect your credit score. Cards will be issued by a partner bank, subject to approval; rates, fees and rewards will be disclosed at launch.
      </p>
    </>
  );
}
