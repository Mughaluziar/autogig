"use client";
import * as React from "react";
import Link from "next/link";
import {
  ArrowRight, Banknote, Building2, CheckCircle2, Coins, Landmark, Loader2, Rocket, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { API_URL, apiCall } from "@/lib/api";
import { pct, useCapitalData, usd, type Advance } from "@/lib/capital";
import { errorText, useMarketOverview, useMyListings } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { Figure } from "./common";

const PAYOUT_WINDOW_MS = 24 * 3600 * 1000;

/**
 * "Get money": every way a freelancer or agency can raise cash on Autopilot,
 * side by side, ending in a cash-out to Banking. Each card states where the
 * money lands.
 */
export function GetMoneyHub({
  capitalHref, marketBase, bankingBase, earlyPayHref,
}: {
  capitalHref: string; marketBase: string; bankingBase: string;
  /** Where "Get paid early" goes; defaults to the Capital page's early-payment tab. */
  earlyPayHref?: string;
}) {
  const capital = useCapitalData({ freelancer: true });
  const market = useMarketOverview();
  const mine = useMyListings();
  if (!API_URL) return null;
  const eligible = capital.orders.filter((r) => r.underwriting.eligible);
  const maxAdvance = eligible.reduce((n, r) => Math.max(n, r.underwriting.maxPrincipalCents), 0);
  const liveRaise = (mine.data ?? []).find((l) => ["open", "draft", "active"].includes(l.status));
  const balances = market.data?.balances;
  const policy = capital.overview?.pool.policy;
  const verified = capital.overview?.profile.kyc.status === "verified";

  const cards = [
    {
      icon: Banknote, title: "Credit from your projects", amount: maxAdvance ? `Up to ${usd(maxAdvance)}` : "From verified orders",
      desc: `Get up to ${policy ? pct(policy.advanceRateBps) : "70%"} of a verified fixed-price order now for a flat ${policy ? pct(policy.feeBps) : "3%"} fee. Lands in your payout bank account.`,
      status: eligible.length ? `${eligible.length} order${eligible.length === 1 ? "" : "s"} qualify` : "No qualifying orders yet",
      href: earlyPayHref ?? `${capitalHref}?tab=early`, cta: "Get paid early",
    },
    {
      icon: Coins, title: "Upfront in USDC", amount: maxAdvance ? `Up to ${usd(maxAdvance)}` : "From verified orders",
      desc: "The same early payment, paid into your Autopilot USDC balance instead. Funded by the Autopilot pool.",
      status: eligible.length ? "Available below" : "Needs a qualifying order", href: "#usdc", cta: "Take it in USDC",
    },
    {
      icon: Rocket, title: "Marketplace funding", amount: `Up to ${usd(market.data?.policy.maxRaiseCents ?? 1_000_000)}`,
      desc: "Raise from verified investors as project funding or a revenue share. Lands in your Autopilot balance when funded.",
      status: liveRaise ? `Your raise: ${liveRaise.status === "open" ? `${usd(liveRaise.raisedCents)} raised` : liveRaise.status}` : "No raise open",
      href: liveRaise ? `${marketBase}/${liveRaise.id}` : `${marketBase}/raise`, cta: liveRaise ? "View raise" : "Start a raise",
    },
    {
      icon: Building2, title: "Business financing", amount: "Up to $250,000",
      desc: "Lines of credit, term loans or revenue-based financing from licensed partners, sized to your verified revenue.",
      status: "Application, subject to approval", href: `${bankingBase}/financing`, cta: "See my estimate",
    },
  ];

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.title} className="panel flex flex-col p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><c.icon className="size-4" /></span>
              <p className="font-semibold leading-tight">{c.title}</p>
            </div>
            <p className="mt-3 text-lg font-bold">{c.amount}</p>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{c.desc}</p>
            <p className="mt-3 text-xs font-medium">{c.status}</p>
            {c.href && (
              <Button size="sm" variant="outline" className="mt-3" asChild>
                <Link href={c.href}>{c.cta} <ArrowRight /></Link>
              </Button>
            )}
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <UsdcAdvance id="usdc" rows={eligible} advances={capital.advances} verified={verified} loaded={capital.loaded}
          capitalHref={capitalHref} onDone={() => { capital.refresh(); market.refresh(); }} />
        <section className="panel flex flex-col gap-4 p-5">
          <p className="flex items-center gap-2 font-semibold"><Wallet className="size-4 text-primary" /> Cash out</p>
          <div className="grid grid-cols-2 gap-3">
            <Figure label="USD balance" value={usd(balances?.usdCents ?? 0)} />
            <Figure label="USDC balance" value={usd(balances?.usdcCents ?? 0)} />
          </div>
          <p className="text-xs text-muted-foreground">Move money to a linked bank account, convert between USD and USDC, or send USDC to your own wallet.</p>
          <div className="mt-auto flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
            <Button className="flex-1" asChild><Link href={`${bankingBase}/transfers?kind=withdraw`}><Landmark /> Withdraw to bank</Link></Button>
            <Button className="flex-1" variant="outline" asChild><Link href={`${bankingBase}/transfers?kind=to_usd`}>Convert USDC</Link></Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function UsdcAdvance({
  id, rows, advances, verified, loaded, capitalHref, onDone,
}: {
  id: string; rows: ReturnType<typeof useCapitalData>["orders"]; advances: Advance[]; verified: boolean; loaded: boolean;
  capitalHref: string; onDone: () => void;
}) {
  const { toast } = useToast();
  const [orderId, setOrderId] = React.useState("");
  const [terms, setTerms] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<number | null>(null);
  const row = rows.find((r) => r.order.id === orderId) ?? rows[0];
  const movable = advances.filter((a) => ["active", "overdue"].includes(a.status) && !a.payoutTo && a.acceptedAt
    && Date.now() - Date.parse(a.acceptedAt) < PAYOUT_WINDOW_MS);

  const payout = async (advanceId: string) => {
    const res = await apiCall("/api/banking/advance-payout", { advanceId, currency: "usdc" });
    if (!res || res.status >= 400) throw new Error(errorText(res?.data));
  };

  const take = async () => {
    if (!row) return;
    setBusy("take");
    try {
      const quote = await apiCall<Advance>("/api/capital/advances/quote", { orderId: row.order.id, principalCents: row.underwriting.maxPrincipalCents });
      if (!quote || quote.status >= 400) throw new Error(errorText(quote?.data));
      const accepted = await apiCall<Advance>(`/api/capital/advances/${quote.data.id}/accept`, { acceptTerms: true });
      if (!accepted || accepted.status >= 400) throw new Error(errorText(accepted?.data));
      await payout(accepted.data.id);
      setDone(accepted.data.principalCents);
      toast({ title: "USDC received (simulated)", description: `${usd(accepted.data.principalCents)} is in your USDC balance.`, variant: "success" });
      onDone();
    } catch (e) {
      toast({ title: "Not completed", description: e instanceof Error ? e.message : "Try again." });
      onDone();
    } finally {
      setBusy(null);
    }
  };

  const move = async (a: Advance) => {
    setBusy(a.id);
    try {
      await payout(a.id);
      toast({ title: "Moved to your USDC balance (simulated)", variant: "success" });
      onDone();
    } catch (e) {
      toast({ title: "Not moved", description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id={id} className="panel scroll-mt-20 space-y-4 p-5">
      <div>
        <p className="flex items-center gap-2 font-semibold"><Coins className="size-4 text-primary" /> Upfront credit in USDC</p>
        <p className="mt-1 text-xs text-muted-foreground">
          An early payment on a verified order, paid into your USDC balance. You repay it after the marketplace pays you, with the same flat fee.
        </p>
      </div>
      {!loaded ? <p className="text-sm text-muted-foreground">Loading…</p> : done != null ? (
        <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm text-success">
          <CheckCircle2 className="size-4" /> {usd(done)} USDC is in your balance. Repay it from the Capital page.
        </p>
      ) : !verified ? (
        <p className="text-sm text-muted-foreground">Verify your identity first. <Link href={capitalHref} className="font-medium text-primary hover:underline">Start verification</Link></p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No order qualifies yet. Connect Upwork or Freelancer.com through the API so your fixed-price orders can be verified.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="usdc-order">Order</Label>
            <Select id="usdc-order" value={row?.order.id ?? ""} onChange={(e) => setOrderId(e.target.value)}>
              {rows.map((r) => (
                <option key={r.order.id} value={r.order.id}>
                  {(r.order.title ?? r.order.externalOrderId ?? "Order").slice(0, 40)} · up to {usd(r.underwriting.maxPrincipalCents)}
                </option>
              ))}
            </Select>
          </div>
          {row && (
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-3 text-sm">
              <Figure label="You receive" value={`${usd(row.underwriting.maxPrincipalCents)} USDC`} />
              <Figure label="Fee" value={usd(Math.max(1, Math.floor((row.underwriting.maxPrincipalCents * row.underwriting.feeBps) / 10_000)))}
                hint={`${pct(row.underwriting.feeBps)} flat`} />
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={terms} onCheckedChange={(v) => setTerms(Boolean(v))} className="mt-0.5" />
            I&apos;ll repay the amount plus the fee within the term after the marketplace pays me. Simulated settlement: no real money moves.
          </label>
          <Button variant="gradient" className="w-full" disabled={!terms || busy !== null} onClick={() => void take()}>
            {busy === "take" && <Loader2 className="animate-spin" />} Receive {row ? usd(row.underwriting.maxPrincipalCents) : ""} in USDC
          </Button>
        </>
      )}
      {movable.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-medium text-muted-foreground">Accepted in the last day and not paid out yet</p>
          {movable.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{a.orderTitle ?? a.platform} · {usd(a.principalCents)}</span>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void move(a)} className={cn("shrink-0")}>
                {busy === a.id && <Loader2 className="animate-spin" />} To USDC
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
