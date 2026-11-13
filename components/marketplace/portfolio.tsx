"use client";
import * as React from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Coins, PieChart, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/capital";
import { KIND_LABEL, shortDate, usePortfolio, type Grade, type ListingKind, type Portfolio } from "@/lib/marketplace";
import { Figure, Frame, GradeBadge, KindBadge, Loading, StatusPill, marketLinks } from "./common";

const GRADES: Grade[] = ["A", "B", "C", "D", "E"];

export function PortfolioView({ base, canRaise, poolHref }: { base: string; canRaise: boolean; poolHref: string }) {
  const { data, loaded } = usePortfolio();
  return (
    <Frame kind="market" links={marketLinks(base, { raise: canRaise })} title="My portfolio"
      description="Every investment you hold: performance, distributions received and where your risk sits.">
      {!loaded ? <Loading /> : !data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load your portfolio. Refresh to try again.</p>
      ) : <Body data={data} base={base} poolHref={poolHref} />}
    </Frame>
  );
}

function Body({ data, base, poolHref }: { data: Portfolio; base: string; poolHref: string }) {
  const t = data.totals;
  const live = data.positions.filter((p) => !["refunded"].includes(p.investment.status));
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/20 via-fuchsia-500/10 to-transparent p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Marketplace</p>
        <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Figure label="Invested" value={usd(t.investedCents)} hint={`${t.positions} position${t.positions === 1 ? "" : "s"}`} />
          <Figure label="Distributions received" value={usd(t.distributedCents)} tone={t.distributedCents > 0 ? "good" : undefined} />
          <Figure label="Still outstanding" value={usd(t.outstandingCents)} hint={t.escrowCents ? `${usd(t.escrowCents)} in escrow` : undefined} />
          <Figure label="In default" value={usd(t.defaultedCents)} tone={t.defaultedCents > 0 ? "bad" : undefined} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-primary/20 pt-4 text-sm">
          <span className="text-muted-foreground">Early-payment pool</span>
          <span className="font-semibold">{usd(data.pool.valueCents)}</span>
          <span className={data.pool.gainCents < 0 ? "text-destructive" : "text-success"}>{data.pool.gainCents >= 0 ? "+" : ""}{usd(data.pool.gainCents)} gain</span>
          <Link href={poolHref} className="text-primary hover:underline">Manage</Link>
        </div>
      </section>

      {data.positions.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed p-10 text-center">
          <span className="mb-3 rounded-full bg-primary/10 p-3 text-primary"><Coins className="size-6" /></span>
          <h3 className="font-semibold">No investments yet</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Back a verified freelancer or agency, or spread your money across the highest-rated raises with the Platform Index.</p>
          <Button className="mt-4" variant="gradient" asChild><Link href={base}>Browse the marketplace</Link></Button>
        </div>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section className="panel min-w-0 p-5">
              <h3 className="flex items-center gap-2 font-semibold"><TrendingUp className="size-4 text-primary" /> Distributions received</h3>
              <p className="mb-3 text-xs text-muted-foreground">Cumulative repayments paid into your balance.</p>
              <DistributionsChart rows={data.distributions} />
            </section>
            <section className="panel min-w-0 p-5">
              <h3 className="flex items-center gap-2 font-semibold"><PieChart className="size-4 text-primary" /> Risk</h3>
              <p className="mb-3 text-xs text-muted-foreground">Open positions by risk grade and type.</p>
              <RiskBars data={data} />
            </section>
          </div>

          <section className="panel min-w-0 p-0">
            <h3 className="border-b px-5 py-4 font-semibold">Positions</h3>
            <ul className="divide-y">
              {live.map((p) => {
                const inv = p.investment;
                const expected = p.expected?.kind === "fixed" ? p.expected.totalCents : p.expected?.kind === "capped" ? p.expected.maxCents : null;
                return (
                  <li key={inv.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] md:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <GradeBadge grade={inv.grade} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.listing?.title ?? inv.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <KindBadge kind={inv.kind} />
                          <StatusPill status={p.agreement?.status === "late" || p.agreement?.status === "defaulted" ? p.agreement.status : inv.status} />
                          {inv.via === "index" && <span className="text-[11px] text-muted-foreground">via Index</span>}
                        </div>
                      </div>
                    </div>
                    <Cell label="Invested" value={usd(inv.amountCents)} />
                    <Cell label="Received" value={usd(p.distributedCents)} />
                    <Cell label={p.expected?.kind === "capped" ? "Up to" : "Expected"} value={expected != null ? usd(expected) : "—"} />
                    {p.agreement ? (
                      <Button size="sm" variant="ghost" asChild><Link href={`${base}/agreements/${p.agreement.id}`}>Agreement <ArrowRight /></Link></Button>
                    ) : p.listing ? (
                      <Button size="sm" variant="ghost" asChild><Link href={`${base}/${p.listing.id}`}>Raise <ArrowRight /></Link></Button>
                    ) : <span />}
                  </li>
                );
              })}
            </ul>
          </section>

          {data.distributions.length > 0 && (
            <section className="panel min-w-0 p-0">
              <h3 className="border-b px-5 py-4 font-semibold">Distribution history</h3>
              <ul className="divide-y text-sm">
                {data.distributions.slice(0, 30).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0"><p className="truncate">{d.title}</p><p className="text-xs text-muted-foreground">{shortDate(d.at)}</p></div>
                    <span className="shrink-0 font-semibold tabular-nums text-success">+{usd(d.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 md:block">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}

function DistributionsChart({ rows }: { rows: Portfolio["distributions"] }) {
  const series = React.useMemo(() => {
    let total = 0;
    return [...rows].sort((a, b) => a.at.localeCompare(b.at)).map((d) => {
      total += d.amountCents;
      return { date: shortDate(d.at), total: total / 100 };
    });
  }, [rows]);
  if (series.length === 0) {
    return <p className="flex h-48 items-center justify-center rounded-xl bg-muted/40 text-center text-sm text-muted-foreground">Repayments will chart here as they arrive.</p>;
  }
  const data = series.length === 1 ? [{ date: "Start", total: 0 }, ...series] : series;
  return (
    <div className="h-56 w-full" role="img" aria-label={`Cumulative distributions: ${usd(Math.round(series[series.length - 1].total * 100))}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: -8, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="gDist" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={56}
            tickFormatter={(v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
          <Tooltip cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))" }}
            formatter={(v: number) => [usd(Math.round(v * 100)), "Received"]} />
          <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gDist)" activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function RiskBars({ data }: { data: Portfolio }) {
  const grades = GRADES.map((g) => [g, data.risk.byGrade[g] ?? 0] as const).filter(([, v]) => v > 0);
  const kinds = (Object.keys(KIND_LABEL) as ListingKind[]).map((k) => [k, data.risk.byKind[k] ?? 0] as const).filter(([, v]) => v > 0);
  const total = grades.reduce((n, [, v]) => n + v, 0);
  if (!total) return <p className="text-sm text-muted-foreground">No open positions. Repaid and refunded investments don&apos;t carry risk.</p>;
  return (
    <div className="space-y-4">
      <ul className="space-y-2.5">
        {grades.map(([g, v]) => (
          <li key={g} className="flex items-center gap-3 text-sm">
            <GradeBadge grade={g} />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(v / total) * 100}%`, opacity: 1 - GRADES.indexOf(g) * 0.15 }} />
            </div>
            <span className="w-24 text-right tabular-nums">{usd(v)}</span>
          </li>
        ))}
      </ul>
      <ul className="space-y-1 border-t pt-3 text-sm">
        {kinds.map(([k, v]) => (
          <li key={k} className="flex justify-between gap-2"><span className="text-muted-foreground">{KIND_LABEL[k]}</span><span className="tabular-nums">{usd(v)} · {Math.round((v / total) * 100)}%</span></li>
        ))}
      </ul>
    </div>
  );
}
