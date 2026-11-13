"use client";
import * as React from "react";
import Link from "next/link";
import {
  ArrowRight, BadgeCheck, Clock, Layers, Plus, Rocket, Search, ShieldCheck, TrendingUp, Users, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usd } from "@/lib/capital";
import {
  INDEX_ID, bankingBase, bps, useListings, useMarketOverview, type Grade, type Listing, type ListingKind,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { Figure, Frame, FundingBar, GradeBadge, KindBadge, Loading, StatusPill, TrustRow, marketLinks } from "./common";

export function termsLine(l: Pick<Listing, "kind" | "terms" | "rateBps">): string {
  if (l.kind === "project_funding") return `${bps(l.rateBps)} return over ${l.terms.termMonths} months`;
  return `${bps(l.terms.shareBps)} of revenue · ${l.terms.periodMonths} months · capped at ${(l.terms.capBps ?? 15000) / 10000}×`;
}

export function ListingCard({ listing, base }: { listing: Listing; base: string }) {
  const l = listing;
  return (
    <Link href={`${base}/${l.id}`} className="group block min-w-0">
      <article className="panel flex h-full flex-col gap-4 p-4 transition-all group-hover:-translate-y-0.5 group-hover:border-primary/50 sm:p-5">
        <header className="flex items-start gap-3">
          <GradeBadge grade={l.grade} />
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-semibold leading-snug">{l.title}</h3>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <BadgeCheck className="size-3.5 shrink-0 text-primary" /> {l.displayName}
            </p>
          </div>
          {l.status !== "open" && <StatusPill status={l.status} />}
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind={l.kind} />
          <span className="text-xs font-medium">{termsLine(l)}</span>
        </div>
        {l.summary && <p className="line-clamp-2 text-sm text-muted-foreground">{l.summary}</p>}
        <div className="mt-auto space-y-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold tabular-nums">{usd(l.status === "open" ? l.raisedCents : l.fundedCents)}</span>
            <span className="text-xs text-muted-foreground">of {usd(l.targetCents)}</span>
          </div>
          <FundingBar bps={l.status === "open" ? l.progressBps : 10_000} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> {l.investors} investor{l.investors === 1 ? "" : "s"}</span>
            {l.daysLeft != null && <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> {l.daysLeft}d left</span>}
            <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5" /> {usd(l.trackRecord.completedValueCents)} verified</span>
          </div>
        </div>
      </article>
    </Link>
  );
}

const GRADES: Grade[] = ["A", "B", "C", "D", "E"];

export function MarketplaceBrowse({ base, canRaise, verifyHref, poolHref }: {
  base: string; canRaise: boolean; verifyHref: string; poolHref: string;
}) {
  const overview = useMarketOverview();
  const [q, setQ] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<ListingKind | "">("");
  const [grade, setGrade] = React.useState<Grade | "">("");
  const [funded, setFunded] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (grade) params.set("grade", grade);
  if (query) params.set("q", query);
  if (funded) params.set("include", "funded");
  const qs = params.toString();
  const listings = useListings(qs ? `?${qs}` : "");
  const o = overview.data;
  const bank = bankingBase(base);

  return (
    <Frame kind="market" links={marketLinks(base, { raise: canRaise })} title="Marketplace"
      description="Back verified freelancers and agencies directly, or spread your money across the platform's highest-rated raises in one step."
      actions={canRaise ? (
        <Button variant="gradient" asChild><Link href={`${base}/raise`}><Plus /> Raise up to {usd(o?.policy.maxRaiseCents ?? 1_000_000)}</Link></Button>
      ) : undefined}>
      {!overview.loaded ? <Loading /> : !o ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load the marketplace. Refresh to try again.</p>
      ) : (
        <div className="space-y-6">
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/20 via-fuchsia-500/10 to-transparent p-5 sm:p-6">
              <div className="absolute -right-16 -top-16 size-56 rounded-full bg-primary/20 blur-3xl" aria-hidden />
              <p className="relative text-xs font-semibold uppercase tracking-wider text-primary">Invest in the platform</p>
              <h2 className="relative mt-1 text-xl font-bold tracking-tight sm:text-2xl">Less risk, spread evenly across top-rated freelancers</h2>
              <div className="relative mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border bg-card/80 p-4 backdrop-blur">
                  <div className="flex items-center gap-2 font-semibold"><Layers className="size-4 text-primary" /> Platform Index</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    One investment, split evenly across every open raise graded {o.index.grades.join(" or ")}.
                  </p>
                  <p className="mt-3 text-sm"><span className="font-semibold">{o.index.count}</span> raise{o.index.count === 1 ? "" : "s"} · {usd(o.index.capacityCents)} open</p>
                  <Button size="sm" className="mt-3 w-full" disabled={!o.index.count} asChild={o.index.count > 0}>
                    {o.index.count > 0
                      ? <Link href={`${base}/${INDEX_ID}/invest`}>Invest in the index <ArrowRight /></Link>
                      : <span>No high-rated raises open</span>}
                  </Button>
                </div>
                <div className="rounded-xl border bg-card/80 p-4 backdrop-blur">
                  <div className="flex items-center gap-2 font-semibold"><TrendingUp className="size-4 text-primary" /> Early-payment pool</div>
                  <p className="mt-1 text-xs text-muted-foreground">Funds early payments on orders the marketplaces verified. Earns 70% of every fee.</p>
                  <p className="mt-3 text-sm"><span className="font-semibold">{usd(o.pool.navCents)}</span> pool · {usd(o.pool.realisedYieldCents)} earned</p>
                  <Button size="sm" variant="outline" className="mt-3 w-full" asChild>
                    <Link href={poolHref}>Fund the pool <ArrowRight /></Link>
                  </Button>
                </div>
              </div>
            </div>
            <div className="panel flex flex-col gap-4 p-5">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4 text-primary" /> Your balance</p>
                <Link href={bank} className="text-xs font-medium text-primary hover:underline">Banking</Link>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Figure label="USD" value={usd(o.balances.usdCents)} />
                <Figure label="USDC" value={usd(o.balances.usdcCents)} />
              </div>
              <Button variant="outline" size="sm" asChild><Link href={`${bank}/transfers?kind=deposit`}>Add money</Link></Button>
              {o.investorReasons.length > 0 ? (
                <div className="rounded-lg bg-muted/60 p-3 text-xs">
                  <p className="mb-1 font-semibold">Before you can invest</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{o.investorReasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  <Link href={verifyHref} className="mt-2 inline-block font-medium text-primary hover:underline">Verify as an investor →</Link>
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-success"><BadgeCheck className="size-4" /> Verified to invest</p>
              )}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="panel p-4"><Figure label="Open raises" value={String(o.stats.openRaises)} /></div>
            <div className="panel p-4"><Figure label="Being raised" value={usd(o.stats.raisingCents)} /></div>
            <div className="panel p-4"><Figure label="Raises funded" value={String(o.stats.fundedRaises)} /></div>
            <div className="panel p-4"><Figure label="Total funded" value={usd(o.stats.fundedCents)} /></div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search raises, studios, skills…" className="pl-9" aria-label="Search raises" />
              </div>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0 lg:pb-0">
                {([["", "All"], ["project_funding", "Project funding"], ["revenue_share", "Revenue share"]] as const).map(([k, label]) => (
                  <Chip key={k || "all"} active={kind === k} onClick={() => setKind(k)}>{label}</Chip>
                ))}
                <span className="mx-1 w-px shrink-0 bg-border" />
                {GRADES.map((g) => (
                  <Chip key={g} active={grade === g} onClick={() => setGrade(grade === g ? "" : g)} aria-label={`Grade ${g}`}>{g}</Chip>
                ))}
                <span className="mx-1 w-px shrink-0 bg-border" />
                <Chip active={funded} onClick={() => setFunded((v) => !v)}>Show funded</Chip>
              </div>
            </div>
            {!listings.loaded ? <Loading label="Loading raises…" /> : (listings.data ?? []).length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed p-10 text-center">
                <span className="mb-3 rounded-full bg-primary/10 p-3 text-primary"><Rocket className="size-6" /></span>
                <h3 className="font-semibold">{qs ? "No raises match those filters" : "No raises are open yet"}</h3>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {canRaise
                    ? `Freelancers and agencies with a verified track record can raise up to ${usd(o.policy.maxRaiseCents)} for hiring, equipment or growth. Be the first.`
                    : "Raises appear here as soon as verified freelancers and agencies open them. You can fund the early-payment pool in the meantime."}
                </p>
                {canRaise && <Button className="mt-4" variant="gradient" asChild><Link href={`${base}/raise`}>Start a raise</Link></Button>}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(listings.data ?? []).map((l) => <ListingCard key={l.id} listing={l} base={base} />)}
              </div>
            )}
          </section>
          <TrustRow />
        </div>
      )}
    </Frame>
  );
}

function Chip({ active, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button type="button" aria-pressed={active} {...props}
      className={cn("h-9 shrink-0 rounded-full border px-3.5 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
        className)} />
  );
}
