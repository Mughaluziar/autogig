"use client";
import * as React from "react";
import { CheckCircle2, Clock, Loader2, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { API_URL, apiGet } from "@/lib/api";
import { dashboardHomeFor, useAuth } from "@/lib/auth";
import { PACKS, planName, planPageFor, type BillingConfig } from "./billing";
import { Shell } from "./checkout-view";

type Monetization = { plan: string; purchases?: { item?: string; status?: string; date?: string }[] };

/** Back from Stripe. The plan or credits change when Stripe's webhook lands,
 *  usually within seconds, so poll until the server shows it. */
export function CheckoutSuccess({ plan, pack }: { plan?: string; pack?: string }) {
  const { user, restored } = useAuth();
  const [state, setState] = React.useState<"checking" | "confirmed" | "slow">("checking");
  const [trialEnd, setTrialEnd] = React.useState<string | null>(null);
  const packInfo = PACKS.find((p) => p.id === pack);
  const started = React.useRef(Date.now());

  React.useEffect(() => {
    if (!restored || !user || !API_URL) return;
    let n = 0;
    let stop = false;
    const check = async () => {
      n += 1;
      if (packInfo) {
        const mon = await apiGet<Monetization>("/api/user-monetization");
        const recent = mon?.purchases?.find((p) => p.item === packInfo.label && p.status === "Paid" && p.date && Date.parse(p.date) > started.current - 15 * 60_000);
        if (recent) { setState("confirmed"); return true; }
      } else {
        const cfg = await apiGet<BillingConfig>("/api/billing/checkout-config");
        if (cfg && cfg.plan === plan) { setTrialEnd(cfg.subscription?.trialEnd ?? null); setState("confirmed"); return true; }
      }
      if (n >= 20) { setState("slow"); return true; }
      return false;
    };
    const loop = async () => { while (!stop && !(await check())) await new Promise((r) => setTimeout(r, 2000)); };
    void loop();
    return () => { stop = true; };
  }, [restored, user, plan, packInfo]);

  const what = packInfo ? packInfo.label : `${planName(plan ?? "pro")} plan`;

  return (
    <Shell>
      <Card className="mx-auto max-w-lg overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-primary via-fuchsia-500 to-cyan-400" />
        <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          {state === "checking" ? (
            <>
              <Loader2 className="size-10 animate-spin text-primary" />
              <h1 className="text-xl font-bold">Confirming with Stripe…</h1>
              <p className="text-sm text-muted-foreground">This usually takes a few seconds.</p>
            </>
          ) : state === "confirmed" ? (
            <>
              <span className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-lg shadow-primary/40"><PartyPopper className="size-8" /></span>
              <h1 className="text-2xl font-extrabold tracking-tight">{packInfo ? `${packInfo.label} added` : `Welcome to ${planName(plan ?? "pro")}`}</h1>
              <p className="max-w-sm text-sm text-muted-foreground">
                {packInfo ? (user?.role === "freelancer" ? "Your bids are ready to use on open specs." : "Your credits are ready. Your agents can use them right away.")
                  : trialEnd ? `Your free trial is on. Nothing is charged until ${new Date(trialEnd).toLocaleDateString("en", { month: "long", day: "numeric" })}.` : "Your plan is active. Everything it includes is unlocked."}
              </p>
              <ul className="mt-2 space-y-1.5 text-left text-sm">
                <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" /> {packInfo ? "Listed in your billing history" : "Invoices and card details under Manage billing"}</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" /> {packInfo ? "Credits never expire" : "Cancel anytime from Plan & credits"}</li>
              </ul>
            </>
          ) : (
            <>
              <Clock className="size-10 text-warning" />
              <h1 className="text-xl font-bold">Payment received, still syncing</h1>
              <p className="max-w-sm text-sm text-muted-foreground">Stripe finished your checkout for the {what}, but our confirmation hasn&apos;t arrived yet. It normally shows up within a minute. Check Plan &amp; credits shortly.</p>
            </>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {/* Full page loads so the dashboard reloads the new plan and credits. */}
            <Button variant="gradient" onClick={() => window.location.assign(user ? dashboardHomeFor(user.role) : "/dashboard/command")}>Go to dashboard</Button>
            <Button variant="outline" onClick={() => window.location.assign(planPageFor(user?.role))}>Plan &amp; credits</Button>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}
