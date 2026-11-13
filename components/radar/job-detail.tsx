"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Bookmark, BookmarkCheck, ExternalLink, EyeOff, Globe, Info, Kanban, Radar, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn, formatRelative } from "@/lib/utils";
import { CompanyAvatar, Chip, MatchRing, Prose } from "./bits";
import { BASE, applyHref, facets, hostOf, jobPay, listingHref, matchBreakdown, skillList } from "./radar-data";
import { usePipeline, useListing, useSaved, useSkills } from "./use-radar";
import { stageLabel } from "./pipeline-board";
import { STAGES, type Listing, type Stage } from "./types";

export function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="panel space-y-3 p-6">
        <div className="flex gap-4">
          <div className="size-14 animate-pulse rounded-2xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}

export function NotFound({ kind }: { kind: "job" | "gig" }) {
  return (
    <div className="panel mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-14 text-center">
      <Radar className="size-10 text-muted-foreground/50" />
      <h1 className="text-lg font-semibold">This listing isn&apos;t available any more</h1>
      <p className="text-sm text-muted-foreground">
        It isn&apos;t in your recent scans, saved items or pipeline. Listings expire on their source; run a new scan to find it again.
      </p>
      <Button variant="gradient" asChild><Link href={BASE[kind]}>{kind === "gig" ? "Back to gigs" : "Back to Job Radar"}</Link></Button>
    </div>
  );
}

export function SourceNote({ listing, partial }: { listing: Listing; partial: boolean }) {
  const host = hostOf(listing.url);
  return (
    <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {partial || listing.truncated ? "This is a summary of the listing. " : ""}
        Listed on <span className="font-medium text-foreground">{listing.source}</span>. The original posting on{" "}
        <a href={listing.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{host || "the source"}</a>{" "}
        is always the source of truth — you apply there.
      </span>
    </p>
  );
}

export function JobDetail({ id }: { id: string }) {
  const router = useRouter();
  const { listing, similar, loading, partial } = useListing(id);
  const { skills } = useSkills();
  const saved = useSaved();
  const pipe = usePipeline();

  if (!listing) return loading ? <DetailSkeleton /> : <NotFound kind="job" />;

  const f = facets(listing);
  const pay = jobPay(listing);
  const { matched, missing } = matchBreakdown(listing, skillList(skills));
  const app = pipe.tracked(listing.id);
  const isSaved = saved.savedIds.includes(listing.id);

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <Link href={BASE.job} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Job Radar
      </Link>

      {/* Header */}
      <header className="panel relative overflow-hidden p-5 md:p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-fuchsia-500 to-cyan-400" />
        <div className="flex flex-col gap-5 md:flex-row md:items-start">
          <CompanyAvatar name={listing.company} size={60} className="rounded-2xl" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold leading-tight tracking-tight md:text-3xl">{listing.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{listing.company}</span> · {listing.source}
              {listing.postedAt && <> · posted {formatRelative(listing.postedAt)}</>}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {f.workplace && <Chip className="text-xs"><Globe className="size-3" /> {f.workplace}</Chip>}
              {f.type && <Chip className="text-xs">{f.type}</Chip>}
              {f.seniority && <Chip className="text-xs">{f.seniority}</Chip>}
              {app && <Chip tone="success" className="text-xs">{stageLabel("job", app.stage)}</Chip>}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-3 md:items-end">
            {pay && <p className="text-2xl font-bold tracking-tight md:text-right">{pay}</p>}
            <div className="hidden gap-2 lg:flex">
              <Button variant="outline" size="icon" onClick={() => void saved.toggle(listing)} title={isSaved ? "Remove from saved" : "Save for later"}>
                {isSaved ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
              </Button>
              <Button variant="outline" asChild>
                <a href={listing.url} target="_blank" rel="noopener noreferrer"><ExternalLink /> Original</a>
              </Button>
              <Button variant="gradient" asChild>
                <Link href={applyHref("job", listing.id)}><Sparkles /> {app && app.stage !== "Saved" ? "Continue application" : "Apply"}</Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-12">
        <main className="space-y-5 lg:col-span-8">
          <section className="panel space-y-4 p-5 md:p-6">
            <h2 className="text-base font-semibold">About the role</h2>
            {listing.description ? <Prose text={listing.description} /> : <p className="text-sm text-muted-foreground">The source didn&apos;t include a description.</p>}
            {listing.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">{listing.tags.map((t) => <Chip key={t} className="text-xs">{t}</Chip>)}</div>
            )}
            <SourceNote listing={listing} partial={partial} />
          </section>

          {similar.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Similar roles</h2>
              <ul className="panel divide-y divide-border/60 overflow-hidden">
                {similar.map((s) => (
                  <li key={s.id}>
                    <Link href={listingHref("job", s.id)} className="flex items-center gap-3 p-3.5 transition-colors hover:bg-accent/40">
                      <CompanyAvatar name={s.company} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.company} · {jobPay(s) || s.source}</p>
                      </div>
                      <MatchRing score={s.matchScore} size={36} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>

        <aside className="space-y-4 lg:col-span-4">
          <section className="panel p-5">
            <div className="flex items-center gap-4">
              <MatchRing score={listing.matchScore} size={64} />
              <div>
                <p className="font-semibold">Your match</p>
                <p className="text-sm text-muted-foreground">
                  {skillList(skills).length ? `${matched.length} of ${skillList(skills).length} of your skills appear in this listing` : "Add skills on the feed to see your match"}
                </p>
              </div>
            </div>
            {(matched.length > 0 || missing.length > 0) && (
              <div className="mt-4 space-y-2 text-xs">
                {matched.length > 0 && (
                  <div className="flex flex-wrap gap-1">{matched.map((s) => <Chip key={s} tone="success">✓ {s}</Chip>)}</div>
                )}
                {missing.length > 0 && (
                  <div>
                    <p className="mb-1 text-muted-foreground">Not mentioned</p>
                    <div className="flex flex-wrap gap-1">{missing.map((s) => <Chip key={s}>{s}</Chip>)}</div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="panel space-y-3 p-5">
            <p className="flex items-center gap-2 font-semibold"><Kanban className="size-4 text-primary" /> Your pipeline</p>
            {app ? (
              <>
                <Select value={app.stage} aria-label="Stage"
                  onChange={(e) => {
                    const stage = e.target.value as Stage;
                    const now = new Date().toISOString();
                    pipe.patch(app.id, { stage, stageChangedAt: now, ...(stage === "Applied" && !app.submittedAt ? { submittedAt: now, appliedAt: now } : {}) });
                  }}>
                  {STAGES.map((s) => <option key={s} value={s}>{stageLabel("job", s)}</option>)}
                </Select>
                <p className="text-xs text-muted-foreground">Tracked {formatRelative(app.appliedAt)}. <Link href={`${BASE.job}/pipeline`} className="text-primary hover:underline">Open pipeline</Link></p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Not tracked yet. Track it to get it on your board and count it toward your weekly goal.</p>
                <Button variant="outline" className="w-full" onClick={() => pipe.track(listing, "Saved")}>Track this role</Button>
              </>
            )}
          </section>

          <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => { pipe.dismiss(listing.id); router.push(BASE.job); }}>
            <EyeOff /> Not interested — hide it from my feed
          </Button>
        </aside>
      </div>

      {/* Phone action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-card/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl gap-2">
          <Button variant="outline" size="icon" className="shrink-0" onClick={() => void saved.toggle(listing)} aria-label={isSaved ? "Remove from saved" : "Save for later"}>
            {isSaved ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
          </Button>
          <Button variant="outline" size="icon" className="shrink-0" asChild>
            <a href={listing.url} target="_blank" rel="noopener noreferrer" aria-label="Open original"><ExternalLink /></a>
          </Button>
          <Button variant="gradient" className={cn("flex-1")} asChild>
            <Link href={applyHref("job", listing.id)}><Sparkles /> {app && app.stage !== "Saved" ? "Continue application" : "Apply now"}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
