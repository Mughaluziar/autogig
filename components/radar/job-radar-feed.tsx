"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Bookmark, BookmarkCheck, Briefcase, Building2, ExternalLink, Flame, Loader2, Radar,
  RotateCcw, Search, SlidersHorizontal, Sparkles, Star, X, Kanban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { API_URL } from "@/lib/api";
import { cn, formatRelative } from "@/lib/utils";
import { MatchRing, CompanyAvatar, Chip, SubNav, GoalRing, Prose } from "./bits";
import {
  BASE, ageMs, applyHref, facets, hostOf, jobPay, listingHref, matchBreakdown, skillList, type Facets,
} from "./radar-data";
import { usePipeline, useRadarFeed, useSaved } from "./use-radar";
import { SaveSearchDialog } from "./save-search-dialog";
import type { Listing } from "./types";

type Filters = {
  source: string; workplace: string; type: string; seniority: string;
  minPay: number; posted: number; minMatch: number; salaryOnly: boolean; sort: "match" | "new" | "pay";
};
const DEFAULT_FILTERS: Filters = {
  source: "All", workplace: "Any", type: "Any", seniority: "Any", minPay: 0, posted: 0, minMatch: 0, salaryOnly: false, sort: "match",
};

const PRESETS = [
  { label: "Frontend", q: "react, typescript, next.js" },
  { label: "Backend", q: "python, django, api" },
  { label: "Full-stack", q: "node, react, postgres" },
  { label: "Design", q: "figma, ui design, ux" },
  { label: "Data", q: "sql, python, analytics" },
  { label: "DevOps", q: "aws, kubernetes, terraform" },
  { label: "Mobile", q: "react native, ios, flutter" },
];

export function JobRadarNav() {
  const { apps } = usePipeline();
  const { savedIds } = useSaved();
  const jobs = apps.filter((a) => a.kind !== "gig").length;
  return (
    <SubNav items={[
      { href: BASE.job, label: "Feed", icon: Radar, exact: true },
      { href: `${BASE.job}/pipeline`, label: "Pipeline", icon: Kanban, count: jobs },
      { href: `${BASE.job}/saved`, label: "Saved", icon: Bookmark, count: savedIds.length },
      ...(API_URL ? [{ href: `${BASE.job}/companies`, label: "Companies", icon: Building2 }] : []),
    ]} />
  );
}

export function JobRadarHeader() {
  const pipe = usePipeline();
  const { goal, streak } = pipe;
  const weekly = pipe.weekly("job");
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="relative flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-lg shadow-primary/30">
          <Radar className="size-5" />
          <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-success ring-2 ring-background" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Job Radar</h1>
          <p className="text-sm text-muted-foreground">Roles from public job boards and approved APIs, ranked by fit.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-medium",
          streak > 0 ? "border-orange-500/30 bg-orange-500/10 text-orange-500" : "text-muted-foreground")}
          title="Days in a row you scanned">
          <Flame className="size-3.5" /> {streak}d streak
        </span>
        <Link href={`${BASE.job}/pipeline`} className="flex items-center gap-2 rounded-full border px-2 py-1 font-medium hover:border-primary/50"
          title="Applications sent in the last 7 days vs. your weekly goal">
          <GoalRing value={weekly} goal={goal} size={22} />
          <span className="tabular-nums">{weekly}/{goal}</span>
          <span className="text-muted-foreground">this week</span>
        </Link>
      </div>
    </div>
  );
}

export function JobRadarFeed() {
  const router = useRouter();
  const feed = useRadarFeed("job");
  const saved = useSaved();
  const pipe = usePipeline();
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // "Run" on a saved search links here with ?q= — scan it once, then clean the URL.
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      router.replace(BASE.job);
      void feed.scan(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = React.useMemo(() => feed.jobs.map((j) => ({ j, f: facets(j) })), [feed.jobs]);
  const visible = React.useMemo(() => {
    const out = rows.filter(({ j, f }) =>
      !pipe.dismissed.includes(j.id)
      && (filters.source === "All" || j.source === filters.source)
      && (filters.workplace === "Any" || f.workplace === filters.workplace)
      && (filters.type === "Any" || f.type === filters.type)
      && (filters.seniority === "Any" || f.seniority === filters.seniority)
      && (!filters.salaryOnly || !!j.budget)
      && (!filters.minPay || (j.budget ?? 0) >= filters.minPay)
      && (!filters.posted || ageMs(j.postedAt) <= filters.posted * 86_400_000)
      && j.matchScore >= filters.minMatch);
    out.sort((a, b) =>
      filters.sort === "new" ? ageMs(a.j.postedAt) - ageMs(b.j.postedAt)
      : filters.sort === "pay" ? (b.j.budget ?? 0) - (a.j.budget ?? 0)
      : b.j.matchScore - a.j.matchScore);
    return out;
  }, [rows, filters, pipe.dismissed]);

  const selected = visible.find((r) => r.j.id === selectedId) ?? visible[0] ?? null;
  const newCount = feed.jobs.filter(feed.isNew).length;
  const activeFilters = (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[])
    .filter((k) => k !== "sort" && filters[k] !== DEFAULT_FILTERS[k]).length;

  const open = (j: Listing) => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) setSelectedId(j.id);
    else router.push(listingHref("job", j.id));
  };

  const quick: { label: string; on: boolean; toggle: () => void }[] = [
    { label: "Remote", on: filters.workplace === "Remote", toggle: () => setFilters((f) => ({ ...f, workplace: f.workplace === "Remote" ? "Any" : "Remote" })) },
    { label: "Full-time", on: filters.type === "Full-time", toggle: () => setFilters((f) => ({ ...f, type: f.type === "Full-time" ? "Any" : "Full-time" })) },
    { label: "Senior", on: filters.seniority === "Senior", toggle: () => setFilters((f) => ({ ...f, seniority: f.seniority === "Senior" ? "Any" : "Senior" })) },
    { label: "Shows salary", on: filters.salaryOnly, toggle: () => setFilters((f) => ({ ...f, salaryOnly: !f.salaryOnly })) },
    { label: "Last 24h", on: filters.posted === 1, toggle: () => setFilters((f) => ({ ...f, posted: f.posted === 1 ? 0 : 1 })) },
    { label: "70%+ match", on: filters.minMatch === 70, toggle: () => setFilters((f) => ({ ...f, minMatch: f.minMatch === 70 ? 0 : 70 })) },
  ];

  return (
    <div className="space-y-4">
      <JobRadarHeader />
      <JobRadarNav />

      {/* Command bar */}
      <div className="panel p-3 md:p-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void feed.scan(); }}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={feed.skills} onChange={(e) => feed.setSkills(e.target.value)} className="h-11 pl-9"
              placeholder="Your skills, comma separated" aria-label="Skills to match" />
          </div>
          <Button type="submit" variant="gradient" className="h-11 shrink-0 px-4" disabled={feed.loading}>
            {feed.loading ? <Loader2 className="animate-spin" /> : <Radar />}
            <span className="hidden sm:inline">{feed.loading ? "Scanning…" : "Scan"}</span>
          </Button>
          <Button type="button" variant="outline" className="relative h-11 shrink-0 px-3" onClick={() => setFilterOpen(true)} aria-label="Filters">
            <SlidersHorizontal />
            <span className="hidden md:inline">Filters</span>
            {activeFilters > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{activeFilters}</span>
            )}
          </Button>
          <Button type="button" variant="outline" className="hidden h-11 shrink-0 px-3 sm:inline-flex" onClick={() => setSaveOpen(true)} title="Save this search">
            <Star />
          </Button>
        </form>

        {/* Saved searches, or presets for a first run */}
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {saved.searches.length > 0 ? (
            <>
              <span className="shrink-0 self-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Saved</span>
              {saved.searches.map((s) => (
                <button key={s.id} onClick={() => void feed.scan(s.query)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:border-primary hover:text-primary">
                  {s.name}
                  {(s.newSinceLast ?? 0) > 0 && <span className="rounded-full bg-success/15 px-1.5 text-[10px] font-bold text-success">+{s.newSinceLast}</span>}
                </button>
              ))}
            </>
          ) : (
            <>
              <span className="shrink-0 self-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Try</span>
              {PRESETS.map((p) => (
                <button key={p.label} onClick={() => void feed.scan(p.q)}
                  className={cn("shrink-0 rounded-full border px-3 py-1 text-xs transition-colors hover:border-primary hover:text-primary",
                    feed.skills === p.q && "border-primary bg-primary/10 text-primary")}>
                  {p.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {feed.jobs.length === 0 ? (
        feed.loading ? <ListSkeleton /> : <QuietRadar onScan={(q) => void feed.scan(q)} loading={feed.loading} />
      ) : (
        <>
          {/* Quick filters + summary */}
          <div className="space-y-2">
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:px-0 [scrollbar-width:none]">
              {quick.map((c) => (
                <button key={c.label} onClick={c.toggle} aria-pressed={c.on}
                  className={cn("shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    c.on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:border-primary/50 hover:text-foreground")}>
                  {c.label}
                </button>
              ))}
              {activeFilters > 0 && (
                <button onClick={() => setFilters(DEFAULT_FILTERS)} className="flex shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground">
                  <RotateCcw className="size-3" /> Reset
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">{visible.length}</span> of {feed.jobs.length} roles
                {newCount > 0 && <> · <span className="font-semibold text-success">{newCount} new</span></>}
                {" "}· {feed.sources.length} source{feed.sources.length === 1 ? "" : "s"}
                {feed.fetchedAt && <> · scanned {formatRelative(feed.fetchedAt)}</>}
              </p>
              <Select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as Filters["sort"] }))}
                className="h-8 w-36 text-xs" aria-label="Sort">
                <option value="match">Best match</option>
                <option value="new">Newest</option>
                <option value="pay">Highest pay</option>
              </Select>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="panel flex flex-col items-center gap-3 px-6 py-14 text-center">
              <SlidersHorizontal className="size-8 text-muted-foreground/50" />
              <p className="font-medium">No roles match these filters</p>
              <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}><RotateCcw /> Reset filters</Button>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-12">
              <ul className="panel divide-y divide-border/60 overflow-hidden lg:col-span-7">
                {visible.map(({ j, f }) => (
                  <JobRow key={j.id} job={j} f={f} isNew={feed.isNew(j)} saved={saved.savedIds.includes(j.id)}
                    stage={pipe.tracked(j.id)?.stage} active={selected?.j.id === j.id} onOpen={() => open(j)} />
                ))}
              </ul>
              <div className="hidden lg:col-span-5 lg:block">
                {selected && (
                  <JobPreview job={selected.j} f={selected.f} skills={skillList(feed.lastQuery || feed.skills)}
                    saved={saved.savedIds.includes(selected.j.id)} onSave={() => void saved.toggle(selected.j)}
                    onDismiss={() => { pipe.dismiss(selected.j.id); setSelectedId(null); }} />
                )}
              </div>
            </div>
          )}
        </>
      )}

      <FilterDialog open={filterOpen} onOpenChange={setFilterOpen} filters={filters} setFilters={setFilters}
        sources={feed.sources} count={visible.length} />
      <SaveSearchDialog open={saveOpen} onOpenChange={setSaveOpen} query={feed.skills} onSave={saved.saveSearch} noun="roles" />
    </div>
  );
}

function JobRow({ job, f, isNew, saved, stage, active, onOpen }: {
  job: Listing; f: Facets; isNew: boolean; saved: boolean; stage?: string; active: boolean; onOpen: () => void;
}) {
  const pay = jobPay(job);
  return (
    <li>
      <button onClick={onOpen}
        className={cn("group relative flex w-full gap-3 p-3.5 text-left transition-colors hover:bg-accent/40 md:p-4",
          active && "lg:bg-primary/[0.06]")}>
        {active && <span className="absolute inset-y-2 left-0 hidden w-1 rounded-r-full bg-primary lg:block" />}
        <CompanyAvatar name={job.company} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="line-clamp-2 flex-1 text-sm font-semibold leading-snug group-hover:text-primary">{job.title}</p>
          </div>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{job.company}</span>
            <span className="shrink-0">·</span>
            <span className="shrink-0">{job.postedAt ? formatRelative(job.postedAt) : job.source}</span>
            {isNew && <span className="shrink-0 rounded bg-success/15 px-1 text-[10px] font-bold uppercase text-success">New</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {f.workplace && <Chip>{f.workplace}</Chip>}
            {f.type && <Chip>{f.type}</Chip>}
            {f.seniority && <Chip>{f.seniority}</Chip>}
            {pay && <Chip tone="primary" className="font-semibold">{pay}</Chip>}
            {stage && <Chip tone="success">{stage}</Chip>}
            {saved && <BookmarkCheck className="size-3.5 text-primary" aria-label="Saved" />}
          </div>
        </div>
        <MatchRing score={job.matchScore} size={42} />
      </button>
    </li>
  );
}

function JobPreview({ job, f, skills, saved, onSave, onDismiss }: {
  job: Listing; f: Facets; skills: string[]; saved: boolean; onSave: () => void; onDismiss: () => void;
}) {
  const { matched, missing } = matchBreakdown(job, skills);
  const pay = jobPay(job);
  return (
    <aside className="panel sticky top-0 flex max-h-[calc(100dvh-7.5rem)] flex-col overflow-hidden">
      <div className="border-b border-border/60 p-5">
        <div className="flex items-start gap-3">
          <CompanyAvatar name={job.company} size={48} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-snug">{job.title}</h2>
            <p className="text-sm text-muted-foreground">{job.company} · {job.source}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {f.workplace && <Chip>{f.workplace}</Chip>}
          {f.type && <Chip>{f.type}</Chip>}
          {f.seniority && <Chip>{f.seniority}</Chip>}
          {job.postedAt && <Chip>Posted {formatRelative(job.postedAt)}</Chip>}
        </div>
        {pay && <p className="mt-3 text-2xl font-bold tracking-tight">{pay}</p>}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex items-center gap-4 rounded-xl bg-muted/40 p-3">
          <MatchRing score={job.matchScore} size={56} />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">
              {skills.length ? `You match ${matched.length} of ${skills.length} skills` : "Add skills to see your match"}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {matched.map((s) => <Chip key={s} tone="success">✓ {s}</Chip>)}
              {missing.map((s) => <Chip key={s} className="line-through decoration-muted-foreground/50">{s}</Chip>)}
            </div>
          </div>
        </div>
        {job.description ? <Prose text={job.description} /> : <p className="text-sm text-muted-foreground">The source didn&apos;t include a description.</p>}
        {job.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">{job.tags.map((t) => <Chip key={t}>{t}</Chip>)}</div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 p-4">
        <Button variant="gradient" className="flex-1" asChild>
          <Link href={applyHref("job", job.id)}><Sparkles /> Apply</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={listingHref("job", job.id)}>Details <ArrowRight /></Link>
        </Button>
        <Button variant="ghost" size="icon" onClick={onSave} title={saved ? "Remove from saved" : "Save for later"}>
          {saved ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
        </Button>
        <Button variant="ghost" size="icon" onClick={onDismiss} title="Not interested — hide it">
          <X />
        </Button>
        <Button variant="ghost" size="icon" asChild title={`Open on ${hostOf(job.url) || job.source}`}>
          <a href={job.url} target="_blank" rel="noopener noreferrer"><ExternalLink /></a>
        </Button>
      </div>
    </aside>
  );
}

function QuietRadar({ onScan, loading }: { onScan: (q: string) => void; loading: boolean }) {
  return (
    <div className="panel relative overflow-hidden px-6 py-12 text-center md:py-16">
      <div className="relative mx-auto mb-6 size-36">
        {[0, 1, 2].map((i) => (
          <span key={i} className="absolute rounded-full border border-primary/20" style={{ inset: `${i * 18}px` }} />
        ))}
        <span className="absolute inset-0 animate-[spin_4s_linear_infinite] rounded-full"
          style={{ background: "conic-gradient(from 0deg, hsl(var(--primary) / 0.35), transparent 25%)" }} />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-lg shadow-primary/30">
            <Radar className="size-6" />
          </span>
        </span>
      </div>
      <h2 className="text-xl font-bold">Your radar is quiet</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        Scan public job boards for roles that match your skills. Results are ranked by fit, and anything new since your last visit is flagged.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {PRESETS.slice(0, 4).map((p) => (
          <Button key={p.label} variant="outline" size="sm" disabled={loading} onClick={() => onScan(p.q)}>
            <Briefcase /> {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="panel divide-y divide-border/60" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 p-4">
          <div className="size-10 animate-pulse rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <div className="flex gap-1"><div className="h-4 w-14 animate-pulse rounded bg-muted" /><div className="h-4 w-16 animate-pulse rounded bg-muted" /></div>
          </div>
          <div className="size-10 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

function FilterDialog({ open, onOpenChange, filters, setFilters, sources, count }: {
  open: boolean; onOpenChange: (v: boolean) => void; filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>; sources: string[]; count: number;
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const field = (id: string, label: string, el: React.ReactNode) => (
    <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{el}</div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Filter roles</DialogTitle>
        <DialogDescription>Workplace, type and level are read from each listing — roles that don&apos;t say are left out when you filter on them.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        {field("f-src", "Source", (
          <Select id="f-src" value={filters.source} onChange={(e) => set("source", e.target.value)}>
            <option value="All">All sources</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        ))}
        {field("f-wp", "Workplace", (
          <Select id="f-wp" value={filters.workplace} onChange={(e) => set("workplace", e.target.value)}>
            {["Any", "Remote", "Hybrid", "On-site"].map((o) => <option key={o}>{o}</option>)}
          </Select>
        ))}
        {field("f-type", "Job type", (
          <Select id="f-type" value={filters.type} onChange={(e) => set("type", e.target.value)}>
            {["Any", "Full-time", "Part-time", "Contract", "Freelance", "Internship"].map((o) => <option key={o}>{o}</option>)}
          </Select>
        ))}
        {field("f-lvl", "Level", (
          <Select id="f-lvl" value={filters.seniority} onChange={(e) => set("seniority", e.target.value)}>
            {["Any", "Intern", "Junior", "Mid-level", "Senior", "Lead", "Executive"].map((o) => <option key={o}>{o}</option>)}
          </Select>
        ))}
        {field("f-pay", "Minimum pay", (
          <Select id="f-pay" value={String(filters.minPay)} onChange={(e) => set("minPay", Number(e.target.value))}>
            <option value="0">Any</option>
            <option value="50000">50k+</option>
            <option value="80000">80k+</option>
            <option value="100000">100k+</option>
            <option value="150000">150k+</option>
          </Select>
        ))}
        {field("f-posted", "Posted", (
          <Select id="f-posted" value={String(filters.posted)} onChange={(e) => set("posted", Number(e.target.value))}>
            <option value="0">Any time</option>
            <option value="1">Last 24 hours</option>
            <option value="3">Last 3 days</option>
            <option value="7">Last week</option>
            <option value="30">Last month</option>
          </Select>
        ))}
        {field("f-match", "Match", (
          <Select id="f-match" value={String(filters.minMatch)} onChange={(e) => set("minMatch", Number(e.target.value))}>
            <option value="0">Any match</option>
            <option value="50">50%+</option>
            <option value="70">70%+</option>
            <option value="85">85%+</option>
          </Select>
        ))}
        <label className="flex items-end gap-2 pb-2.5 text-sm">
          <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={filters.salaryOnly}
            onChange={(e) => set("salaryOnly", e.target.checked)} />
          Only roles that show pay
        </label>
      </div>
      <DialogFooter className="justify-between sm:justify-between">
        <Button variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}><RotateCcw /> Reset</Button>
        <Button variant="gradient" onClick={() => onOpenChange(false)}>Show {count} role{count === 1 ? "" : "s"}</Button>
      </DialogFooter>
    </Dialog>
  );
}
