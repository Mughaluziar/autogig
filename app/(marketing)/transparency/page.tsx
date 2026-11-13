"use client";
import * as React from "react";
import { CheckCircle2, Circle, ExternalLink, Landmark, ShieldCheck, Coins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_URL, apiGet } from "@/lib/api";
import { pct, usd } from "@/lib/capital";
import { explorerLink, formatTokens, shortAddress, type Transparency } from "@/lib/token";
import { formatRelative } from "@/lib/utils";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export default function TransparencyPage() {
  const [data, setData] = React.useState<Transparency | null>(null);
  const [loaded, setLoaded] = React.useState(!API_URL);
  React.useEffect(() => {
    if (!API_URL) return;
    void apiGet<Transparency>("/api/token/transparency").then((d) => { setData(d); setLoaded(true); });
  }, []);

  return (
    <div>
      <section className="border-b bg-muted/30 py-16">
        <div className="container max-w-3xl text-center">
          <Badge className="mb-4">Transparency</Badge>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Where the pool&apos;s money is</h1>
          <p className="mt-4 text-muted-foreground">
            The early-payment pool, the protection fund and the pool token, published from the same double-entry ledger the
            platform runs on. When the token is live, its on-chain supply is checked against that ledger on every sync.
          </p>
        </div>
      </section>

      <section className="py-12">
        <div className="container max-w-5xl">
          {!loaded ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : !data ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {API_URL ? "The report isn't available right now. Try again in a minute." : "The report needs the backend; this is the frontend-only demo."}
            </p>
          ) : (
            <div className="space-y-6">
              <p className="text-center text-sm">
                <Badge variant="warning">Settlement: {data.settlement}</Badge>{" "}
                <span className="text-muted-foreground">
                  {data.settlement === "simulated"
                    ? "Figures are recorded in the ledger; no real money has moved yet."
                    : data.chain.mainnet ? "" : `Token figures come from ${data.chain.name}, a test network. Test tokens have no value.`}
                </span>
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><Landmark className="size-4" /> Early-payment pool</CardTitle>
                    <CardDescription>Investor capital that pays freelancers early on orders the marketplace has verified.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <dl className="divide-y">
                      <Row label="Pool value" value={usd(data.pool.navCents)} />
                      <Row label="Cash" value={usd(data.pool.cashCents)} />
                      <Row label="Out in early payments" value={usd(data.pool.outstandingCents)} />
                      <Row label="Kept back for withdrawals" value={usd(data.pool.reserveCents)} />
                      <Row label="Fee income to investors" value={usd(data.pool.realisedYieldCents)} />
                      <Row label="Written off" value={usd(data.pool.writtenOffCents)} />
                      <Row label="Default rate" value={`${(data.pool.defaultRate * 100).toFixed(1)}%`} />
                      <Row label="Share price" value={usd(data.pool.sharePriceCents)} />
                    </dl>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" /> Protection fund</CardTitle>
                    <CardDescription>
                      Funded by fees, not by investor capital. It backs order insurance, but it is discretionary and not a licensed insurer: claims are reviewed and paid only up
                      to the fund&apos;s balance.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <dl className="divide-y">
                      <Row label="Balance" value={usd(data.pool.protectionFundCents)} />
                      <Row label="Paid in claims" value={usd(data.pool.protectionPaidCents)} />
                      <Row label="Each fee goes to investors" value={pct(data.feeSplit.investorShareBps)} />
                      <Row label="…to the protection fund" value={pct(data.feeSplit.protectionShareBps)} />
                      <Row label="…to the platform" value={pct(data.feeSplit.platformShareBps)} />
                    </dl>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><Coins className="size-4" /> Pool token</CardTitle>
                    <CardDescription>A permissioned token for verified investors: one token is one pool share.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!data.enabled ? <p className="text-sm text-muted-foreground">Not launched.</p> : (
                      <dl className="divide-y">
                        <Row label="Network" value={data.chain.name} />
                        <Row label="Supply on-chain" value={formatTokens(data.token.onchainSupply)} />
                        <Row label="Supply in the ledger" value={formatTokens(data.token.ledgerSupply)} />
                        <Row label="Reconciled" value={data.token.reconciled == null ? "—" : data.token.reconciled
                          ? <span className="text-success">Matches at block {data.token.block}</span>
                          : <span className="text-destructive">Mismatch under review</span>} />
                        <Row label="Last checked" value={data.token.reconciledAt ? formatRelative(data.token.reconciledAt) : "—"} />
                        <Row label="Treasury Safe USDC" value={usd(data.token.safeUsdcCents)} />
                        {(["token", "safe"] as const).map((k) => {
                          const a = data.addresses[k];
                          const href = a ? explorerLink(data.chain, "address", a) : null;
                          return <Row key={k} label={k === "token" ? "Token contract" : "Treasury Safe"} value={href
                            ? <a className="inline-flex items-center gap-1 font-mono text-primary" href={href} target="_blank" rel="noreferrer">{shortAddress(a)} <ExternalLink className="size-3" /></a>
                            : <span className="font-mono">{shortAddress(a)}</span>} />;
                        })}
                      </dl>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Launch gate {data.launchGate.done}/{data.launchGate.total}</CardTitle>
                    <CardDescription>The token sale stays closed on mainnet until every step is complete.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5 text-sm">
                      {data.launchGate.items.map((i) => (
                        <li key={i.label} className="flex items-center gap-2">
                          {i.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />} {i.label}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Nothing on this page is an offer to sell or a solicitation to buy securities.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
