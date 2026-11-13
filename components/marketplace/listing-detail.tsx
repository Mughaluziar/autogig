"use client";
import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, BadgeCheck, CalendarClock, CheckCircle2, Clock, FileText, Layers, Loader2, ShieldAlert,
  ShieldCheck, TrendingUp, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { usd } from "@/lib/capital";
import {
  INDEX_ID, KIND_LABEL, MARKET_RISKS, USE_LABEL, bps, errorText, shortDate, useListing, useMarketOverview, type Listing,
} from "@/lib/marketplace";
import { Figure, Frame, FundingBar, GradeBadge, KindBadge, Loading, StatusPill, marketLinks } from "./common";
import { termsLine } from "./browse";

export function ListingDetail({ id, base, canRaise }: { id: string; base: string; canRaise: boolean }) {
  const links = marketLinks(base, { raise: canRaise });
  if (id === INDEX_ID) return <IndexDetail base={base} canRaise={canRaise} />;
  return (
    <Frame kind="market" links={links} title="Raise" description="Terms, verified track record and risks for this raise.">
      <ListingBody id={id} base={base} />
    </Frame>
  );
}

function ListingBody({ id, base }: { id: string; base: string }) {
  const { data: l, loaded, refresh } = useListing(id);
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<"publish" | "close" | null>(null);
  if (!loaded) return <Loading />;
  if (!l) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">Raise not found</p>
        <p className="mt-1 text-sm text-muted-foreground">It may be a draft, or the link is wrong.</p>
        <Button variant="outline" className="mt-4" asChild><Link href={base}>Back to the marketplace</Link></Button>
      </div>
    );
  }
  const act = async (kind: "publish" | "close") => {
    const question = l.status === "draft" ? "Discard this draft?"
      : l.progressBps >= (l.minCloseBps ?? 5000) ? `Accept ${usd(l.raisedCents)} now and close the raise?`
        : "This raise hasn't reached the minimum, so closing it refunds every investor. Continue?";
    if (kind === "close" && !window.confirm(question)) return;
    setBusy(kind);
    const res = await apiCall(`/api/marketplace/listings/${l.id}/${kind}`, {});
    setBusy(null);
    if (!res || res.status >= 400) {
      toast({ title: kind === "publish" ? "Not published" : "Not closed", description: errorText(res?.data) });
      return;
    }
    toast({ title: kind === "publish" ? "Your raise is live" : "Raise closed", variant: "success" });
    refresh();
  };
  const tr = l.trackRecord;
  const ex = l.example;
  return (
    <div className="space-y-5">
      <Link href={base} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All raises
      </Link>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <section className="panel p-5">
            <div className="flex items-start gap-4">
              <GradeBadge grade={l.grade} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><KindBadge kind={l.kind} /><StatusPill status={l.status} /></div>
                <h2 className="mt-2 text-xl font-bold leading-tight tracking-tight sm:text-2xl">{l.title}</h2>
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <BadgeCheck className="size-4 text-primary" /> {l.displayName} · identity verified
                </p>
              </div>
            </div>
            {l.summary && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{l.summary}</p>}
          </section>

          <section className="panel p-5">
            <h3 className="mb-3 flex items-center gap-2 font-semibold"><FileText className="size-4 text-primary" /> Terms</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Term label="Type" value={KIND_LABEL[l.kind]} />
              {l.kind === "project_funding" ? (
                <>
                  <Term label="Investor return" value={`${bps(l.rateBps)} flat`} />
                  <Term label="Term" value={`${l.terms.termMonths} monthly installments`} />
                </>
              ) : (
                <>
                  <Term label="Revenue share" value={bps(l.terms.shareBps)} />
                  <Term label="Period" value={`${l.terms.periodMonths} months`} />
                  <Term label="Payments stop at" value={`${(l.terms.capBps ?? 15000) / 10000}× what investors put in`} />
                </>
              )}
              <Term label="Minimum investment" value={usd(l.minInvestmentCents)} />
              <Term label="Closes" value={l.closesAt ? shortDate(l.closesAt) : "—"} />
            </dl>
            <div className="mt-4 rounded-xl bg-primary/[0.07] p-4 text-sm">
              <p className="font-medium">If you invest {usd(100_000)}</p>
              <p className="mt-1 text-muted-foreground">
                {ex.kind === "fixed"
                  ? <>You receive <span className="font-semibold text-foreground">{usd(ex.totalCents)}</span> back over {ex.months} months if every installment is paid.</>
                  : <>You receive your share of {bps(ex.shareBps)} of verified revenue for {ex.months} months, up to <span className="font-semibold text-foreground">{usd(ex.maxCents)}</span>. If revenue falls short, so do payments.</>}
              </p>
              {l.ownerEstimate && l.ownerEstimate.monthlyRevenueCents > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  At last year&apos;s verified pace ({usd(l.ownerEstimate.monthlyRevenueCents)}/month), investors as a group would
                  receive about {usd(l.ownerEstimate.projectedPaidCents)} of the {usd(l.ownerEstimate.capCents)} cap. A projection, not a promise.
                </p>
              )}
            </div>
          </section>

          {l.uses.length > 0 && (
            <section className="panel p-5">
              <h3 className="mb-3 font-semibold">Use of funds</h3>
              <ul className="space-y-3">
                {l.uses.map((u, i) => (
                  <li key={i}>
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate">{USE_LABEL[u.category] ?? u.category}{u.note ? ` · ${u.note}` : ""}</span>
                      <span className="shrink-0 font-medium tabular-nums">{usd(u.amountCents)}</span>
                    </div>
                    <FundingBar bps={(u.amountCents * 10_000) / l.targetCents} className="mt-1.5 h-1.5" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel p-5">
            <h3 className="mb-1 flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-primary" /> Verified track record</h3>
            <p className="mb-4 text-xs text-muted-foreground">From orders each marketplace&apos;s own API confirmed. Nothing self-reported. Checked {shortDate(tr.computedAt)}.</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Figure label="Completed work" value={usd(tr.completedValueCents)} />
              <Figure label="Completed orders" value={String(tr.completedOrders)} />
              <Figure label="Last 12 months" value={usd(tr.trailingYearCents)} />
              <Figure label="Cancelled or refunded" value={`${(tr.lossRate * 100).toFixed(1)}%`} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              {tr.platforms.map((p) => <span key={p} className="rounded-full border px-2.5 py-1">{p}</span>)}
              {tr.firstOrderAt && <span className="text-muted-foreground">since {shortDate(tr.firstOrderAt)}</span>}
            </div>
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs">
              <GradeBadge grade={l.grade} /> <span><span className="font-semibold">Grade {l.grade}.</span> {l.gradeNote} Score {tr.score}/100.</span>
            </p>
          </section>

          <RiskList />
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <section className="panel p-5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-2xl font-bold tabular-nums">{usd(l.status === "open" ? l.raisedCents : l.fundedCents)}</p>
              <p className="text-sm text-muted-foreground">of {usd(l.targetCents)}</p>
            </div>
            <FundingBar bps={l.status === "open" ? l.progressBps : 10_000} className="mt-3" />
            <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> {l.investors} investors</span>
              {l.daysLeft != null && <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> {l.daysLeft} days left</span>}
              <span>{termsLine(l)}</span>
            </div>
            {l.myInvestedCents > 0 && (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                <CheckCircle2 className="size-4" /> You&apos;ve invested {usd(l.myInvestedCents)}
              </p>
            )}
            <div className="mt-4 space-y-2">
              {l.mine ? (
                <>
                  {l.status === "draft" && (
                    <Button variant="gradient" className="w-full" disabled={busy !== null} onClick={() => void act("publish")}>
                      {busy === "publish" && <Loader2 className="animate-spin" />} Publish raise
                    </Button>
                  )}
                  {l.status === "open" && (
                    <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => void act("close")}>
                      {busy === "close" && <Loader2 className="animate-spin" />}
                      {l.progressBps >= (l.minCloseBps ?? 5000) ? `Accept ${usd(l.raisedCents)} and close` : "Cancel and refund investors"}
                    </Button>
                  )}
                  {l.status === "draft" && (
                    <Button variant="ghost" className="w-full" disabled={busy !== null} onClick={() => void act("close")}>Discard draft</Button>
                  )}
                  {l.agreementId && (
                    <Button className="w-full" asChild><Link href={`${base}/agreements/${l.agreementId}`}>Repayments <ArrowRight /></Link></Button>
                  )}
                  {l.status === "open" && (
                    <p className="text-xs text-muted-foreground">
                      Funds go to your Autopilot balance when the raise fills, or when you accept it at {bps(l.minCloseBps ?? 5000)} or more.
                      A {bps(l.originationFeeBps ?? 200)} platform fee is taken at funding.
                    </p>
                  )}
                </>
              ) : l.status === "open" ? (
                <Button variant="gradient" size="lg" className="w-full" asChild>
                  <Link href={`${base}/${l.id}/invest`}>Invest from {usd(l.minInvestmentCents)} <ArrowRight /></Link>
                </Button>
              ) : l.agreementId && l.myInvestedCents > 0 ? (
                <Button className="w-full" asChild><Link href={`${base}/agreements/${l.agreementId}`}>View agreement <ArrowRight /></Link></Button>
              ) : (
                <p className="text-center text-sm text-muted-foreground">This raise isn&apos;t taking investments.</p>
              )}
            </div>
          </section>
          <section className="panel space-y-2 p-5 text-xs text-muted-foreground">
            <p className="flex items-start gap-2"><CalendarClock className="mt-0.5 size-3.5 shrink-0 text-primary" /> Money waits in escrow until the raise closes. If it falls short, everyone is refunded in full.</p>
            <p className="flex items-start gap-2"><TrendingUp className="mt-0.5 size-3.5 shrink-0 text-primary" /> Repayments are split pro rata and land in your Autopilot balance.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export function RiskList() {
  return (
    <section className="rounded-2xl border border-warning/30 bg-warning/[0.05] p-5">
      <h3 className="mb-2 flex items-center gap-2 font-semibold"><ShieldAlert className="size-4 text-warning" /> Risks</h3>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        {MARKET_RISKS.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </section>
  );
}

function IndexDetail({ base, canRaise }: { base: string; canRaise: boolean }) {
  const { data: o, loaded } = useMarketOverview();
  return (
    <Frame kind="market" links={marketLinks(base, { raise: canRaise })} title="Platform Index"
      description="One investment, spread evenly across the highest-rated open raises.">
      {!loaded ? <Loading /> : (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/20 via-fuchsia-500/10 to-transparent p-6">
            <Layers className="size-8 text-primary" />
            <h2 className="mt-3 text-2xl font-bold tracking-tight">Invest in the platform, not one bet</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Your money is split evenly across every open raise graded {o?.index.grades.join(" or ") ?? "A or B"}: freelancers and
              agencies with the strongest verified track records. Spreading it lowers the impact of any single business paying late.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:max-w-md">
              <Figure label="High-rated raises open" value={String(o?.index.count ?? 0)} />
              <Figure label="Room to invest" value={usd(o?.index.capacityCents ?? 0)} />
            </div>
            <Button variant="gradient" size="lg" className="mt-5" disabled={!o?.index.count} asChild={Boolean(o?.index.count)}>
              {o?.index.count ? <Link href={`${base}/${INDEX_ID}/invest`}>Invest in the index <ArrowRight /></Link> : <span>No high-rated raises open right now</span>}
            </Button>
          </section>
          <section className="grid gap-4 md:grid-cols-3">
            {[
              ["Even split", "Each raise gets an equal share, at least $25. Anything that can't be placed stays in your balance."],
              ["Only A and B grades", "Grades come from orders the marketplaces' APIs verified: completed value, volume and cancellation rate."],
              ["Same protections", "Escrow until each raise closes, full refunds if one falls short, repayments split pro rata."],
            ].map(([t, d]) => (
              <div key={t} className="panel p-4"><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-muted-foreground">{d}</p></div>
            ))}
          </section>
          <RiskList />
        </div>
      )}
    </Frame>
  );
}
