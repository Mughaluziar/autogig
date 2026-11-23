"use client";
import * as React from "react";
import Link from "next/link";
import { AlertCircle, CalendarClock, Check, Crown, ExternalLink, Gavel, Loader2, Receipt, Rocket, Undo2, Zap } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { LoadState } from "@/components/shared/load-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { ReceiptDialog } from "@/components/billing/receipt-dialog";
import { openBillingPortal, planName, useBillingConfig, type Plan } from "@/components/checkout/billing";
import { fmtDate, money } from "@/components/money/format";
import { API_URL, apiCall } from "@/lib/api";
import { DEMO_MODE } from "@/lib/auth";
import { usePool, type BidCredits } from "@/lib/pool";
import { useEntity } from "@/lib/use-entity";
import { cn } from "@/lib/utils";

type Purchase = { id: string; item?: string; description?: string; amount: number; status: string; date?: string; recurring?: boolean };
type Monetization = { plan: string; bidCredits: number; profileCredits: number; purchases?: Purchase[] };

const CREDIT_LABEL = { spent: "1 credit", plan: "Included in Pro", refunded: "Refunded" } as const;

/**
 * A freelancer's plan, bid credits and receipts. Plans, packs and checkout are the platform's real billing
 * (Stripe when configured, routers/billing.py); a freelancer spends bid credits on bids in the freelancer pool.
 */
export default function FreelancerBillingPage() {
  const { toast } = useToast();
  const { config, failed: configFailed, reload: reloadConfig } = useBillingConfig();
  const fromStore = useEntity<Monetization>("user-monetization", { plan: "free", bidCredits: 10, profileCredits: 2, purchases: [] });
  const server = usePool<Monetization>("/api/user-monetization", null);
  const credits = usePool<BidCredits>("/api/pool/bid-credits", null);
  const [busy, setBusy] = React.useState<"portal" | "cancel" | null>(null);
  const [receiptFor, setReceiptFor] = React.useState<string | null>(null);

  // With a backend, the server's own record (credits change when Stripe's webhook lands); the demo build uses its store.
  const mon = API_URL ? server.data : fromStore;
  const plan = String(mon?.plan || "free");
  const paid = plan !== "free";
  const isPro = plan === "pro";
  const sub = config?.subscription ?? null;
  const plans: Plan[] = config?.plans ?? [];
  const current = plans.find((p) => p.id === plan);
  const trialDays = config?.trialDays ?? 3;
  const trialAvailable = config?.trialAvailable ?? true;
  const left = Math.max(0, Number(credits.data?.left ?? mon?.bidCredits ?? 0) || 0);
  const creditsOn = credits.data ? credits.data.enabled : true;
  const purchases = mon?.purchases ?? [];
  const bidPack = (config?.packs ?? []).find((p) => p.id === "bids");

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
    if (res?.status === 200) {
      toast({ title: cancel ? "Your plan will end at the close of this period" : "Your plan will keep renewing", variant: "success" });
      void reloadConfig();
    } else toast({ title: "Nothing changed", description: typeof res?.data?.detail === "string" ? res.data.detail : "Try again in a moment." });
  };

  const statusLine = () => {
    if (!paid) return creditsOn ? "Free. Includes 10 spec bids; top up or upgrade when you need more." : "Free.";
    if (!sub) return DEMO_MODE || config?.simulated ? "Simulated plan: nothing is billed." : "Active";
    if (sub.status === "trialing") return `Free trial${sub.trialEnd ? ` · first charge ${fmtDate(sub.trialEnd)}` : ""}${sub.cancelAtPeriodEnd ? " · cancels before then" : ""}`;
    if (sub.cancelAtPeriodEnd) return `Cancels ${fmtDate(sub.currentPeriodEnd)}`;
    if (sub.status === "past_due") return "Payment failed · update your card under Manage billing to keep your plan";
    return sub.currentPeriodEnd ? `Renews ${fmtDate(sub.currentPeriodEnd)}` : "Active";
  };

  const loading = Boolean(API_URL) && (server.loading || credits.loading);
  const error = server.error || credits.error;

  return (
    <>
      <PageHeader title="Billing & Plan" description="Your plan, your bid credits for the freelancer pool, and receipts for everything you've bought." />
      <LoadState loading={loading && !mon} error={!mon ? error : ""} onRetry={() => { server.reload(); credits.reload(); }} />

      {mon && (
        <div className="space-y-6">
          {/* Current plan */}
          <section className={cn("relative overflow-hidden rounded-2xl border p-5 sm:p-6", paid ? "border-primary/40 bg-gradient-to-br from-primary/20 via-card to-card" : "bg-card")} data-testid="current-plan">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Crown className={cn("size-4", paid && "text-warning")} /> Current plan</p>
                <p className="mt-1 text-3xl font-extrabold tracking-tight">{current?.name ?? planName(plan)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarClock className="size-4 shrink-0" />{statusLine()}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!isPro && (
                  <Button variant="gradient" asChild>
                    <Link href="/checkout?plan=pro"><Rocket className="size-4" /> {trialAvailable && !paid ? `Try Pro free for ${trialDays} days` : "Upgrade to Pro"}</Link>
                  </Button>
                )}
                {sub?.canManage && (
                  <Button variant="outline" className="bg-background/60" disabled={busy === "portal"} onClick={portal}>
                    {busy === "portal" ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />} Manage billing
                  </Button>
                )}
                {sub && sub.status !== "canceled" && (
                  <Button variant="ghost" disabled={busy === "cancel"} onClick={() => void toggleCancel(!sub.cancelAtPeriodEnd)}>
                    {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}{sub.cancelAtPeriodEnd ? "Keep my plan" : "Cancel plan"}
                  </Button>
                )}
              </div>
            </div>
          </section>

          {configFailed && (
            <p className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />Couldn&apos;t load plan details. Your plan and credits shown here are still current.</p>
          )}

          <div className="grid gap-6 lg:grid-cols-5">
            {/* Bid credits */}
            <Card className="lg:col-span-2" data-testid="bid-credits">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Zap className="size-4 text-primary" /> Spec bids</CardTitle>
                <CardDescription>{creditsOn ? credits.data?.rules ?? "Your first bid on a spec uses one bid credit." : "Bidding in the freelancer pool is free right now: no credits are used."}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {creditsOn && (
                  <>
                    <p className="text-4xl font-extrabold tracking-tight">{isPro ? "Unlimited" : <>{left}<span className="text-base font-medium text-muted-foreground"> left</span></>}</p>
                    <Progress value={isPro ? 100 : Math.min(100, (left / (plan === "plus" ? 50 : 10)) * 100)} className="h-2"
                      indicatorClassName={!isPro && left <= 2 ? "bg-destructive" : isPro ? "bg-gradient-to-r from-primary to-fuchsia-500" : undefined} />
                    {!isPro && left === 0 && <p className="text-sm font-medium text-destructive">You&apos;re out of bid credits. Top up or upgrade to keep bidding.</p>}
                    {!isPro && (
                      <Button variant="outline" className="w-full" asChild>
                        <Link href="/checkout?pack=bids"><Gavel className="size-4" /> Buy {bidPack?.credits ?? 10} bids · {money(bidPack?.price ?? 9.9)}</Link>
                      </Button>
                    )}
                    {plan === "plus" && <p className="text-xs text-muted-foreground">Plus adds 50 bids every billing month. Unused bids carry over.</p>}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Recent use */}
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-base">Where your bids went</CardTitle>
                <CardDescription>Each spec you bid on, and what it cost.</CardDescription>
              </CardHeader>
              <CardContent>
                {!credits.data?.used.length ? (
                  <p className="text-sm text-muted-foreground">No bids yet. <Link href="/freelancer/specs" className="font-medium text-primary hover:underline">Browse open specs</Link></p>
                ) : (
                  <ul className="divide-y text-sm">
                    {credits.data.used.slice(0, 10).map((u) => (
                      <li key={`${u.specId}`} className="flex items-center gap-3 py-2">
                        <span className="min-w-0 flex-1 truncate">{u.spec}<span className="block text-[11px] text-muted-foreground">{fmtDate(u.at)} · bid {u.status}</span></span>
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          u.credit === "refunded" ? "bg-success/15 text-success" : u.credit === "plan" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                          {u.credit === "refunded" && <Undo2 className="size-3" />}{CREDIT_LABEL[u.credit]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Compare plans */}
          <section aria-labelledby="compare">
            <p id="compare" className="mb-3 text-sm font-semibold">Plans</p>
            {!config ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading plans…</div> : (
              <div className="grid gap-4 md:grid-cols-3">
                {plans.map((p) => {
                  const isCurrent = p.id === plan;
                  const otherPaid = paid && !isCurrent && p.id !== "free";
                  return (
                    <Card key={p.id} className={cn("relative flex flex-col", p.highlight && "border-primary", isCurrent && "ring-2 ring-primary")}>
                      <CardContent className="flex flex-1 flex-col p-5">
                        <p className="font-semibold">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.audience}</p>
                        <p className="mt-3 text-3xl font-extrabold">{p.price ? `$${p.price}` : "$0"}<span className="text-sm font-normal text-muted-foreground">{p.price ? "/mo" : ""}</span></p>
                        <ul className="mt-4 flex-1 space-y-2 text-sm">
                          {p.features.map((f) => <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" /><span>{f}</span></li>)}
                        </ul>
                        <div className="mt-5">
                          {isCurrent ? <Button variant="secondary" className="w-full" disabled>Current plan</Button>
                            : p.id === "free" ? <Button variant="ghost" className="w-full" disabled>{paid ? "Yours again if you cancel" : ""}</Button>
                              : otherPaid ? <Button variant="outline" className="w-full" disabled={!sub?.canManage || busy === "portal"} onClick={portal}>Switch in billing</Button>
                                : <Button variant={p.highlight ? "gradient" : "outline"} className="w-full" asChild><Link href={`/checkout?plan=${p.id}`}>{trialAvailable ? "Start free trial" : `Choose ${p.name}`}</Link></Button>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
            {config && !config.live && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground"><AlertCircle className="mt-px size-3.5 shrink-0" />
                {config.simulated ? "Online checkout isn't switched on: on this development server, checkout can simulate a purchase and nothing is charged." : "Online checkout isn't switched on yet, so plans and bids can't be bought and nothing is charged."}
              </p>
            )}
          </section>

          {/* History */}
          <Card>
            <CardContent className="p-4 sm:p-5">
              <p className="mb-3 flex items-center gap-2 font-semibold"><Receipt className="size-4 text-primary" /> Billing history</p>
              {purchases.length === 0 ? <p className="text-sm text-muted-foreground">No purchases yet.</p> : (
                <ul className="divide-y" data-testid="billing-history">
                  {purchases.slice(0, 50).map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1"><p className="truncate font-medium">{p.item ?? p.description}</p><p className="text-[11px] text-muted-foreground">{fmtDate(String(p.date ?? "").slice(0, 10))}</p></div>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", p.status === "Paid" ? "bg-success/15 text-success" : p.status === "Trial" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{p.status}</span>
                      <span className="w-20 text-right font-semibold">{money(Number(p.amount) || 0)}</span>
                      {API_URL && <Button size="sm" variant="ghost" onClick={() => setReceiptFor(p.id)} aria-label={`Receipt for ${p.item ?? p.description}`}>Receipt</Button>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <ReceiptDialog purchaseId={receiptFor} onClose={() => setReceiptFor(null)} />
    </>
  );
}
