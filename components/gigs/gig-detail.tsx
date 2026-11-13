"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, BadgeCheck, Bookmark, BookmarkCheck, Clock, Crown, ExternalLink, EyeOff, Gavel, Users, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaywallDialog } from "@/components/dashboard/paywall";
import { cn, formatRelative } from "@/lib/utils";
import { Prose } from "@/components/radar/bits";
import { BASE, applyHref, gigBudget, hostOf, matchBreakdown, skillList } from "@/components/radar/radar-data";
import { useCredits, useListing, usePipeline, useSaved, useSkills } from "@/components/radar/use-radar";
import { DetailSkeleton, NotFound, SourceNote } from "@/components/radar/job-detail";
import { stageLabel } from "@/components/radar/pipeline-board";
import { GigCard, MatchBar, platformDot } from "./gig-card";
import { ManualSubmitNotice } from "./manual-submit-notice";
import { isUpwork } from "@/components/radar/radar-data";
import { apiCall } from "@/lib/api";

export function GigDetail({ id }: { id: string }) {
  const router = useRouter();
  const { listing, similar, loading, partial } = useListing(id);
  const { skills } = useSkills();
  const saved = useSaved();
  const pipe = usePipeline();
  const { isPro, bidCredits } = useCredits();
  const [paywall, setPaywall] = React.useState(false);

  if (!listing) return loading ? <DetailSkeleton /> : <NotFound kind="gig" />;

  const { amount, unit } = gigBudget(listing);
  const mine = skillList(skills);
  const { matched } = matchBreakdown(listing, mine);
  const matchedLower = new Set(matched.map((m) => m.toLowerCase()));
  const tagMatches = (t: string) => Array.from(matchedLower).some((m) => t.toLowerCase().includes(m) || m.includes(t.toLowerCase()));
  const app = pipe.tracked(listing.id);
  const isSaved = saved.savedIds.includes(listing.id);
  const host = hostOf(listing.url);
  const bidLabel = app && !["Saved", "Drafted"].includes(app.stage) ? "View your bid" : app?.stage === "Drafted" ? "Finish your bid" : "Place a bid";

  const BudgetCard = (
    <section className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card to-fuchsia-500/10 p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        {listing.rateType === "hourly" ? "Hourly rate" : listing.rateType === "fixed" ? "Fixed budget" : "Budget"}
      </p>
      {amount ? (
        <p className="mt-1 text-4xl font-extrabold tracking-tight">{amount}<span className="ml-1 text-base font-medium text-muted-foreground">{unit}</span></p>
      ) : (
        <p className="mt-1 text-lg font-semibold text-muted-foreground">Not listed — the client asks for quotes</p>
      )}
      <Button variant="gradient" size="lg" className="mt-4 w-full" asChild>
        <Link href={applyHref("gig", listing.id)}><Gavel /> {bidLabel}</Link>
      </Button>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" className="flex-1 bg-background/60" onClick={() => void saved.toggle(listing)}>
          {isSaved ? <BookmarkCheck className="text-primary" /> : <Bookmark />} {isSaved ? "Saved" : "Save"}
        </Button>
        <Button variant="outline" className="flex-1 bg-background/60" asChild>
          <a href={listing.url} target="_blank" rel="noopener noreferrer"><ExternalLink /> {listing.source.split(" ")[0]}</a>
        </Button>
      </div>
      <button onClick={() => !isPro && setPaywall(true)} disabled={isPro}
        className="mt-4 flex w-full items-center gap-2 rounded-xl bg-background/60 p-2.5 text-left text-xs">
        {isPro ? <Crown className="size-4 text-warning" /> : <Zap className="size-4 text-primary" />}
        <span className="flex-1">{isPro ? "Pro — unlimited bids" : <><span className="font-semibold">{bidCredits}</span> bid credit{bidCredits === 1 ? "" : "s"} left · spent only when an auto-apply is actually sent</>}</span>
        {!isPro && <span className="font-medium text-primary">Top up</span>}
      </button>
    </section>
  );

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <Link href={BASE.gig} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Gigs
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-6">
          <header>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-foreground">
                <span className={cn("size-2 rounded-full", platformDot(listing.source))} /> {listing.source}
              </span>
              {listing.postedAt && <span className="flex items-center gap-1"><Clock className="size-3" /> Posted {formatRelative(listing.postedAt)}</span>}
              {app && <span className="rounded-full bg-success/15 px-2 py-0.5 font-medium text-success">{stageLabel("gig", app.stage)}</span>}
            </div>
            <h1 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight md:text-4xl">{listing.title}</h1>
          </header>

          {isUpwork(listing) && (
            <div className="space-y-2">
              <ManualSubmitNotice url={listing.url} />
              {listing.leadId && (
                <Button variant="ghost" size="sm" className="text-muted-foreground"
                  onClick={async () => { await apiCall(`/api/upwork/leads/${encodeURIComponent(listing.leadId!)}`, { status: "dismissed" }, "PATCH"); router.push(BASE.gig); }}>
                  Remove this job from my list
                </Button>
              )}
            </div>
          )}

          {/* Budget on phones sits right under the title */}
          <div className="lg:hidden">{BudgetCard}</div>

          <section className="grid gap-3 sm:grid-cols-3">
            <Fact label="Your match" value={<MatchBar score={listing.matchScore} className="mt-2" />} />
            <Fact label="Competition" value={typeof listing.proposals === "number" ? <span className="flex items-center gap-1.5"><Users className="size-4 text-muted-foreground" /> {listing.proposals} bids so far</span> : <span className="text-muted-foreground">Not reported</span>} />
            <Fact label="Client" value={
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{listing.company}</span>
                {listing.clientVerified && <BadgeCheck className="size-4 shrink-0 text-success" aria-label="Payment verified" />}
              </span>} />
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Project details</h2>
            {listing.description ? <Prose text={listing.description} className="text-[15px]" /> : <p className="text-sm text-muted-foreground">The client didn&apos;t include a description.</p>}
          </section>

          {listing.tags?.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Skills wanted</h2>
              <div className="flex flex-wrap gap-2">
                {listing.tags.map((t) => (
                  <span key={t} className={cn("rounded-full border px-3 py-1 text-sm",
                    tagMatches(t) ? "border-success/40 bg-success/10 text-success" : "text-muted-foreground")}>
                    {tagMatches(t) && "✓ "}{t}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border p-4">
            <p className="text-sm font-semibold">About the client</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {listing.company}{listing.clientVerified ? " — payment method verified." : "."} Reviews, hire rate and total spend aren&apos;t shared with
              {" "}Autopilot; check them on{" "}
              <a href={listing.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{host || listing.source}</a> before you bid.
            </p>
          </section>

          <SourceNote listing={listing} partial={partial} />

          <Button variant="ghost" className="text-muted-foreground" onClick={() => { pipe.dismiss(listing.id); router.push(BASE.gig); }}>
            <EyeOff /> Not for me — hide this gig
          </Button>
        </main>

        <aside className="hidden lg:block">
          <div className="sticky top-0 space-y-4">{BudgetCard}</div>
        </aside>
      </div>

      {similar.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">More gigs like this</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {similar.slice(0, 3).map((g) => (
              <GigCard key={g.id} gig={g} saved={saved.savedIds.includes(g.id)} onSave={() => void saved.toggle(g)} isNew={false}
                stage={pipe.tracked(g.id)?.stage} />
            ))}
          </div>
        </section>
      )}

      {/* Phone bid bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-card/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">{listing.rateType === "hourly" ? "Hourly" : "Budget"}</p>
            <p className="truncate font-bold">{amount ? `${amount}${unit === "/hr" ? "/hr" : ""}` : "Open to quotes"}</p>
          </div>
          <Button variant="gradient" asChild><Link href={applyHref("gig", listing.id)}><Gavel /> {bidLabel}</Link></Button>
        </div>
      </div>

      <PaywallDialog open={paywall} onOpenChange={setPaywall} kind="bids" />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}
