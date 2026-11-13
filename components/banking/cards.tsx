"use client";
import * as React from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CreditCard, Gift, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import {
  CARD_COUNTDOWN_DAYS, CARD_LAUNCH_AT, FOUNDING_PERKS, QUIZ, buildOffer, type Offer, type QuizAnswers,
} from "@/lib/landing";
import { isEmail, joinWaitlist } from "@/components/marketing/landing/waitlist";
import { cn } from "@/lib/utils";
import { Frame } from "@/components/marketplace/common";
import { bankingLinks } from "./links";

function useNow() {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Same fixed launch date as the landing page (lib/landing.ts), so both count down together. */
export function CardCountdown({ compact, onDark }: { compact?: boolean; onDark?: boolean }) {
  const now = useNow();
  const end = Date.parse(CARD_LAUNCH_AT);
  const start = end - CARD_COUNTDOWN_DAYS * 86_400_000;
  const ms = now == null || Number.isNaN(end) ? null : Math.max(0, end - now);
  const cells: [string, number | null][] = [
    ["Days", ms == null ? null : Math.floor(ms / 86_400_000)],
    ["Hrs", ms == null ? null : Math.floor(ms / 3_600_000) % 24],
    ["Min", ms == null ? null : Math.floor(ms / 60_000) % 60],
    ["Sec", ms == null ? null : Math.floor(ms / 1000) % 60],
  ];
  const day = now == null ? null : Math.min(CARD_COUNTDOWN_DAYS, Math.max(1, Math.ceil((now - start) / 86_400_000)));
  const launch = Number.isNaN(end) ? "" : new Date(end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (ms === 0) return <p className="font-semibold">Rolling out now, waitlist members first.</p>;
  return (
    <div>
      <div className={cn("grid grid-cols-4", compact ? "gap-1.5" : "gap-2")} role="timer" aria-label={launch ? `Cards launch ${launch}` : "Cards launch countdown"}>
        {cells.map(([label, v]) => (
          <div key={label} className={cn("rounded-lg px-1.5 py-2 text-center", onDark ? "bg-white/10" : "border bg-card")}>
            <p className={cn("font-extrabold tabular-nums", compact ? "text-lg" : "text-2xl sm:text-3xl", !onDark && "gradient-text")} aria-hidden>
              {v == null ? "--" : String(v).padStart(2, "0")}
            </p>
            <p className={cn("text-[10px] uppercase tracking-wider", onDark ? "text-white/60" : "text-muted-foreground")}>{label}</p>
          </div>
        ))}
      </div>
      {!compact && day != null && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500" style={{ width: `${(day / CARD_COUNTDOWN_DAYS) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">Day {day} of {CARD_COUNTDOWN_DAYS} · planned launch {launch}</p>
        </div>
      )}
    </div>
  );
}

function CardArt({ kind }: { kind: "debit" | "credit" }) {
  return (
    <div aria-hidden className={cn("relative aspect-[1.586] w-full max-w-xs overflow-hidden rounded-2xl p-4 text-white shadow-2xl ring-1 ring-white/10",
      kind === "debit" ? "bg-gradient-to-br from-cyan-400 via-primary to-purple-600" : "bg-gradient-to-br from-zinc-900 via-purple-900 to-fuchsia-700")}>
      <div className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <p className="text-sm font-bold">Autopilot</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/80">{kind}</p>
        </div>
        <div className="h-6 w-9 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 opacity-90" />
        <p className="font-mono text-xs tracking-[0.2em] text-white/90">•••• •••• •••• 2027</p>
      </div>
    </div>
  );
}

export function CardsView({ base }: { base: string }) {
  const { user } = useAuth();
  return (
    <Frame kind="banking" links={bankingLinks(base, { full: true })} title="Autopilot Cards"
      description="A debit card that's paid the moment your clients pay, and a credit card with limits informed by your platform earnings.">
      <div className="space-y-5">
        <section className="panel p-5 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Launch countdown</p>
              <h2 className="mt-1 text-xl font-bold">Waitlist members get cards first</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {FOUNDING_PERKS.map((p) => <li key={p} className="flex items-center gap-2"><Gift className="size-3.5 text-primary" /> {p}</li>)}
              </ul>
            </div>
            <div className="w-full md:max-w-sm"><CardCountdown /></div>
          </div>
        </section>
        <div className="grid gap-5 lg:grid-cols-2">
          <DebitCard email={user?.email ?? ""} name={user?.name ?? ""} />
          <CreditCard_ email={user?.email ?? ""} name={user?.name ?? ""} />
        </div>
        <p className="text-xs text-muted-foreground">
          Joining a waitlist records your interest only: no application, no credit check, no effect on your credit score.
          Cards will be issued by a licensed partner bank, subject to approval. Reward rates shown are planned targets; the
          issuing bank sets final rates, fees and limits at launch.
        </p>
      </div>
    </Frame>
  );
}

function DebitCard({ email: initial, name }: { email: string; name: string }) {
  const [email, setEmail] = React.useState(initial);
  const [state, setState] = React.useState<"idle" | "busy" | "done">("idle");
  const [msg, setMsg] = React.useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) { setMsg("Enter a valid email address."); return; }
    setState("busy"); setMsg("");
    const r = await joinWaitlist({ email, name, product: "debit-card", answers: { payout: "autopilot-balance" } });
    if (!r.ok) { setState("idle"); setMsg(r.error); return; }
    setState("done");
    setMsg(r.demo ? "Demo mode: nothing was sent." : r.already ? "You're already on the list." : "You're on the list. We'll email you on launch day.");
  };
  return (
    <section className="panel flex flex-col gap-4 p-5 sm:p-6">
      <CardArt kind="debit" />
      <div>
        <h3 className="text-lg font-bold">Autopilot Debit</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>Spend your Autopilot balance the moment a client pays an invoice</li>
          <li>Spend USD or USDC from one card</li>
          <li>Instant early-payment and marketplace funds, no transfer wait</li>
        </ul>
      </div>
      {state === "done" ? (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-success/15 px-3 py-2.5 text-sm font-medium text-success"><CheckCircle2 className="size-4" />{msg}</p>
      ) : (
        <form onSubmit={submit} className="mt-auto space-y-2" noValidate>
          <Label htmlFor="debit-email" className="sr-only">Email</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="debit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@work.com" className="min-w-0 sm:flex-1" />
            <Button type="submit" variant="outline" disabled={state === "busy"}>{state === "busy" && <Loader2 className="animate-spin" />} Reserve debit</Button>
          </div>
          {msg && <p role="alert" className="text-xs text-destructive">{msg}</p>}
        </form>
      )}
    </section>
  );
}

const EMPTY: QuizAnswers = { role: "", revenue: "", spend: [], rewards: "" };
const STEPS = ["role", "revenue", "spend", "rewards"] as const;
const PROMPTS: Record<(typeof STEPS)[number], string> = {
  role: "How do you work?", revenue: "Monthly revenue across platforms", spend: "Where do you spend most? (up to 2)", rewards: "How do you want rewards?",
};

function CreditCard_({ email: initial, name }: { email: string; name: string }) {
  const [step, setStep] = React.useState(0);
  const [a, setA] = React.useState<QuizAnswers>(EMPTY);
  const [offer, setOffer] = React.useState<Offer | null>(null);
  const [email, setEmail] = React.useState(initial);
  const [state, setState] = React.useState<"idle" | "busy" | "done">("idle");
  const [msg, setMsg] = React.useState("");
  const key = STEPS[step];
  const options = key ? (QUIZ[key] as { id: string; label: string; hint?: string }[]) : [];
  const answered = key === "spend" ? a.spend.length > 0 : key ? Boolean(a[key]) : true;

  const pick = (id: string) => {
    if (key === "spend") {
      setA((cur) => ({ ...cur, spend: cur.spend.includes(id) ? cur.spend.filter((s) => s !== id) : [...cur.spend, id].slice(-2) }));
    } else if (key) {
      setA((cur) => ({ ...cur, [key]: id }));
    }
  };
  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else setOffer(buildOffer(a));
  };
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offer) return;
    if (!isEmail(email)) { setMsg("Enter a valid email address."); return; }
    setState("busy"); setMsg("");
    const r = await joinWaitlist({ email, name, product: "credit-card",
      answers: { role: a.role, revenue: a.revenue, spend: a.spend, rewards: a.rewards, offer: offer.id } });
    if (!r.ok) { setState("idle"); setMsg(r.error); return; }
    setState("done");
    setMsg(r.demo ? "Demo mode: nothing was sent." : r.already ? "You're already on the list. Your offer is saved." : "Reserved. Your offer is saved for launch day.");
  };

  return (
    <section className="panel flex flex-col gap-4 p-5 sm:p-6">
      <CardArt kind="credit" />
      <div>
        <h3 className="flex items-center gap-2 text-lg font-bold">Autopilot Credit <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">Personalized</span></h3>
        <p className="mt-1 text-sm text-muted-foreground">Answer four questions to see the offer we&apos;re building for you.</p>
      </div>
      {!offer ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{PROMPTS[key]}</span>
            <span>{step + 1} / {STEPS.length}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((o) => {
              const active = key === "spend" ? a.spend.includes(o.id) : a[key as Exclude<typeof key, "spend">] === o.id;
              return (
                <button key={o.id} type="button" aria-pressed={active} onClick={() => pick(o.id)}
                  className={cn("rounded-xl border px-3 py-2.5 text-left text-sm transition-colors", active ? "border-primary bg-primary/10" : "hover:border-primary/40")}>
                  <span className="font-medium">{o.label}</span>
                  {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft /> Back</Button>}
            <Button className="flex-1" variant="gradient" disabled={!answered} onClick={next}>
              {step < STEPS.length - 1 ? <>Next <ArrowRight /></> : <><Sparkles /> See my offer</>}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-primary/40 bg-primary/[0.07] p-4">
            <p className="flex items-center gap-2 font-semibold"><CreditCard className="size-4 text-primary" /> {offer.card}</p>
            <p className="mt-1 text-sm text-muted-foreground">{offer.tagline}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {offer.rewards.map((r) => (
                <li key={r.category} className="flex justify-between gap-2"><span>{r.category}</span><span className="font-semibold">{r.pct}% planned</span></li>
              ))}
            </ul>
            <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
              {offer.highlights.map((h) => <li key={h} className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" /> {h}</li>)}
            </ul>
          </div>
          {state === "done" ? (
            <p role="status" className="flex items-center gap-2 rounded-lg bg-success/15 px-3 py-2.5 text-sm font-medium text-success"><CheckCircle2 className="size-4" />{msg}</p>
          ) : (
            <form onSubmit={join} className="space-y-2" noValidate>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@work.com" className="min-w-0 sm:flex-1" />
                <Button type="submit" variant="gradient" disabled={state === "busy"}>{state === "busy" && <Loader2 className="animate-spin" />} Reserve this offer</Button>
              </div>
              {msg && <p role="alert" className="text-xs text-destructive">{msg}</p>}
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setOffer(null); setStep(0); }}>Change my answers</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
