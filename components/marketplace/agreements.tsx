"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, FileSignature, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { newIdempotencyKey, toCents, usd } from "@/lib/capital";
import { bankingBase, bps, errorText, shortDate, useAgreement, useAgreements, useMarketOverview, type Agreement } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { Figure, Frame, FundingBar, GradeBadge, KindBadge, Loading, StatusPill, marketLinks } from "./common";

export function AgreementsList({ base, canRaise }: { base: string; canRaise: boolean }) {
  const { data, loaded } = useAgreements();
  return (
    <Frame kind="market" links={marketLinks(base, { raise: canRaise })} title="Agreements"
      description="Project-funding and revenue-sharing agreements: what's been paid, what's due and when.">
      {!loaded ? <Loading /> : !data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load agreements. Refresh to try again.</p>
      ) : data.borrower.length + data.investor.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed p-10 text-center">
          <span className="mb-3 rounded-full bg-primary/10 p-3 text-primary"><FileSignature className="size-6" /></span>
          <h3 className="font-semibold">No agreements yet</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            An agreement starts when a raise is funded. Its repayment schedule and every payment show up here, for the business and its investors.
          </p>
          <Button className="mt-4" variant="outline" asChild><Link href={base}>Browse raises</Link></Button>
        </div>
      ) : (
        <div className="space-y-6">
          {data.borrower.length > 0 && <Group title="You owe" rows={data.borrower} base={base} />}
          {data.investor.length > 0 && <Group title="You invested" rows={data.investor} base={base} />}
        </div>
      )}
    </Frame>
  );
}

function Group({ title, rows, base }: { title: string; rows: Agreement[]; base: string }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((a) => (
          <Link key={a.id} href={`${base}/agreements/${a.id}`} className="panel block p-4 transition-colors hover:border-primary/50">
            <div className="flex items-start gap-3">
              <GradeBadge grade={a.grade} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{a.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5"><KindBadge kind={a.kind} /><StatusPill status={a.status} /></div>
              </div>
            </div>
            <div className="mt-4 flex items-baseline justify-between text-sm">
              <span className="font-semibold tabular-nums">{usd(a.paidCents)}</span>
              <span className="text-xs text-muted-foreground">of {usd(a.totalDueCents)}{a.kind === "revenue_share" ? " cap" : ""}</span>
            </div>
            <FundingBar bps={a.progressBps} className="mt-2" />
            <p className="mt-2 text-xs text-muted-foreground">
              {a.due.dueNowCents > 0 ? `${usd(a.due.dueNowCents)} due now` : a.due.nextDueAt ? `Next ${usd(a.due.nextAmountCents)} on ${shortDate(a.due.nextDueAt)}` : `Ends ${shortDate(a.endAt)}`}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function AgreementDetail({ id, base, canRaise }: { id: string; base: string; canRaise: boolean }) {
  const { data: a, loaded, refresh } = useAgreement(id);
  return (
    <Frame kind="market" links={marketLinks(base, { raise: canRaise })} title="Agreement"
      description="Terms, repayment schedule and payments.">
      {!loaded ? <Loading /> : !a ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Agreement not found. <Link href={`${base}/agreements`} className="text-primary">All agreements</Link></p>
      ) : <Detail a={a} base={base} onPaid={refresh} />}
    </Frame>
  );
}

function Detail({ a, base, onPaid }: { a: Agreement; base: string; onPaid: () => void }) {
  const borrower = a.role === "borrower";
  return (
    <div className="space-y-5">
      <Link href={`${base}/agreements`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> All agreements</Link>
      {a.status === "late" || a.status === "defaulted" ? (
        <div role="alert" className="flex gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          {a.status === "late"
            ? `${usd(a.due.dueNowCents)} is ${a.due.daysLate} day${a.due.daysLate === 1 ? "" : "s"} late.`
            : "This agreement is in default. Payments are still accepted and go to investors pro rata."}
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <section className="panel p-5">
            <div className="flex items-start gap-4">
              <GradeBadge grade={a.grade} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap gap-1.5"><KindBadge kind={a.kind} /><StatusPill status={a.status} /></div>
                <h2 className="mt-2 text-xl font-bold leading-tight">{a.title}</h2>
                <p className="text-sm text-muted-foreground">{a.displayName} · started {shortDate(a.startAt)}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Figure label="Funded" value={usd(a.principalCents)} />
              <Figure label={a.kind === "revenue_share" ? "Cap" : "Total repayable"} value={usd(a.totalDueCents)} />
              <Figure label="Paid so far" value={usd(a.paidCents)} tone={a.paidCents > 0 ? "good" : undefined} />
              <Figure label={a.kind === "revenue_share" ? "Ends" : "Last installment"} value={shortDate(a.endAt)} />
            </div>
            <FundingBar bps={a.progressBps} className="mt-4" />
            <p className="mt-2 text-xs text-muted-foreground">
              {a.kind === "project_funding"
                ? `${bps(a.rateBps)} flat return, ${a.termMonths} monthly installments.`
                : `${bps(a.shareBps)} of verified revenue for ${a.periodMonths} months, until ${usd(a.capCents)} is paid.`}
            </p>
          </section>

          {a.kind === "project_funding" ? (
            <section className="panel p-0">
              <h3 className="flex items-center gap-2 border-b px-5 py-4 font-semibold"><CalendarClock className="size-4 text-primary" /> Schedule</h3>
              <ol className="divide-y">
                {a.schedule.map((s) => (
                  <li key={s.n} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className={cn("flex size-7 items-center justify-center rounded-full text-xs font-semibold",
                        s.status === "paid" ? "bg-success/15 text-success" : s.status === "overdue" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>
                        {s.status === "paid" ? <CheckCircle2 className="size-4" /> : s.n}
                      </span>
                      <div><p className="font-medium">{shortDate(s.dueAt)}</p><p className="text-xs capitalize text-muted-foreground">{s.status}</p></div>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="font-medium">{usd(s.amountCents)}</p>
                      {s.paidCents > 0 && s.paidCents < s.amountCents && <p className="text-xs text-muted-foreground">{usd(s.paidCents)} paid</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <section className="panel p-5">
              <h3 className="font-semibold">Eligible revenue</h3>
              <p className="mt-1 text-xs text-muted-foreground">Orders the marketplaces&apos; APIs verified and reported completed since {shortDate(a.startAt)}. Self-reported income doesn&apos;t count.</p>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Figure label="Verified revenue" value={usd(a.due.eligibleRevenueCents ?? 0)} />
                <Figure label={`${bps(a.shareBps)} owed to date`} value={usd((a.paidCents ?? 0) + a.due.dueNowCents)} />
              </div>
            </section>
          )}

          <section className="panel p-0">
            <h3 className="border-b px-5 py-4 font-semibold">Payments</h3>
            {a.payments.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">No payments yet.</p> : (
              <ul className="divide-y text-sm">
                {[...a.payments].reverse().map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-5 py-3">
                    <span>{shortDate(p.at)}{!p.posted && <span className="ml-2 text-xs text-warning">processing</span>}</span>
                    <span className="font-semibold tabular-nums">{usd(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          {borrower ? <PayPanel a={a} base={base} onPaid={onPaid} /> : a.myShare && (
            <section className="panel p-5">
              <p className="text-sm font-semibold">Your share</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Figure label="Invested" value={usd(a.myShare.investedCents)} />
                <Figure label="Received" value={usd(a.myShare.receivedCents)} tone={a.myShare.receivedCents > 0 ? "good" : undefined} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">You hold {bps(a.myShare.shareBps)} of this agreement, so you receive that share of every payment.</p>
              <Button variant="outline" size="sm" className="mt-4 w-full" asChild><Link href={`${base}/portfolio`}>Portfolio <ArrowRight /></Link></Button>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function PayPanel({ a, base, onPaid }: { a: Agreement; base: string; onPaid: () => void }) {
  const { toast } = useToast();
  const { data: o, refresh } = useMarketOverview();
  const [amount, setAmount] = React.useState(a.due.dueNowCents ? (a.due.dueNowCents / 100).toFixed(2) : "");
  const [busy, setBusy] = React.useState(false);
  const key = React.useMemo(() => newIdempotencyKey(), [amount]); // eslint-disable-line react-hooks/exhaustive-deps
  const cents = toCents(amount) ?? 0;
  const balance = o?.balances.usdCents ?? 0;
  if (a.status === "completed") {
    return <section className="panel p-5 text-center"><CheckCircle2 className="mx-auto size-8 text-success" /><p className="mt-2 font-semibold">Fully repaid</p></section>;
  }
  const pay = async () => {
    setBusy(true);
    const res = await apiCall(`/api/marketplace/agreements/${a.id}/pay`, { amountCents: cents, idempotencyKey: key });
    setBusy(false);
    if (!res || res.status >= 400) {
      toast({ title: "Payment not made", description: errorText(res?.data) });
      return;
    }
    toast({ title: "Payment sent to investors (simulated)", variant: "success" });
    setAmount("");
    refresh();
    onPaid();
  };
  return (
    <section className="panel space-y-4 p-5">
      <div>
        <p className="text-sm font-semibold">Due now</p>
        <p className="text-3xl font-bold tabular-nums">{usd(a.due.dueNowCents)}</p>
        <p className="text-xs text-muted-foreground">{usd(a.due.remainingCents)} left in total{a.due.nextDueAt ? ` · next ${shortDate(a.due.nextDueAt)}` : ""}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pay-amt">Pay (USD)</Label>
        <Input id="pay-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </div>
      <p className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5"><Wallet className="size-3.5 text-primary" /> Autopilot balance</span>
        <span className="font-semibold tabular-nums">{usd(balance)}</span>
      </p>
      {cents > balance && (
        <p className="text-xs text-muted-foreground">
          Not enough balance. <Link href={`${bankingBase(base)}/transfers?kind=deposit`} className="font-medium text-primary hover:underline">Add money</Link>
        </p>
      )}
      <Button variant="gradient" className="w-full" disabled={busy || !cents || cents > a.due.remainingCents || cents > balance} onClick={() => void pay()}>
        {busy && <Loader2 className="animate-spin" />} Pay {cents ? usd(cents) : ""}
      </Button>
      <p className="text-[11px] text-muted-foreground">Split pro rata among investors the moment you pay. Paying early is allowed.</p>
    </section>
  );
}
