"use client";
import * as React from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Stat } from "@/components/credit/common";
import { API_URL } from "@/lib/api";
import { usd } from "@/lib/capital";
import { amount, ratio, type BalanceGroup, type Check, type TreasuryOverview } from "@/lib/treasury";

/** Shown at the top of every treasury view: these are demo-ledger figures, never real funds. */
export function TreasuryNotice() {
  return (
    <div role="note" data-testid="treasury-sim-notice" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs sm:px-4 sm:py-3 sm:text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div>
        <strong>Every figure here is simulated.</strong> These are balances in Autopilot&apos;s internal demo ledger. No real money is held,
        received or paid out, and none of these figures may be reported as real funds.
      </div>
    </div>
  );
}

/** Frontend-only demo, loading, owner-only and failure states, so the page never shows an empty shell. */
export function TreasuryGate({ loaded, denied, failed, retry, children }: {
  loaded: boolean; denied: boolean; failed: boolean; retry: () => void; children: React.ReactNode;
}) {
  if (!API_URL) {
    return <EmptyState icon={<ShieldAlert className="size-6" />} title="Needs the backend"
      description="Treasury reports are built from the server-side ledger, so they aren't available in the frontend-only demo." />;
  }
  if (!loaded) return <p role="status" className="py-10 text-center text-sm text-muted-foreground">Loading treasury…</p>;
  if (denied) {
    return <EmptyState icon={<ShieldAlert className="size-6" />} title="Platform owners only"
      description="Treasury and financial reporting is available to platform owner accounts only." />;
  }
  if (failed) {
    return (
      <div role="alert" className="space-y-3 rounded-lg border p-4 text-sm">
        <p>The treasury could not be loaded. Try again.</p>
        <Button onClick={retry} size="sm">Retry</Button>
      </div>
    );
  }
  return <>{children}</>;
}

export function IntegrityChecks({ checks, ok }: { checks: Check[]; ok: boolean }) {
  const failing = checks.filter((c) => !c.ok).length;
  return (
    <Card className={ok ? undefined : "border-destructive/60"}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-base">Integrity checks</CardTitle>
          <CardDescription>Recomputed from the journal on every load. Any failure needs investigating before figures are shared.</CardDescription>
        </div>
        <Badge variant={ok ? "success" : "destructive"} data-testid="treasury-integrity">{ok ? "All checks pass" : `${failing} failing`}</Badge>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {checks.map((c) => (
            <li key={c.key} className="flex items-start gap-3 py-2.5 text-sm" data-check={c.key} data-ok={c.ok}>
              {c.ok
                ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                : <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c.ok ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                    {c.ok ? "Pass" : "Fail"}
                  </span>
                  {c.label}
                </p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `treasury-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

export function KeyFigures({ kpis }: { kpis: TreasuryOverview["kpis"] }) {
  const { pool, protection: p, platform, credit, customers, escrow, shares, claims } = kpis;
  const claimRows = Object.entries(claims);
  const openClaims = ["eligible", "waiting", "paying"].reduce((n, s) => n + (claims[s]?.count ?? 0), 0);
  return (
    <div className="space-y-5">
      <Section title="Investor pool">
        <Stat label="Net asset value" value={usd(pool.navCents)} hint="Cash plus outstanding early payments" />
        <Stat label="Pool cash" value={usd(pool.cashCents)} tone={pool.cashCents < 0 ? "bad" : undefined} />
        <Stat label="Outstanding" value={usd(pool.outstandingCents)} hint="Early payments not yet repaid" />
        <Stat label="Fee income" value={usd(pool.feeIncomeCents)} hint={`${usd(pool.writtenOffCents)} written off`} tone={pool.writtenOffCents > 0 ? "bad" : undefined} />
      </Section>
      <Section title="Protection fund">
        <Stat label="Fund cash" value={usd(p.cashCents)} tone={p.cashCents < 0 ? "bad" : undefined} />
        <Stat label="Active cover exposure" value={usd(p.activeExposureCents)} hint={plural(p.activeCovers, "active cover")} />
        <Stat label="Coverage ratio" value={ratio(p.coverageRatioBps)} hint="Fund cash ÷ active cover" />
        <Stat label="Premiums and fee share" value={usd(p.premiumsCents + p.feeShareCents)}
          hint={`${usd(p.premiumsCents)} premiums · ${usd(p.feeShareCents)} fee share · ${usd(p.payoutsCents)} paid out`} />
      </Section>
      <Section title="Customers and platform">
        <Stat label="Customer USD balances" value={usd(customers.usdCents)} hint={plural(customers.usdAccounts, "account")} />
        <Stat label="Customer USDC balances" value={usd(customers.usdcCents)} hint={plural(customers.usdcAccounts, "account")} />
        <Stat label="Marketplace escrow" value={usd(escrow.totalCents)} hint={plural(escrow.listings, "raise")} />
        <Stat label="Platform income" value={usd(platform.incomeCents)} hint={`${usd(platform.cashCents)} platform cash`} />
      </Section>
      <Section title="Credit prototype and shares">
        <Stat label="Credit available" value={usd(credit.availableCents)} hint={`${usd(credit.committedCents)} committed · ${usd(credit.outstandingCents)} outstanding`} />
        <Stat label="Credit fees and losses" value={usd(credit.feesCents)} hint={`${usd(credit.lossesCents)} written off`} tone={credit.lossesCents > 0 ? "bad" : undefined} />
        <Stat label="Pool shares issued" value={shares.displayShares.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          hint={`${plural(shares.holderAccounts, "holder")} · ${usd(shares.sharePriceCents)} a share`} />
        <Stat label="Protection claims" value={openClaims.toLocaleString("en-US")} hint="Open: eligible, waiting or paying" />
      </Section>
      {claimRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Claims by status</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left text-sm">
              <caption className="sr-only">Protection claims by status</caption>
              <thead className="text-xs text-muted-foreground">
                <tr><th scope="col" className="py-1">Status</th><th scope="col" className="text-right">Claims</th><th scope="col" className="text-right">Claimed</th><th scope="col" className="text-right">Paid</th></tr>
              </thead>
              <tbody>
                {claimRows.map(([status, c]) => (
                  <tr key={status} className="border-t">
                    <td className="py-1.5 capitalize">{status}</td>
                    <td className="text-right tabular-nums">{c.count}</td>
                    <td className="text-right tabular-nums">{usd(c.amountCents)}</td>
                    <td className="text-right tabular-nums">{usd(c.paidCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GroupCard({ g }: { g: BalanceGroup }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold">
          {g.label}{g.unit !== "USD" && <Badge variant="secondary" className="ml-2 align-middle">{g.unit}</Badge>}
        </h3>
        <span className="shrink-0 text-sm tabular-nums">{amount(g.total, g.unit)}</span>
      </div>
      <dl className="mt-2 space-y-1 text-xs">
        {g.accounts.map((a) => (
          <div key={a.account} className="flex justify-between gap-3">
            <dt className="min-w-0 break-all font-mono text-muted-foreground">{a.account}</dt>
            <dd className="shrink-0 tabular-nums">{amount(a.balance, g.unit)}</dd>
          </div>
        ))}
        {g.aggregate && (
          <div className="flex justify-between gap-3">
            <dt className="min-w-0 text-muted-foreground">{plural(g.aggregate.count, "customer account")} with a balance</dt>
            <dd className="shrink-0 tabular-nums">{amount(g.aggregate.total, g.unit)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function BalanceGroups({ groups }: { groups: BalanceGroup[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Balances by program</CardTitle>
        <CardDescription>
          Ledger sign: debit positive, credit negative, so each unit sums to zero. Accounts that belong to one customer are shown only as a count
          and a total. New accounts appear here automatically, under their program or under Other.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? <p className="text-sm text-muted-foreground">The ledger has no entries yet.</p> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => <GroupCard key={`${g.key}:${g.unit}`} g={g} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
