"use client";
import * as React from "react";
import Link from "next/link";
import {
  AlertCircle, ArrowLeft, Bot, Check, CheckCircle2, Coins, CreditCard, FlaskConical, Loader2, Lock, ShieldCheck, Sparkles, XCircle, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { DEMO_MODE, dashboardHomeFor, useAuth } from "@/lib/auth";
import { useDemoStore } from "@/lib/demo-store";
import { cn } from "@/lib/utils";
import { withNext } from "@/lib/safe-next";
import { PACKS, PENDING_PLAN_KEY, PLANS, startCheckout, TRIAL_DAYS, useBillingConfig, type PackId, type PlanId } from "./billing";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const inDays = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toLocaleDateString("en", { month: "short", day: "numeric" }); };

export function CheckoutView({ plan: planParam, pack: packParam, cancelled }: { plan?: string; pack?: string; cancelled?: boolean }) {
  const { user, restored } = useAuth();
  const demo = useDemoStore();
  const { toast } = useToast();
  const pack = PACKS.find((p) => p.id === packParam)?.id as PackId | undefined;
  const planId: PlanId = pack ? "pro" : ((["plus", "pro"] as const).find((p) => p === planParam) ?? "pro");
  const { config, failed, reload } = useBillingConfig(!!user);
  const [method, setMethod] = React.useState<"card" | "crypto">("card");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [banner, setBanner] = React.useState(!!cancelled);
  const [done, setDone] = React.useState(false);

  const plans = config?.plans ?? PLANS;
  const plan = plans.find((p) => p.id === planId) ?? PLANS[2];
  const packInfo = pack ? (config?.packs ?? PACKS).find((p) => p.id === pack)! : null;
  const trialDays = config?.trialDays ?? TRIAL_DAYS;
  const trial = !pack && (config?.trialAvailable ?? true) && trialDays > 0;
  const currentPlan = config?.plan ?? demo?.state.monetization.plan ?? "free";
  const alreadyOnPlan = !pack && currentPlan === planId;
  const proHasEverything = !!pack && currentPlan === "pro";
  const price = packInfo ? packInfo.price : plan.price;
  const dueToday = trial ? 0 : price;
  const cryptoOk = !!pack && !!config?.cryptoLive;

  // Remember the choice so the Plan page can pick it up after signup.
  // Signed-out visitors come back to this exact checkout after signing up or in.
  const back = pack ? `/checkout?pack=${pack}` : `/checkout?plan=${planId}`;
  const rememberChoice = () => { try { if (!pack) sessionStorage.setItem(PENDING_PLAN_KEY, planId); } catch { /* storage blocked */ } };

  const pay = async () => {
    setBusy(true);
    setError("");
    const err = await startCheckout(pack ? { pack, method: cryptoOk ? method : "card" } : { plan: planId });
    if (err) { setError(err); setBusy(false); if (/already/i.test(err)) reload(); }
  };

  const simulate = async () => {
    if (!demo) return;
    setBusy(true);
    const res = pack ? await demo.buyCredits(pack === "bids" ? "bids" : "profiles") : await demo.upgradePlan();
    setBusy(false);
    if (!res) { toast({ title: "Nothing changed", description: "The simulated purchase was refused." }); return; }
    setDone(true);
  };

  const title = packInfo ? packInfo.label : `${plan.name} plan`;
  const home = user ? dashboardHomeFor(user.role) : "/";

  return (
    <Shell back={user ? "/dashboard/money/plan" : "/#pricing"}>
      {banner && (
        <div role="status" className="mb-5 flex items-start gap-2 rounded-xl border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <XCircle className="mt-0.5 size-4 shrink-0" /><span className="flex-1">Checkout cancelled. Nothing was charged.</span>
          <button type="button" className="text-xs underline-offset-2 hover:underline" onClick={() => setBanner(false)}>Dismiss</button>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* What you're getting */}
        <div className="min-w-0 space-y-5">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" /> {pack ? "One-time top-up" : trial ? `${trialDays}-day free trial` : "Monthly plan"}
            </p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
              {pack ? <>Add <span className="gradient-text">{packInfo!.label.toLowerCase()}</span></> : trial ? <>Try <span className="gradient-text">{plan.name}</span> free for {trialDays} days</> : <>Upgrade to <span className="gradient-text">{plan.name}</span></>}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {pack ? (pack === "bids" ? "Ten more bids your agents can send on your behalf. They never expire." : "One more marketplace profile your agents can work from.")
                : trial ? `Full ${plan.name} access today. Pay nothing until ${inDays(trialDays)}, and cancel any time before then.` : `${usd(plan.price)} a month. Cancel anytime.`}
            </p>
          </div>

          {!pack && (
            <Card>
              <CardContent className="p-5">
                <p className="mb-3 text-sm font-semibold">Everything in {plan.name}</p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {plan.features.map((f) => <li key={f} className="flex items-start gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-success" />{f}</li>)}
                </ul>
                {planId === "plus" && <p className="mt-4 text-xs text-muted-foreground">Want unlimited bids? <Link href="/checkout?plan=pro" className="font-medium text-primary hover:underline">Try Pro instead</Link>.</p>}
              </CardContent>
            </Card>
          )}

          {trial && (
            <ol className="relative space-y-4 border-l border-primary/30 pl-6">
              <Step when="Today" title={`${plan.name} unlocks`} body="$0 due. Your agents get everything in the plan right away." active />
              <Step when={`Before ${inDays(trialDays)}`} title="Change your mind?" body="Cancel from Plan & credits in two taps and you won't be charged anything." />
              <Step when={inDays(trialDays)} title={`First ${usd(plan.price)} charge`} body="Then monthly. Cancel anytime and keep access to the end of the month you paid for." />
            </ol>
          )}
        </div>

        {/* Pay */}
        <Card className="h-fit md:sticky md:top-6">
          <CardContent className="p-5 sm:p-6">
            {!restored || (user && !config && !failed) ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Getting checkout ready…</div>
            ) : done ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success"><CheckCircle2 className="size-6" /></span>
                <p className="mt-1 font-semibold">{pack ? `${packInfo!.label} added` : `You're on ${plan.name}`}</p>
                <p className="text-sm text-muted-foreground">Simulated purchase: nothing was charged.</p>
                <Button variant="gradient" className="mt-3" onClick={() => window.location.assign("/dashboard/money/plan")}>See plan &amp; credits</Button>
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold">Order summary</p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{title}{pack ? "" : " · monthly"}</dt><dd>{usd(price)}{pack ? "" : "/mo"}</dd></div>
                  {trial && <div className="flex justify-between gap-3 text-success"><dt>{trialDays}-day free trial</dt><dd>−{usd(price)}</dd></div>}
                  <div className="flex justify-between gap-3 border-t pt-2 text-base font-bold"><dt>Due today</dt><dd>{usd(dueToday)}</dd></div>
                  {!pack && <p className="text-xs text-muted-foreground">{trial ? `Then ${usd(price)}/mo from ${inDays(trialDays)}.` : "Renews monthly."}</p>}
                </dl>

                <p className="mb-2 mt-5 text-sm font-semibold">Pay with</p>
                <div role="radiogroup" aria-label="Payment method" className="space-y-2">
                  <MethodOption active={method === "card" || !cryptoOk} onClick={() => setMethod("card")} icon={CreditCard}
                    title="Card or wallet" hint="Credit or debit card · Apple Pay and Google Pay on supported devices" />
                  {pack && (
                    <MethodOption active={method === "crypto" && cryptoOk} disabled={!cryptoOk} onClick={() => setMethod("crypto")} icon={Coins}
                      title="Crypto (USDC)" hint={cryptoOk ? "Pay a USD stablecoin from your wallet" : "Not switched on yet"} crypto />
                  )}
                </div>

                {!user ? (
                  <div className="mt-5 space-y-2">
                    <Button variant="gradient" size="xl" className="w-full" asChild>
                      <Link href={withNext("/signup", back)} onClick={rememberChoice}>{trial ? "Create account & start trial" : "Create account to continue"}</Link>
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">Already have an account? <Link href={withNext("/login", back)} onClick={rememberChoice} className="font-medium text-primary hover:underline">Sign in</Link></p>
                  </div>
                ) : alreadyOnPlan || proHasEverything ? (
                  <div className="mt-5 rounded-xl border border-success/40 bg-success/10 p-3 text-sm">
                    <p className="font-medium">{proHasEverything ? "Pro already includes unlimited bids and profiles." : `You're already on ${plan.name}.`}</p>
                    <Link href="/dashboard/money/plan" className="mt-1 inline-block text-xs font-medium text-primary hover:underline">Go to Plan &amp; credits</Link>
                  </div>
                ) : config?.live ? (
                  <>
                    {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{error}</p>}
                    <Button variant="gradient" size="xl" className="mt-5 w-full" disabled={busy} onClick={pay}>
                      {busy ? <><Loader2 className="size-4 animate-spin" /> Opening secure checkout…</> : <><Lock className="size-4" /> {trial ? "Start free trial" : `Pay ${usd(price)}`}</>}
                    </Button>
                  </>
                ) : (
                  <div className="mt-5 space-y-3">
                    <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                      {failed ? "Couldn't reach the server. Check your connection and try again. Nothing was charged." : "Online checkout isn't switched on yet, so nothing can be charged here and no card details are collected."}
                    </p>
                    {config?.simulated && (!pack ? planId === "pro" : true) ? (
                      <Button variant="outline" className="w-full" disabled={busy} onClick={simulate}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />} Simulate {pack ? "purchase" : "upgrade"} · {DEMO_MODE ? "demo" : "development only"}
                      </Button>
                    ) : config?.simulated ? (
                      <p className="text-xs text-muted-foreground">Simulation covers Pro and credit packs.</p>
                    ) : null}
                    <Button variant="ghost" className="w-full" asChild><Link href={home}>Back to dashboard</Link></Button>
                  </div>
                )}

                <p className="mt-4 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <ShieldCheck className="mt-px size-3.5 shrink-0" />
                  You&apos;ll finish on Stripe&apos;s secure checkout. Autopilot never sees your card number.{!pack && " Cancel anytime from Plan & credits."}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function Step({ when, title, body, active }: { when: string; title: string; body: string; active?: boolean }) {
  return (
    <li className="relative">
      <span className={cn("absolute -left-[31px] top-0.5 flex size-4 items-center justify-center rounded-full ring-4 ring-background", active ? "bg-gradient-to-br from-primary to-fuchsia-500" : "bg-muted")}>
        {active && <Zap className="size-2.5 text-white" />}
      </span>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">{when}</p>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </li>
  );
}

function MethodOption({ active, disabled, onClick, icon: Icon, title, hint, crypto }: {
  active: boolean; disabled?: boolean; onClick: () => void; icon: any; title: string; hint: string; crypto?: boolean;
}) {
  return (
    <button type="button" role="radio" aria-checked={active} disabled={disabled} onClick={onClick}
      className={cn("flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50")}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg text-white", crypto ? "bg-gradient-to-br from-fuchsia-500 to-cyan-400" : "bg-gradient-to-br from-primary to-purple-500")}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

export function Shell({ children, back }: { children: React.ReactNode; back?: string }) {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="aurora pointer-events-none absolute inset-x-0 top-0 h-80" aria-hidden />
      <header className="relative mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-purple-500 text-white"><Bot className="size-4" /></span>
          Autopilot
        </Link>
        <div className="flex items-center gap-3">
          {back && <Link href={back} className="hidden items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:inline-flex"><ArrowLeft className="size-3.5" /> Back</Link>}
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="size-3.5" /> Secure checkout</span>
        </div>
      </header>
      <main className="relative mx-auto w-full max-w-5xl px-4 pb-16 pt-4">{children}</main>
    </div>
  );
}
