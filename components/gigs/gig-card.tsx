"use client";
import * as React from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, BadgeCheck, Users, Gavel } from "lucide-react";
import { cn, formatRelative } from "@/lib/utils";
import { gigBudget, applyHref, listingHref } from "@/components/radar/radar-data";
import type { Listing } from "@/components/radar/types";

/** A stable accent per marketplace, so the grid reads at a glance. */
const PLATFORM_TONE: Record<string, string> = {
  Upwork: "bg-emerald-500", "Freelancer.com": "bg-sky-500", Fiverr: "bg-green-500", Topcoder: "bg-orange-500",
  "Reddit r/forhire": "bg-orange-600", "Hacker News": "bg-amber-500",
};
export const platformDot = (source: string) => PLATFORM_TONE[source] ?? "bg-primary";

export function MatchBar({ score, className }: { score: number; className?: string }) {
  const tone = score >= 80 ? "bg-success" : score >= 60 ? "bg-primary" : "bg-muted-foreground/50";
  return (
    <div className={cn("flex items-center gap-2", className)} title={`${score}% match with your skills`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{score}% match</span>
    </div>
  );
}

export function GigCard({ gig, saved, onSave, isNew, stage }: {
  gig: Listing; saved: boolean; onSave: () => void; isNew: boolean; stage?: string;
}) {
  const { amount, unit } = gigBudget(gig);
  return (
    <article className="group relative flex flex-col rounded-2xl border border-border/70 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn("size-2 rounded-full", platformDot(gig.source))} />
        <span className="truncate font-medium text-foreground/80">{gig.source}</span>
        {gig.postedAt && <span className="shrink-0">· {formatRelative(gig.postedAt)}</span>}
        {isNew && <span className="shrink-0 rounded bg-success/15 px-1 font-bold uppercase text-success">New</span>}
        <button onClick={onSave} aria-label={saved ? "Remove from saved" : "Save gig"}
          className="relative z-10 ml-auto rounded-md p-1 hover:bg-accent">
          {saved ? <BookmarkCheck className="size-4 text-primary" /> : <Bookmark className="size-4" />}
        </button>
      </div>

      <div className="mt-2">
        {amount ? (
          <p className="text-2xl font-extrabold tracking-tight">
            {amount}
            {unit && <span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span>}
          </p>
        ) : (
          <p className="text-sm font-medium text-muted-foreground">Budget not listed</p>
        )}
      </div>

      <h3 className="mt-1.5 line-clamp-2 text-[15px] font-semibold leading-snug">
        <Link href={listingHref("gig", gig.id)} className="after:absolute after:inset-0 group-hover:text-primary">{gig.title}</Link>
      </h3>

      {gig.tags?.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {gig.tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{t}</span>
          ))}
          {gig.tags.length > 3 && <span className="px-1 text-[11px] text-muted-foreground">+{gig.tags.length - 3}</span>}
        </div>
      )}

      <div className="mt-auto pt-4">
        <MatchBar score={gig.matchScore} />
        <div className="mt-3 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
            {typeof gig.proposals === "number" && (
              <span className="flex items-center gap-1"><Users className="size-3" /> {gig.proposals} bid{gig.proposals === 1 ? "" : "s"}</span>
            )}
            {gig.clientVerified && <span className="flex items-center gap-1 text-success"><BadgeCheck className="size-3" /> Verified</span>}
            {stage && <span className="rounded bg-success/15 px-1.5 py-0.5 font-medium text-success">{stage}</span>}
          </div>
          <Link href={applyHref("gig", gig.id)}
            className="relative z-10 flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-purple-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
            <Gavel className="size-3.5" /> Bid
          </Link>
        </div>
      </div>
    </article>
  );
}

export function GigGridSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-2xl border p-4">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-7 w-28 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-1.5 w-full animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
