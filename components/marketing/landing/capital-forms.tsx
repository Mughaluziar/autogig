"use client";
import * as React from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isEmail, joinWaitlist, type WaitlistProduct } from "./waitlist";

function Chips({ label, options, value, onChange, multi }: { label: string; options: string[]; value: string | string[]; onChange: (v: any) => void; multi?: boolean }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = Array.isArray(value) ? value.includes(o) : value === o;
          return (
            <button key={o} type="button" aria-pressed={on}
              onClick={() => onChange(multi ? (on ? (value as string[]).filter((x) => x !== o) : [...(value as string[]), o]) : o)}
              className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/50 hover:text-foreground")}>
              {o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function EmailSubmit({ product, answers, cta, done, fine }: { product: WaitlistProduct; answers: Record<string, unknown>; cta: string; done: string; fine: string }) {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [ok, setOk] = React.useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) { setErr("Enter a valid email address."); return; }
    setBusy(true); setErr("");
    const r = await joinWaitlist({ email, product, answers });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setOk(r.demo ? "Demo mode: nothing was sent." : r.already ? "You're already on the list. We'll be in touch." : done);
  };
  if (ok) return <p role="status" className="flex items-center gap-2 rounded-lg bg-success/15 px-3 py-2.5 text-sm font-medium text-success"><CheckCircle2 className="size-4 shrink-0" />{ok}</p>;
  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`${product}-email`} className="sr-only">Email</label>
        <input id={`${product}-email`} type="email" autoComplete="email" placeholder="you@work.com" value={email} onChange={(e) => setEmail(e.target.value)}
          className="h-11 w-full min-w-0 rounded-lg sm:flex-1 border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <Button type="submit" variant="gradient" size="lg" className="shrink-0 px-5" disabled={busy} data-cta={`${product}-waitlist`}>
          {busy && <Loader2 className="size-4 animate-spin" />} {cta}
        </Button>
      </div>
      {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{fine}</p>
    </form>
  );
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function FinancingForm() {
  const [amount, setAmount] = React.useState(25000);
  const [use, setUse] = React.useState<string[]>(["Hire developers"]);
  const [role, setRole] = React.useState("Agency");
  const [revenue, setRevenue] = React.useState("$10k–$50k / mo");
  const project = amount <= 10000;
  return (
    <div className="panel space-y-5 p-6">
      <div>
        <label htmlFor="fin-amount" className="flex items-baseline justify-between">
          <span className="text-sm font-medium">How much would help you grow?</span>
          <span className="text-2xl font-bold gradient-text">{usd(amount)}</span>
        </label>
        <input id="fin-amount" type="range" min={1000} max={250000} step={1000} value={amount} onChange={(e) => setAmount(Number(e.target.value))}
          className="mt-3 w-full accent-[hsl(var(--primary))]" />
        <p className="mt-1 text-xs text-muted-foreground">{project ? "Fits project funding: up to $10,000 for agencies." : "Business financing: up to $250,000."}</p>
      </div>
      <Chips label="What's it for?" multi options={["Hire developers", "Equipment", "Marketing", "Cash flow", "Expansion"]} value={use} onChange={setUse} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Chips label="You are" options={["Freelancer", "Agency"]} value={role} onChange={setRole} />
        <Chips label="Monthly revenue" options={["Under $10k / mo", "$10k–$50k / mo", "$50k+ / mo"]} value={revenue} onChange={setRevenue} />
      </div>
      <EmailSubmit product="financing" answers={{ amount, use, role, revenue }} cta="Get early access"
        done="You're on the early-access list. We'll reach out when funding opens for your profile."
        fine="Joining early access is not a loan application and involves no credit check. Financing will be offered through licensed lending partners, subject to eligibility and approval." />
    </div>
  );
}

export function InvestorForm() {
  const [interest, setInterest] = React.useState<string[]>(["Portfolios"]);
  const [ticket, setTicket] = React.useState("$10k–$50k");
  const [accredited, setAccredited] = React.useState("Yes");
  return (
    <div className="panel space-y-5 p-6">
      <Chips label="I'm interested in" multi options={["Portfolios", "Revenue sharing", "Tokenized pool shares"]} value={interest} onChange={setInterest} />
      <Chips label="Typical investment" options={["Under $10k", "$10k–$50k", "$50k–$250k", "$250k+"]} value={ticket} onChange={setTicket} />
      <Chips label="Are you an accredited or professional investor?" options={["Yes", "No", "Not sure"]} value={accredited} onChange={setAccredited} />
      <EmailSubmit product="investor" answers={{ interest, ticket, accredited }} cta="Join investor early access"
        done="Thanks. We'll contact you with eligibility details and next steps."
        fine="This page is not an offer to sell securities. Investing involves risk, including loss of principal. Open to accredited or professional investors in eligible countries only." />
    </div>
  );
}
