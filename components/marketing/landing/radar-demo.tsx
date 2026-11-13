"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Radar, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SIGNUP_SKILL_KEY } from "@/lib/landing";

/*
 * Product preview of Job Radar: the visitor types what they do and watches
 * example matches appear. Everything here is an example built from the skill
 * they typed (labelled as such); the real radar scans live feeds after signup.
 */

const CHIPS = ["React", "Shopify", "Copywriting", "Logo design", "Python", "Video editing"];

type Template = { t: (s: string, S: string) => string; src: string; kind: "Job" | "Gig"; budget: string };
const TEMPLATES: Template[] = [
  { t: (_s, S) => `${S} specialist for a SaaS dashboard`, src: "Upwork", kind: "Gig", budget: "$2,500 fixed" },
  { t: (s) => `Part-time ${s} role on an agency team`, src: "We Work Remotely", kind: "Job", budget: "$60–80/h" },
  { t: (s) => `Buyer request: ${s} for a product launch`, src: "Fiverr", kind: "Gig", budget: "$450" },
  { t: (s) => `Ongoing ${s} work for an e-commerce brand`, src: "Freelancer.com", kind: "Gig", budget: "$35–50/h" },
  { t: (_s, S) => `${S} lead for an early-stage startup`, src: "LinkedIn", kind: "Job", budget: "Full-time · remote" },
  { t: (s) => `Quick-turnaround ${s} project, this week`, src: "Upwork", kind: "Gig", budget: "$800 fixed" },
  { t: (_s, S) => `${S} help for a nonprofit site refresh`, src: "PeoplePerHour", kind: "Gig", budget: "$1,200 fixed" },
  { t: (s) => `Contract ${s} role, 3 months`, src: "RemoteOK", kind: "Job", budget: "$70/h" },
];

const hash = (s: string) => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

type Match = { id: number; title: string; src: string; kind: "Job" | "Gig"; budget: string; score: number; x: number; y: number };

function makeMatch(skill: string, n: number): Match {
  const tpl = TEMPLATES[n % TEMPLATES.length];
  const s = skill.trim() || "React";
  const h = hash(`${s.toLowerCase()}#${n}`);
  const angle = (h % 360) * (Math.PI / 180);
  const r = 18 + (h % 26); // % of radius, stays inside the scope
  return {
    id: n,
    title: tpl.t(s.toLowerCase(), cap(s)),
    src: tpl.src,
    kind: tpl.kind,
    budget: tpl.budget,
    score: 98 - (h % 15),
    x: 50 + Math.cos(angle) * r,
    y: 50 + Math.sin(angle) * r,
  };
}

const VISIBLE = 4;

export function RadarDemo() {
  const [skill, setSkill] = React.useState("React");
  const [tick, setTick] = React.useState(VISIBLE);
  const [still, setStill] = React.useState(false);

  React.useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setStill(true); return; }
    const t = setInterval(() => setTick((n) => n + 1), 1700);
    return () => clearInterval(t);
  }, []);

  const pick = (s: string) => { setSkill(s); setTick(VISIBLE); };
  const matches = Array.from({ length: VISIBLE }, (_, i) => makeMatch(skill, tick - 1 - i));
  const shown = skill.trim() || "React";

  return (
    <div className="relative mx-auto w-full min-w-0 max-w-xl" aria-label="Product preview: Job Radar finding example matches">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/30 via-fuchsia-400/15 to-cyan-400/20 blur-2xl" />
      <div className="panel overflow-hidden text-left">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><Radar className="size-4 text-primary" /> Job Radar</p>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            <span className={cn("size-1.5 rounded-full bg-primary", !still && "animate-pulse")} /> Preview
          </span>
        </div>

        <form className="border-b px-4 py-3" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="radar-skill" className="text-xs font-medium text-muted-foreground">What do you do? Type it and watch.</label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="radar-skill"
              value={skill}
              maxLength={32}
              onChange={(e) => { setSkill(e.target.value); setTick(VISIBLE); }}
              placeholder="e.g. React, logo design, copywriting"
              className="h-10 w-full min-w-0 rounded-lg border border-input bg-background pl-9 pr-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CHIPS.map((c) => (
              <button key={c} type="button" onClick={() => pick(c)}
                className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition",
                  c.toLowerCase() === skill.trim().toLowerCase() ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/50 hover:text-foreground")}>
                {c}
              </button>
            ))}
          </div>
        </form>

        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
          {/* Scope */}
          <div className="relative mx-auto aspect-square w-40 sm:w-full" aria-hidden>
            <div className="absolute inset-0 rounded-full border border-primary/30 bg-[radial-gradient(circle,hsl(var(--primary)/0.10),transparent_70%)]" />
            <div className="absolute inset-[18%] rounded-full border border-primary/20" />
            <div className="absolute inset-[36%] rounded-full border border-primary/15" />
            <div className="absolute inset-x-0 top-1/2 h-px bg-primary/15" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-primary/15" />
            {!still && (
              <div className="absolute inset-0 animate-spin rounded-full [animation-duration:3.4s]"
                style={{ background: "conic-gradient(from 0deg, hsl(var(--primary) / 0.45), transparent 70deg)" }} />
            )}
            {matches.map((m, i) => (
              <span key={m.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${m.x}%`, top: `${m.y}%` }}>
                {i === 0 && !still && <span className="absolute inline-flex size-3 animate-ping rounded-full bg-fuchsia-400 opacity-75" />}
                <span className={cn("relative block size-3 rounded-full ring-2 ring-background", i === 0 ? "bg-fuchsia-400" : "bg-primary/70")} />
              </span>
            ))}
            <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
          </div>

          {/* Feed */}
          <ul className="min-w-0 space-y-2" aria-live="polite">
            {matches.map((m, i) => (
              <li key={m.id} className={cn("flex items-center gap-3 rounded-xl border bg-background/60 px-3 py-2", i === 0 && "animate-fade-in border-primary/40 bg-primary/[0.06]")}>
                <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ background: `conic-gradient(hsl(var(--primary)) ${m.score * 3.6}deg, hsl(var(--muted)) 0deg)` }}>
                  <span className="flex size-7 items-center justify-center rounded-full bg-card">{m.score}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.src} · {m.budget}</p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", m.kind === "Job" ? "bg-cyan-500/15 text-cyan-500" : "bg-fuchsia-500/15 text-fuchsia-500")}>{m.kind}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Sparkles className="size-3.5 shrink-0 text-primary" /> Example matches for &ldquo;{shown}&rdquo;. Sign up to scan live feeds.</p>
          <Button size="sm" variant="gradient" className="shrink-0" asChild>
            <Link href="/signup" data-cta="hero-radar-scan"
              onClick={() => { try { sessionStorage.setItem(SIGNUP_SKILL_KEY, shown); } catch { /* storage blocked */ } }}>
              Scan live for {shown.length > 14 ? "my skill" : shown} <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
