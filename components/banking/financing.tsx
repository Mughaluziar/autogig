"use client";
import * as React from "react";
import Link from "next/link";
import { BadgeCheck, Building2, CheckCircle2, Loader2, ShieldCheck, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { toCents, usd } from "@/lib/capital";
import {
  APPLICATION_STATUS, PRODUCT_LABEL, useApplications, useFinancingEstimate, type FinancingProduct,
} from "@/lib/banking";
import { errorText, shortDate } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { Figure, Frame, GradeBadge, Loading } from "@/components/marketplace/common";
import { bankingLinks } from "./links";

export function FinancingView({ base, accountsHref }: { base: string; accountsHref: string }) {
  const estimate = useFinancingEstimate();
  const apps = useApplications();
  const open = (apps.data ?? []).find((a) => a.status === "submitted" || a.status === "in_review");
  const refresh = () => { apps.refresh(); estimate.refresh(); };
  return (
    <Frame kind="banking" links={bankingLinks(base, { full: true })} title="Business financing"
      description="Access up to $250,000 to hire, buy equipment or grow, sized to how your business actually performs.">
      {!estimate.loaded || !apps.loaded ? <Loading /> : !estimate.data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load your estimate. Refresh to try again.</p>
      ) : (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/20 via-fuchsia-500/10 to-transparent p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Your indicative range</p>
            {estimate.data.estimate ? (
              <p className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight sm:text-4xl">
                {usd(estimate.data.estimate.lowCents)} – {usd(estimate.data.estimate.highCents)}
              </p>
            ) : (
              <p className="mt-2 text-xl font-bold">Not enough verified revenue for an estimate yet</p>
            )}
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Based on {usd(estimate.data.verifiedTrailingYearCents)} of revenue the marketplaces&apos; APIs verified in the last 12 months.
              An estimate, not an offer: a licensed lending partner makes the decision.
            </p>
            {estimate.data.reasons.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {estimate.data.reasons.map((r) => <li key={r} className="flex gap-2"><TrendingUp className="mt-0.5 size-4 shrink-0 text-primary" />{r}</li>)}
              </ul>
            )}
            {!estimate.data.trackRecord.verifiedOrders && (
              <Button className="mt-4" variant="outline" asChild><Link href={accountsHref}>Connect a marketplace account</Link></Button>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {(["line_of_credit", "term_loan", "revenue_based"] as FinancingProduct[]).map((p) => (
              <div key={p} className="panel p-4">
                <p className="font-semibold">{PRODUCT_LABEL[p].label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{PRODUCT_LABEL[p].hint}</p>
              </div>
            ))}
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {open ? (
              <section className="panel p-6 text-center">
                <CheckCircle2 className="mx-auto size-10 text-success" />
                <h2 className="mt-3 text-lg font-semibold">Application {APPLICATION_STATUS[open.status].label.toLowerCase()}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {usd(open.amountCents)} · {PRODUCT_LABEL[open.product].label} · sent {shortDate(open.createdAt)}. You&apos;ll get a notification at each step.
                </p>
                <Button className="mt-4" variant="ghost" onClick={async () => {
                  if (!window.confirm("Withdraw this application?")) return;
                  await apiCall(`/api/banking/financing/${open.id}/withdraw`, {});
                  refresh();
                }}>Withdraw application</Button>
              </section>
            ) : (
              <ApplyForm min={estimate.data.minCents} max={estimate.data.maxCents} suggested={estimate.data.estimate?.highCents ?? null} onDone={refresh} />
            )}
            <aside className="min-w-0 space-y-4">
              <section className="panel p-5">
                <div className="flex items-center gap-3">
                  <GradeBadge grade={estimate.data.trackRecord.grade} size="lg" />
                  <div>
                    <p className="font-semibold">Business performance</p>
                    <p className="text-xs text-muted-foreground">{estimate.data.trackRecord.gradeNote}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Figure label="Verified, 12 months" value={usd(estimate.data.verifiedTrailingYearCents)} />
                  <Figure label="Active work" value={usd(estimate.data.trackRecord.activeValueCents)} />
                  <Figure label="Completed orders" value={String(estimate.data.trackRecord.completedOrders)} />
                  <Figure label="Platforms" value={String(estimate.data.trackRecord.platforms.length)} />
                </div>
              </section>
              <section className="panel space-y-2 p-5 text-xs text-muted-foreground">
                <p className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" /> Applying doesn&apos;t affect your credit score. A partner may run a credit check only with your separate consent.</p>
                <p className="flex gap-2"><BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-primary" /> Financing is provided by licensed lending partners, subject to approval. Autopilot doesn&apos;t lend this money itself.</p>
              </section>
              {(apps.data ?? []).length > 0 && (
                <section className="panel p-0">
                  <h3 className="border-b px-5 py-3 text-sm font-semibold">Past applications</h3>
                  <ul className="divide-y text-sm">
                    {(apps.data ?? []).map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 px-5 py-3">
                        <span className="min-w-0 truncate">{usd(a.amountCents)} · {PRODUCT_LABEL[a.product].label}</span>
                        <Badge variant={APPLICATION_STATUS[a.status].variant}>{APPLICATION_STATUS[a.status].label}</Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          </div>
        </div>
      )}
    </Frame>
  );
}

function ApplyForm({ min, max, suggested, onDone }: { min: number; max: number; suggested: number | null; onDone: () => void }) {
  const { toast } = useToast();
  const [f, setF] = React.useState({
    amount: suggested ? String(suggested / 100) : "25000", product: "line_of_credit" as FinancingProduct, purpose: "",
    businessType: "freelancer", years: "1-2", team: "1", revenue: "",
  });
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const cents = toCents(f.amount) ?? 0;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((cur) => ({ ...cur, [k]: e.target.value }));
  const amountErr = cents && (cents < min || cents > max) ? `Request between ${usd(min)} and ${usd(max)}.` : "";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiCall("/api/banking/financing", {
      amountCents: cents, product: f.product, purpose: f.purpose, businessType: f.businessType, yearsInBusiness: f.years,
      teamSize: Number(f.team) || 1, monthlyRevenueCents: toCents(f.revenue) ?? 0, consent,
    });
    setBusy(false);
    if (!res || res.status >= 400) {
      toast({ title: "Application not sent", description: errorText(res?.data) });
      return;
    }
    toast({ title: "Application sent", description: "A lending partner reviews it, usually within a few business days.", variant: "success" });
    onDone();
  };
  return (
    <form onSubmit={submit} className="panel space-y-4 p-5">
      <p className="flex items-center gap-2 font-semibold"><Building2 className="size-4 text-primary" /> Apply</p>
      <div className="space-y-1.5">
        <Label htmlFor="fin-amt">Amount (USD)</Label>
        <Input id="fin-amt" inputMode="decimal" value={f.amount} onChange={set("amount")} className="text-lg font-semibold" />
        <input type="range" aria-label="Amount" min={min / 100} max={max / 100} step={500} value={Math.min(max, Math.max(min, cents)) / 100}
          onChange={(e) => setF((cur) => ({ ...cur, amount: e.target.value }))} className="w-full accent-[hsl(var(--primary))]" />
        {amountErr && <p role="alert" className="text-xs text-destructive">{amountErr}</p>}
      </div>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Financing type">
        {(Object.keys(PRODUCT_LABEL) as FinancingProduct[]).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={f.product === p} onClick={() => setF((cur) => ({ ...cur, product: p }))}
            className={cn("rounded-xl border px-3 py-2 text-left text-sm", f.product === p ? "border-primary bg-primary/10" : "hover:border-primary/40")}>
            {PRODUCT_LABEL[p].label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fin-purpose">What&apos;s it for?</Label>
        <Textarea id="fin-purpose" rows={3} value={f.purpose} onChange={set("purpose")} maxLength={600} placeholder="Hire two developers to take on larger retainers." />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="fin-type">You are</Label>
          <Select id="fin-type" value={f.businessType} onChange={set("businessType")}><option value="freelancer">Freelancer</option><option value="agency">Agency</option></Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fin-years">In business</Label>
          <Select id="fin-years" value={f.years} onChange={set("years")}>
            <option value="<1">Under 1 yr</option><option value="1-2">1–2 yrs</option><option value="3-5">3–5 yrs</option><option value="5+">5+ yrs</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fin-team">Team size</Label>
          <Input id="fin-team" inputMode="numeric" value={f.team} onChange={set("team")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fin-rev">Monthly revenue</Label>
          <Input id="fin-rev" inputMode="decimal" value={f.revenue} onChange={set("revenue")} placeholder="Optional" />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} className="mt-0.5" />
        Share my verified order history and this application with a licensed lending partner so they can review it.
      </label>
      <Button type="submit" variant="gradient" className="w-full" disabled={busy || !consent || !cents || Boolean(amountErr) || f.purpose.trim().length < 10}>
        {busy && <Loader2 className="animate-spin" />} Send application
      </Button>
    </form>
  );
}
