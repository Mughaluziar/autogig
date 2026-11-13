"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bookmark, Briefcase, Crown, Gavel, Loader2, Plus, RotateCcw, Search, Sparkles, Star, Store, Trophy, Wand2, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PaywallDialog } from "@/components/dashboard/paywall";
import { cn, formatRelative } from "@/lib/utils";
import { SubNav } from "@/components/radar/bits";
import { BASE, ageMs } from "@/components/radar/radar-data";
import { useCredits, usePipeline, useRadarFeed, useSaved } from "@/components/radar/use-radar";
import { SaveSearchDialog } from "@/components/radar/save-search-dialog";
import { GigCard, GigGridSkeleton } from "./gig-card";

const CATEGORIES = [
  { label: "Web apps", q: "react, next.js, javascript" },
  { label: "Python & APIs", q: "python, django, api" },
  { label: "WordPress", q: "wordpress, php" },
  { label: "Shopify", q: "shopify, ecommerce" },
  { label: "Design", q: "figma, logo, ui design" },
  { label: "Mobile", q: "flutter, react native, mobile app" },
  { label: "AI & data", q: "ai, llm, machine learning" },
  { label: "Writing", q: "copywriting, content, writing" },
];

type Sort = "match" | "new" | "budget" | "competition";

export function GigsNav() {
  const { apps } = usePipeline();
  const { savedIds } = useSaved();
  return (
    <SubNav items={[
      { href: BASE.gig, label: "Browse", icon: Store, exact: true },
      { href: `${BASE.gig}/bids`, label: "My bids", icon: Gavel, count: apps.filter((a) => a.kind === "gig").length },
      { href: `${BASE.gig}/saved`, label: "Saved", icon: Bookmark, count: savedIds.length },
    ]} />
  );
}

/** Bids this week, wins and credits — the seller's scoreboard. */
export function BidScoreboard({ compact = false }: { compact?: boolean }) {
  const pipe = usePipeline();
  const { isPro, bidCredits } = useCredits();
  const [paywall, setPaywall] = React.useState(false);
  const sent = pipe.weekly("gig");
  const won = pipe.apps.filter((a) => a.kind === "gig" && a.stage === "Won").length;
  return (
    <div className={cn("grid grid-cols-3 gap-2", compact && "text-sm")}>
      <Stat icon={Gavel} label="Bids this week" value={sent} />
      <Stat icon={Trophy} label="Won" value={won} tone="text-success" />
      <button onClick={() => !isPro && setPaywall(true)} className="text-left" disabled={isPro}>
        <Stat icon={isPro ? Crown : Zap} label={isPro ? "Pro plan" : "Bid credits"} value={isPro ? "∞" : bidCredits}
          tone={!isPro && bidCredits <= 2 ? "text-destructive" : "text-primary"} hint={isPro ? undefined : "Top up"} />
      </button>
      <PaywallDialog open={paywall} onOpenChange={setPaywall} kind="bids" />
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone = "text-foreground", hint }: {
  icon: React.ElementType; label: string; value: React.ReactNode; tone?: string; hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-2.5 backdrop-blur">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" /> <span className="truncate">{label}</span>
      </p>
      <p className={cn("mt-0.5 text-xl font-bold tabular-nums", tone)}>{value}</p>
      {hint && <p className="text-[10px] font-medium text-primary">{hint} →</p>}
    </div>
  );
}

export function GigsMarket() {
  const router = useRouter();
  const feed = useRadarFeed("gig");
  const saved = useSaved();
  const pipe = usePipeline();
  const [sort, setSort] = React.useState<Sort>("match");
  const [platform, setPlatform] = React.useState("All");
  const [rate, setRate] = React.useState<"any" | "fixed" | "hourly">("any");
  const [minBudget, setMinBudget] = React.useState(0);
  const [fresh, setFresh] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);

  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      router.replace(BASE.gig);
      void feed.scan(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasRateTypes = feed.jobs.some((g) => g.rateType);
  const hasCompetition = feed.jobs.some((g) => typeof g.proposals === "number");
  const visible = React.useMemo(() => {
    const out = feed.jobs.filter((g) =>
      !pipe.dismissed.includes(g.id)
      && (platform === "All" || g.source === platform)
      && (rate === "any" || g.rateType === rate)
      && (!minBudget || (g.budget ?? 0) >= minBudget)
      && (!fresh || ageMs(g.postedAt) <= 86_400_000));
    out.sort((a, b) =>
      sort === "new" ? ageMs(a.postedAt) - ageMs(b.postedAt)
      : sort === "budget" ? (b.budget ?? 0) - (a.budget ?? 0)
      : sort === "competition" ? (a.proposals ?? Infinity) - (b.proposals ?? Infinity)
      : b.matchScore - a.matchScore);
    return out;
  }, [feed.jobs, pipe.dismissed, platform, rate, minBudget, fresh, sort]);
  const filtered = platform !== "All" || rate !== "any" || minBudget > 0 || fresh;
  const chips: { label: string; q: string; n?: number }[] = saved.searches.length
    ? saved.searches.map((s) => ({ label: s.name, q: s.query, n: s.newSinceLast }))
    : CATEGORIES;
  const reset = () => { setPlatform("All"); setRate("any"); setMinBudget(0); setFresh(false); };

  return (
    <div className="space-y-5">
      {/* Marketplace hero */}
      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-fuchsia-500/[0.07] to-cyan-500/10 p-5 md:p-7">
        <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Freelance marketplace</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight md:text-4xl">Find your next paid gig</h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
              Paid projects from freelance marketplaces that allow it, matched to what you do. Bid with an AI-drafted proposal in minutes.
            </p>
            <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void feed.scan(); }}>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={feed.skills} onChange={(e) => feed.setSkills(e.target.value)} placeholder="What do you do? e.g. shopify, figma"
                  className="h-12 rounded-xl border-primary/20 bg-background/80 pl-10 text-base backdrop-blur" aria-label="Skills" />
              </div>
              <Button type="submit" variant="gradient" className="h-12 shrink-0 rounded-xl px-4 md:px-6" disabled={feed.loading}>
                {feed.loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
                <span className="hidden sm:inline">{feed.loading ? "Searching…" : "Find gigs"}</span>
              </Button>
              <Button type="button" variant="outline" className="hidden h-12 shrink-0 rounded-xl bg-background/60 px-3 sm:inline-flex"
                title="Save this search" onClick={() => setSaveOpen(true)}>
                <Star />
              </Button>
            </form>
            <div className="-mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5 pb-0.5 md:mx-0 md:flex-wrap md:px-0 [scrollbar-width:none]">
              {chips.map((c) => (
                <button key={c.label} onClick={() => void feed.scan(c.q)}
                  className={cn("flex shrink-0 items-center gap-1 rounded-full bg-background/70 px-3 py-1.5 text-xs font-medium shadow-sm ring-1 ring-border backdrop-blur transition-colors hover:text-primary hover:ring-primary/50",
                    feed.lastQuery === c.q && "text-primary ring-primary")}>
                  {c.label}
                  {(c.n ?? 0) > 0 && <span className="rounded-full bg-success/15 px-1.5 text-[10px] font-bold text-success">+{c.n}</span>}
                </button>
              ))}
            </div>
          </div>
          <BidScoreboard />
        </div>
      </section>

      <GigsNav />

      {feed.jobs.length === 0 ? (
        feed.loading ? <GigGridSkeleton /> : <EmptyMarket onScan={(q) => void feed.scan(q)} />
      ) : (
        <>
          {/* Toolbar */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl bg-muted p-1 text-xs font-medium">
                {([["match", "Best match"], ["new", "Newest"], ["budget", "Budget"], ...(hasCompetition ? [["competition", "Fewest bids"]] : [])] as [Sort, string][]).map(([v, l]) => (
                  <button key={v} onClick={() => setSort(v)}
                    className={cn("rounded-lg px-2.5 py-1.5 transition-colors", sort === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {l}
                  </button>
                ))}
              </div>
              <p className="ml-auto text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{visible.length}</span> gigs
                {feed.fetchedAt && <> · updated {formatRelative(feed.fetchedAt)}</>}
              </p>
            </div>
            <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:px-0 [scrollbar-width:none]">
              {feed.sources.length > 1 && (
                <Select value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-8 w-40 shrink-0 rounded-lg text-xs" aria-label="Platform">
                  <option value="All">All platforms</option>
                  {feed.sources.map((s) => <option key={s}>{s}</option>)}
                </Select>
              )}
              {hasRateTypes && (["fixed", "hourly"] as const).map((r) => (
                <Toggle key={r} on={rate === r} onClick={() => setRate(rate === r ? "any" : r)}>{r === "fixed" ? "Fixed price" : "Hourly"}</Toggle>
              ))}
              {[500, 1000, 5000].map((b) => (
                <Toggle key={b} on={minBudget === b} onClick={() => setMinBudget(minBudget === b ? 0 : b)}>
                  {b >= 1000 ? `${b / 1000}k+` : `${b}+`} budget
                </Toggle>
              ))}
              <Toggle on={fresh} onClick={() => setFresh(!fresh)}>Last 24h</Toggle>
              {filtered && (
                <button onClick={reset} className="flex shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground">
                  <RotateCcw className="size-3" /> Clear
                </button>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
              <p className="font-medium">No gigs match these filters</p>
              <Button variant="outline" size="sm" onClick={reset}><RotateCcw /> Clear filters</Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((g) => (
                <GigCard key={g.id} gig={g} saved={saved.savedIds.includes(g.id)} onSave={() => void saved.toggle(g)}
                  isNew={feed.isNew(g)} stage={pipe.tracked(g.id)?.stage} />
              ))}
            </div>
          )}
        </>
      )}

      <SellCard />
      <SaveSearchDialog open={saveOpen} onOpenChange={setSaveOpen} query={feed.skills} onSave={saved.saveSearch} noun="gigs" />
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={cn("shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
        on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
      {children}
    </button>
  );
}

function EmptyMarket({ onScan }: { onScan: (q: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CATEGORIES.map((c, i) => (
        <button key={c.label} onClick={() => onScan(c.q)}
          className="group flex items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ background: `linear-gradient(135deg, hsl(${(265 + i * 28) % 360} 75% 58%), hsl(${(300 + i * 28) % 360} 70% 48%))` }}>
            <Briefcase className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold group-hover:text-primary">{c.label}</span>
            <span className="block truncate text-xs text-muted-foreground">{c.q}</span>
          </span>
        </button>
      ))}
      <p className="text-center text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
        Pick a category or type your skills above. Marketplace feeds only appear once that platform allows access.
      </p>
    </div>
  );
}

/** Selling your own gig lives on the Accounts page; keep it one tap away. */
function SellCard() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Wand2 className="size-5" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Rather have clients come to you?</p>
          <p className="text-xs text-muted-foreground">Write a gig listing with AI and publish it on your connected marketplaces.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 sm:flex-none" asChild>
          <Link href="/dashboard/accounts?action=builder"><Sparkles /> Gig Builder</Link>
        </Button>
        <Button size="sm" variant="outline" className="flex-1 sm:flex-none" asChild>
          <Link href="/dashboard/accounts?action=gig"><Plus /> Publish gig</Link>
        </Button>
      </div>
    </div>
  );
}
