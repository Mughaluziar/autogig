"use client";
import * as React from "react";
import Link from "next/link";
import {
  AlertCircle, ArrowRight, CalendarClock, Check, Crown, ExternalLink, Gauge, Infinity as InfinityIcon, Loader2, Megaphone,
  Receipt, Rocket, Sparkles, Users, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { API_URL, apiCall, apiGet } from "@/lib/api";
import { DEMO_MODE } from "@/lib/auth";
import { useEntity } from "@/lib/use-entity";
import { fmtDate, money } from "@/components/money/format";
import { openBillingPortal, PENDING_PLAN_KEY, planName, useBillingConfig, type Plan } from "@/components/checkout/billing";
import { cn } from "@/lib/utils";

type Monetization = { plan: string; bidCredits: number; profileCredits: number; purchases?: any[] };

const UNLOCKS = [
  { icon: InfinityIcon, title: "Unlimited bids", body: "Your agents never stop for credits." },
  { icon: Users, title: "Unlimited profiles", body: "Connect every marketplace you work on." },
  { icon: Gauge, title: "Priority matching", body: "First in line when a great job lands." },
  { icon: Megaphone, title: "Full outreach suite", body: "Campaigns, templates and follow-ups." },
];

export default function PlanPage() {
  const { toast } = useToast();
  const { config, failed, reload } = useBillingConfig();
  const fromStore = useEntity<Monetization>("user-monetization", { plan: "free", bidCredits: 10, profileCredits: 2, purchases: [] });
  const [fresh, setFresh] = React.useState<Monetization | null>(null);
  const [busy, setBusy] = React.useState<"portal" | "cancel" | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  // Credits change on the server (Stripe webhook): read them directly.
  React.useEffect(() => {
    if (DEMO_MODE || !API_URL) return;
    void apiGet<Monetization>("/api/user-monetization").then((m) => m && setFresh(m));
  }, []);
  React.useEffect(() => {
    try { setPending(sessionStorage.getItem(PENDING_PLAN_KEY)); } catch { /* storage blocked */ }
  }, []);

  const mon = fresh ?? fromStore;
  const plan = String(mon.plan || "free");
  const isPro = plan === "pro";
  const paid = plan !== "free";
  const sub = config?.subscription ?? null;
  const bids = Math.max(0, Number(mon.bidCredits) || 0);
  const profiles = Math.max(0, Number(mon.profileCredits) || 0);
  const plans: Plan[] = config?.plans ?? [];
  const current = plans.find((p) => p.id === plan);
  const purchases: any[] = mon.purchases ?? [];
  const trialDays = config?.trialDays ?? 3;
  const trialAvailable = config?.trialAvailable ?? true;

  const portal = async () => {
    setBusy("portal");
    const err = await openBillingPortal();
    setBusy(null);
    if (err) toast({ title: "Couldn't open billing", description: err });
  };
  const toggleCancel = async (cancel: boolean) => {
    setBusy("cancel");
    const res = await apiCall<any>("/api/billing/subscription/cancel", { cancel });
    setBusy(null);
    if (res?.status === 200) { toast({ title: cancel ? "Your plan will end at the close of this period" : "Your plan will keep renewing", variant: "success" }); reload(); }
    else toast({ title: "Nothing changed", description: typeof res?.data?.detail === "string" ? res.data.detail : "Try again in a moment." });
  };

  const statusLine = () => {
    if (!paid) return "Free forever. Upgrade when Autopilot pays for itself.";
    if (!sub) return DEMO_MODE ? "Demo plan, nothing is billed." : "Active";
    if (sub.status === "trialing") return `Free trial${sub.trialEnd ? ` · first charge ${fmtDate(sub.trialEnd)}` : ""}${sub.cancelAtPeriodEnd ? " · cancels before then" : ""}`;
    if (sub.cancelAtPeriodEnd) return `Cancels ${fmtDate(sub.currentPeriodEnd)}`;
    if (sub.status === "past_due") return "Payment failed · update your card to keep your plan";
    return sub.currentPeriodEnd ? `Renews ${fmtDate(sub.currentPeriodEnd)}` : "Active";
  };

  return (
    <div className="space-y-6">
      {pending && !paid && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4 sm:flex-row sm:items-center">
          <Sparkles className="size-5 shrink-0 text-primary" />
          <p className="flex-1 text-sm">You picked <span className="font-semibold">{planName(pending)}</span> before signing up. Start your {trialDays}-day free trial now?</p>
          <div className="flex gap-2">
            <Button size="sm" variant="gradient" asChild><Link href={`/checkout?plan=${pending}`} onClick={() => { try { sessionStorage.removeItem(PENDING_PLAN_KEY); } catch { /* ignore */ } }}>Continue</Link></Button>
            <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => { try { sessionStorage.removeItem(PENDING_PLAN_KEY); } catch { /* ignore */ } setPending(null); }}><X className="size-4" /></Button>
          </div>
        </div>
      )}

      {/* Current plan */}
      <section className={cn("relative overflow-hidden rounded-3xl border p-5 sm:p-7", paid ? "border-primary/40 bg-gradient-to-br from-primary/25 via-card to-card" : "bg-card")}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-fuchsia-500/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Crown className={cn("size-4", paid ? "text-warning" : "")} /> Current plan</p>
            <p className="mt-1 text-4xl font-extrabold tracking-tight">{current?.name ?? planName(plan)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarClock className="size-4" />{statusLine()}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isPro && (
              <Button variant="gradient" size="lg" className="px-6" asChild>
                <Link href="/checkout?plan=pro"><Rocket className="size-4" /> {trialAvailable && !paid ? `Try Pro free for ${trialDays} days` : "Upgrade to Pro"}</Link>
              </Button>
            )}
            {sub?.canManage && (
              <Button variant="outline" className="bg-background/60" disabled={busy === "portal"} onClick={portal}>
                {busy === "portal" ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />} Manage billing
              </Button>
            )}
            {sub && sub.status !== "canceled" && (
              <Button variant="ghost" disabled={busy === "cancel"} onClick={() => toggleCancel(!sub.cancelAtPeriodEnd)}>
                {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}{sub.cancelAtPeriodEnd ? "Keep my plan" : "Cancel plan"}
              </Button>
            )}
          </div>
        </div>
      </section>

      {failed && (
        <p className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />Couldn&apos;t load billing details. Your plan and credits below are still current.</p>
      )}

      {/* Credits */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Meter icon={Zap} label="Bid credits" left={bids} of={plan === "plus" ? 50 : 10} unlimited={isPro}
          note={isPro ? "Every agent bid is included." : plan === "plus" ? "50 more each billing month." : "Used when an agent sends a bid for you."}
          action={!isPro ? <Button variant="outline" className="w-full" asChild><Link href="/checkout?pack=bids"><Zap className="size-4" /> Buy 10 bids · $9.90</Link></Button> : null} />
        <Meter icon={Users} label="Profile slots" left={profiles} of={plan === "plus" ? 5 : 2} unlimited={isPro}
          note={isPro ? "Connect as many marketplaces as you like." : "One slot per connected marketplace profile."}
          action={!isPro ? <Button variant="outline" className="w-full" asChild><Link href="/checkout?pack=profiles"><Users className="size-4" /> Add a slot · $5.99</Link></Button> : null} />
      </div>

      {/* What Pro unlocks */}
      {!isPro && (
        <Card className="overflow-hidden">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Pro · $19/mo</p>
                <p className="text-lg font-bold">What Pro unlocks</p>
              </div>
              <Link href="/checkout?plan=pro" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{trialAvailable ? `Start ${trialDays}-day free trial` : "Upgrade"} <ArrowRight className="size-4" /></Link>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {UNLOCKS.map((u) => (
                <div key={u.title} className="rounded-xl border bg-muted/20 p-3">
                  <u.icon className="size-5 text-primary" />
                  <p className="mt-2 text-sm font-semibold">{u.title}</p>
                  <p className="text-xs text-muted-foreground">{u.body}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compare */}
      <section aria-labelledby="compare">
        <p id="compare" className="mb-3 text-sm font-semibold">Compare plans</p>
        {!config ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading plans…</div> : (
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((p) => {
              const isCurrent = p.id === plan;
              const otherPaid = paid && !isCurrent && p.id !== "free";
              return (
                <Card key={p.id} className={cn("relative flex flex-col", p.highlight && "border-primary shadow-lg shadow-primary/10", isCurrent && "ring-2 ring-primary")}>
                  {p.highlight && <span className="absolute -top-2.5 left-4 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">Most popular</span>}
                  <CardContent className="flex flex-1 flex-col p-5">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.audience}</p>
                    <p className="mt-3 text-3xl font-extrabold">{p.price ? `$${p.price}` : "$0"}<span className="text-sm font-normal text-muted-foreground">{p.price ? "/mo" : ""}</span></p>
                    <ul className="mt-4 flex-1 space-y-2 text-sm">
                      {p.features.map((f) => <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" /><span>{f}</span></li>)}
                    </ul>
                    <div className="mt-5">
                      {isCurrent ? <Button variant="secondary" className="w-full" disabled>Current plan</Button>
                        : p.id === "free" ? <Button variant="ghost" className="w-full" disabled>{paid ? "Included after you cancel" : ""}</Button>
                          : otherPaid ? <Button variant="outline" className="w-full" disabled={!sub?.canManage || busy === "portal"} onClick={portal}>Switch in billing</Button>
                            : <Button variant={p.highlight ? "gradient" : "outline"} className="w-full" asChild><Link href={`/checkout?plan=${p.id}`}>{trialAvailable ? `Start free trial` : `Choose ${p.name}`}</Link></Button>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {config && !config.live && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground"><AlertCircle className="mt-px size-3.5 shrink-0" />
            {DEMO_MODE ? "This is the frontend-only demo: checkout runs against the server, so nothing here is billed." : "Online checkout isn't switched on yet, so upgrades can't be bought and nothing is charged."}
          </p>
        )}
      </section>

      {/* History */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <p className="mb-3 flex items-center gap-2 font-semibold"><Receipt className="size-4 text-primary" /> Billing history</p>
          {purchases.length === 0 ? <p className="text-sm text-muted-foreground">No purchases yet.</p> : (
            <ul className="divide-y">
              {purchases.slice(0, 20).map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{p.item ?? p.description}</p><p className="text-[11px] text-muted-foreground">{fmtDate(String(p.date ?? "").slice(0, 10))}</p></div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", p.status === "Paid" ? "bg-success/15 text-success" : p.status === "Trial" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{p.status}</span>
                  <span className="w-20 text-right font-semibold">{money(Number(p.amount) || 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Meter({ icon: Icon, label, left, of, unlimited, note, action }: {
  icon: any; label: string; left: number; of: number; unlimited: boolean; note: string; action: React.ReactNode;
}) {
  const low = !unlimited && left <= Math.max(1, Math.round(of * 0.2));
  return (
    <Card>
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4 text-primary" />{label}</p>
          {low && <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">{left === 0 ? "Out" : "Running low"}</span>}
        </div>
        <p className="mt-2 text-3xl font-extrabold tracking-tight">{unlimited ? "Unlimited" : <>{left}<span className="text-base font-medium text-muted-foreground"> left</span></>}</p>
        <Progress value={unlimited ? 100 : Math.min(100, (left / Math.max(of, 1)) * 100)} className="mt-3 h-2" indicatorClassName={low ? "bg-destructive" : unlimited ? "bg-gradient-to-r from-primary to-fuchsia-500" : undefined} />
        <p className="mt-2 flex-1 text-xs text-muted-foreground">{note}</p>
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}
