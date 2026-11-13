"use client";
import * as React from "react";
import Link from "next/link";
import { Bell, BookmarkCheck, Play, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";
import { CompanyAvatar, MatchRing } from "./bits";
import { BASE, jobPay, kindOf, listingHref, readScan } from "./radar-data";
import { usePipeline, useSaved } from "./use-radar";
import { ListSkeleton } from "./job-radar-feed";
import { GigCard } from "@/components/gigs/gig-card";
import type { Kind, Listing } from "./types";

export function SavedView({ kind }: { kind: Kind }) {
  const { user } = useAuth();
  const saved = useSaved();
  const pipe = usePipeline();

  // With a backend, saved listings are stored whole; the frontend-only demo keeps ids, resolved from the last scan.
  const items: Listing[] = React.useMemo(() => {
    if (API_URL) return saved.jobs.filter((j) => kindOf(j) === kind);
    const pool = readScan(user?.id, kind)?.jobs ?? [];
    return pool.filter((j) => saved.savedIds.includes(j.id));
  }, [saved.jobs, saved.savedIds, kind, user?.id]);
  const noun = kind === "gig" ? "gigs" : "roles";

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><BookmarkCheck className="size-4 text-primary" /> Saved {noun}</h2>
        {!saved.loaded ? (
          <ListSkeleton rows={3} />
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing saved yet. Tap the bookmark on any {kind === "gig" ? "gig" : "role"} to keep it here — saved items stay even after they drop out of your scans.
          </div>
        ) : kind === "gig" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((g) => (
              <GigCard key={g.id} gig={g} saved onSave={() => void saved.toggle(g)} isNew={false} stage={pipe.tracked(g.id)?.stage} />
            ))}
          </div>
        ) : (
          <ul className="panel divide-y divide-border/60 overflow-hidden">
            {items.map((j) => (
              <li key={j.id} className="flex items-center gap-3 p-3.5">
                <CompanyAvatar name={j.company} size={40} />
                <Link href={listingHref("job", j.id)} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold hover:text-primary">{j.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {j.company} · {jobPay(j) || j.source}{j.postedAt && ` · ${formatRelative(j.postedAt)}`}
                  </p>
                </Link>
                <MatchRing score={j.matchScore} size={38} className="hidden sm:block" />
                <Button variant="ghost" size="icon" aria-label="Remove from saved" onClick={() => void saved.toggle(j)}>
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Search className="size-4 text-primary" /> Saved searches</h2>
        {saved.searches.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No saved searches. Use the star next to the search box to save one — {API_URL ? "you'll get strong new matches in your scheduled alerts, and " : ""}you can re-run it in one tap.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {saved.searches.map((s) => (
              <div key={s.id} className="panel flex flex-col gap-3 p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.query}</p>
                  </div>
                  {s.alertEnabled && <span title="Included in scheduled alerts"><Bell className="size-4 text-primary" /></span>}
                  <Button variant="ghost" size="icon" className="-mr-2 -mt-2 size-8" aria-label="Remove search" onClick={() => void saved.removeSearch(s)}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {(s.newSinceLast ?? 0) > 0 ? <span className="font-semibold text-success">+{s.newSinceLast} new last scan</span>
                      : s.lastScanAt ? `Scanned ${formatRelative(s.lastScanAt)}` : "Not run here yet"}
                  </span>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`${BASE[kind]}?q=${encodeURIComponent(s.query)}`}><Play /> Run</Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
