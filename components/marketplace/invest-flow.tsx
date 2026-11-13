"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BadgeCheck, CheckCircle2, Layers, Loader2, Lock, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { newIdempotencyKey, toCents, usd } from "@/lib/capital";
import {
  INDEX_ID, MARKET_RISKS, bankingBase, bps, errorText, useListing, useMarketOverview, type Listing,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { Frame, FundingBar, GradeBadge, KindBadge, Loading, marketLinks } from "./common";

const QUICK = [100_00, 250_00, 500_00, 1_000_00];

export function InvestFlow({ id, base, canRaise, verifyHref }: { id: string; base: string; canRaise: boolean; verifyHref: string }) {
  const isIndex = id === INDEX_ID;
  const overview = useMarketOverview();
  const listing = useListing(isIndex ? null : id);
  const loaded = overview.loaded && (isIndex || listing.loaded);
  return (
    <Frame kind="market" links={marketLinks(base, { raise: canRaise })} title={isIndex ? "Invest in the index" : "Invest"}
      description={isIndex ? "Spread one investment evenly across the highest-rated open raises." : "Choose an amount, review the terms and risks, and confirm."}>
      {!loaded ? <Loading /> : !overview.data || (!isIndex && !listing.data) ? (
        <p className="py-10 text-center text-sm text-muted-foreground">This raise isn&apos;t available. <Link href={base} className="text-primary">Back to the marketplace</Link></p>
      ) : (
        <Flow base={base} isIndex={isIndex} listing={listing.data} verifyHref={verifyHref}
          balance={overview.data.balances.usdCents} reasons={overview.data.investorReasons}
          indexCapacity={overview.data.index.capacityCents} minInvestment={overview.data.policy.minInvestmentCents}
          onDone={overview.refresh} />
      )}
    </Frame>
  );
}

function Flow({
  base, isIndex, listing, balance, reasons, indexCapacity, minInvestment, verifyHref, onDone,
}: {
  base: string; isIndex: boolean; listing: Listing | null; balance: number; reasons: string[]; indexCapacity: number;
  minInvestment: number; verifyHref: string; onDone: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [amount, setAmount] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ placed: number; kept: number; count: number } | null>(null);
  const cents = toCents(amount) ?? 0;
  const key = React.useMemo(() => newIdempotencyKey(), [amount]); // eslint-disable-line react-hooks/exhaustive-deps
  const min = isIndex ? minInvestment : listing!.minInvestmentCents;
  const cap = isIndex ? indexCapacity : listing!.remainingCents;
  const max = Math.min(balance, cap);
  const bank = bankingBase(base);
  const problems = [
    cents && cents < min ? `The minimum is ${usd(min)}.` : "",
    cents > cap ? `Only ${usd(cap)} is left to invest.` : "",
    cents > balance ? `Your balance is ${usd(balance)}.` : "",
  ].filter(Boolean);
  const back = isIndex ? `${base}/${INDEX_ID}` : `${base}/${listing!.id}`;

  if (!isIndex && listing && (listing.mine || listing.status !== "open")) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{listing.mine ? "You can't invest in your own raise." : "This raise isn't taking investments."}</p>;
  }
  if (reasons.length) {
    return (
      <div className="mx-auto max-w-lg panel p-6 text-center">
        <Lock className="mx-auto size-8 text-primary" />
        <h2 className="mt-3 text-lg font-semibold">Verify to invest</h2>
        <p className="mt-1 text-sm text-muted-foreground">The marketplace is open to identity-verified, accredited or professional investors.</p>
        <ul className="mx-auto mt-4 max-w-sm list-disc space-y-1 pl-5 text-left text-sm text-muted-foreground">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <Button className="mt-5" variant="gradient" asChild><Link href={verifyHref}>Start verification</Link></Button>
      </div>
    );
  }

  const confirm = async () => {
    setBusy(true);
    const res = isIndex
      ? await apiCall<{ placedCents: number; keptCents: number; investments: unknown[] }>("/api/marketplace/index/invest",
        { amountCents: cents, idempotencyKey: key, acceptRisk: ack })
      : await apiCall(`/api/marketplace/listings/${listing!.id}/invest`, { amountCents: cents, idempotencyKey: key, acceptRisk: ack });
    setBusy(false);
    if (!res || res.status >= 400) {
      toast({ title: "Investment not placed", description: errorText(res?.data) });
      return;
    }
    const d = res.data as { placedCents?: number; keptCents?: number; investments?: unknown[] };
    setResult({ placed: d.placedCents ?? cents, kept: d.keptCents ?? 0, count: d.investments?.length ?? 1 });
    setStep(3);
    onDone();
  };

  const projection = (() => {
    if (!cents) return null;
    if (isIndex) return "Each slice earns its raise's terms: a fixed return for project funding, a capped revenue share otherwise.";
    if (listing!.kind === "project_funding") {
      const total = cents + Math.floor((cents * (listing!.rateBps ?? 0)) / 10_000);
      return `Up to ${usd(total)} back over ${listing!.terms.termMonths} months if every installment is paid.`;
    }
    return `Your share of ${bps(listing!.terms.shareBps)} of verified revenue for ${listing!.terms.periodMonths} months, up to ${usd(Math.floor((cents * (listing!.terms.capBps ?? 15000)) / 10_000))}.`;
  })();

  return (
    <div className="mx-auto grid max-w-4xl gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back</Link>
        <ol className="flex items-center gap-2 text-xs font-medium" aria-label="Steps">
          {["Amount", "Review", "Done"].map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={cn("flex size-6 items-center justify-center rounded-full border text-[11px]",
                step > i ? "border-primary bg-primary text-primary-foreground" : step === i + 1 ? "border-primary text-primary" : "text-muted-foreground")}>{i + 1}</span>
              <span className={step === i + 1 ? "text-foreground" : "text-muted-foreground"}>{s}</span>
              {i < 2 && <span className="h-px w-6 bg-border" />}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <section className="panel space-y-4 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="amt">How much?</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted-foreground">$</span>
                <Input id="amt" inputMode="decimal" autoFocus placeholder={(min / 100).toString()} value={amount}
                  onChange={(e) => setAmount(e.target.value)} className="h-14 pl-8 text-2xl font-semibold tabular-nums" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK.filter((q) => q >= min && q <= max).map((q) => (
                <Button key={q} type="button" size="sm" variant="outline" onClick={() => setAmount((q / 100).toString())}>{usd(q)}</Button>
              ))}
              {max >= min && <Button type="button" size="sm" variant="outline" onClick={() => setAmount((max / 100).toFixed(2))}>Max {usd(max)}</Button>}
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
              <span className="flex items-center gap-2"><Wallet className="size-4 text-primary" /> Autopilot balance</span>
              <span className="font-semibold tabular-nums">{usd(balance)}</span>
            </div>
            {balance < min && (
              <p className="text-sm text-muted-foreground">
                Add money first: <Link href={`${bank}/transfers?kind=deposit`} className="font-medium text-primary hover:underline">move funds from your bank</Link>.
              </p>
            )}
            {problems.length > 0 && <p role="alert" className="text-sm text-destructive">{problems.join(" ")}</p>}
            {projection && <p className="text-sm text-muted-foreground">{projection}</p>}
            <Button variant="gradient" size="lg" className="w-full" disabled={!cents || problems.length > 0} onClick={() => setStep(2)}>
              Review <ArrowRight />
            </Button>
          </section>
        )}

        {step === 2 && (
          <section className="panel space-y-4 p-5">
            <dl className="space-y-2 text-sm">
              <Row label="You invest" value={usd(cents)} strong />
              <Row label="From" value="Autopilot USD balance" />
              <Row label="Held in" value="Escrow until the raise closes" />
              {projection && <Row label="If paid as agreed" value={projection} />}
            </dl>
            <div className="rounded-xl border border-warning/30 bg-warning/[0.05] p-4 text-xs text-muted-foreground">
              <p className="mb-1.5 font-semibold text-foreground">Risk disclosure</p>
              <ul className="list-disc space-y-1 pl-4">{MARKET_RISKS.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(Boolean(v))} className="mt-0.5" />
              I&apos;ve read the risks, and I understand this is simulated settlement: no real money moves.
            </label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={busy}>Back</Button>
              <Button variant="gradient" className="flex-1" disabled={!ack || busy} onClick={() => void confirm()}>
                {busy && <Loader2 className="animate-spin" />} Confirm {usd(cents)}
              </Button>
            </div>
          </section>
        )}

        {step === 3 && result && (
          <section className="panel p-6 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <h2 className="mt-3 text-xl font-bold">Investment placed</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {usd(result.placed)} {isIndex ? `across ${result.count} high-rated raise${result.count === 1 ? "" : "s"}` : "is in escrow"}.
              {result.kept > 0 && ` ${usd(result.kept)} couldn't be placed and stayed in your balance.`}
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button asChild><Link href={`${base}/portfolio`}>View my portfolio</Link></Button>
              <Button variant="outline" asChild><Link href={base}>Keep browsing</Link></Button>
            </div>
          </section>
        )}
      </div>

      <aside className="min-w-0">
        <section className="panel p-5 lg:sticky lg:top-4">
          {isIndex ? (
            <>
              <Layers className="size-6 text-primary" />
              <p className="mt-2 font-semibold">Platform Index</p>
              <p className="mt-1 text-sm text-muted-foreground">Split evenly across every open raise graded A or B. {usd(indexCapacity)} of room right now.</p>
            </>
          ) : listing && (
            <>
              <div className="flex items-start gap-3">
                <GradeBadge grade={listing.grade} />
                <div className="min-w-0">
                  <p className="line-clamp-2 font-semibold leading-snug">{listing.title}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground"><BadgeCheck className="size-3.5 text-primary" /> {listing.displayName}</p>
                </div>
              </div>
              <div className="mt-3"><KindBadge kind={listing.kind} /></div>
              <FundingBar bps={listing.progressBps} className="mt-4" />
              <p className="mt-2 text-xs text-muted-foreground">{usd(listing.raisedCents)} of {usd(listing.targetCents)} · {usd(listing.remainingCents)} left</p>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("sm:text-right", strong && "text-lg font-bold")}>{value}</dd>
    </div>
  );
}
