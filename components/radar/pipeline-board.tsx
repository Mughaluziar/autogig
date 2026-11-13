"use client";
import * as React from "react";
import Link from "next/link";
import {
  Bookmark, CircleDashed, ExternalLink, Ghost, MessageCircle, Minus, Plus, Send, Trash2, Trophy, FileX, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatRelative } from "@/lib/utils";
import { BASE, compactMoney, listingHref } from "./radar-data";
import { usePipeline } from "./use-radar";
import { GoalRing } from "./bits";
import { STAGES, type Application, type Kind, type Stage } from "./types";

const LABELS: Record<Kind, Record<Stage, string>> = {
  job: { Saved: "Saved", Drafted: "Drafting", Applied: "Applied", Interview: "Interviewing", Won: "Offer", Lost: "Rejected", Ghosted: "No reply" },
  gig: { Saved: "Saved", Drafted: "Drafting", Applied: "Bid sent", Interview: "Shortlisted", Won: "Hired", Lost: "Declined", Ghosted: "No reply" },
};
const ICON: Record<Stage, React.ElementType> = {
  Saved: Bookmark, Drafted: CircleDashed, Applied: Send, Interview: MessageCircle, Won: Trophy, Lost: FileX, Ghosted: Ghost,
};
const OPEN: Stage[] = ["Saved", "Drafted", "Applied", "Interview", "Won"];
const CLOSED: Stage[] = ["Lost", "Ghosted"];
type Column = { key: string; stages: Stage[]; label: string; icon: React.ElementType };

export const stageLabel = (kind: Kind, stage: Stage) => LABELS[kind][stage] ?? stage;

export function PipelineBoard({ kind }: { kind: Kind }) {
  const pipe = usePipeline();
  const apps = pipe.apps.filter((a) => (kind === "gig" ? a.kind === "gig" : a.kind !== "gig"));
  const columns: Column[] = [
    ...OPEN.map((s) => ({ key: s, stages: [s], label: LABELS[kind][s], icon: ICON[s] })),
    { key: "Closed", stages: CLOSED, label: "Closed", icon: FileX },
  ];
  const [mobileCol, setMobileCol] = React.useState("Applied");
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const inCol = (c: Column) => apps.filter((a) => c.stages.includes(a.stage));

  const sent = apps.filter((a) => !["Saved", "Drafted"].includes(a.stage)).length;
  const replied = apps.filter((a) => ["Interview", "Won"].includes(a.stage)).length;
  const won = apps.filter((a) => a.stage === "Won").length;
  const pct = (n: number) => (sent ? `${Math.round((n * 100) / sent)}%` : "—");
  const noun = kind === "gig" ? "bids" : "applications";

  const move = (id: string, stage: Stage) => {
    const app = apps.find((a) => a.id === id);
    if (!app || app.stage === stage) return;
    const now = new Date().toISOString();
    pipe.patch(id, {
      stage, stageChangedAt: now,
      ...(stage === "Applied" && !app.submittedAt ? { submittedAt: now, appliedAt: now } : {}),
    });
  };

  return (
    <div className="space-y-4">
      {/* Funnel */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Metric label={kind === "gig" ? "Bids sent" : "Applied"} value={sent} />
        <Metric label="Response rate" value={pct(replied)} hint={`${replied} ${kind === "gig" ? "shortlisted or hired" : "interviews or offers"}`} />
        <Metric label="Win rate" value={pct(won)} hint={`${won} ${kind === "gig" ? "hired" : "offers"}`} tone="text-success" />
        <Metric label="In progress" value={apps.filter((a) => ["Saved", "Drafted"].includes(a.stage)).length} hint="saved or drafting" />
        <GoalCard className="col-span-2 md:col-span-1" weekly={pipe.weekly(kind)} goal={pipe.goal} setGoal={pipe.setGoal} noun={noun} />
      </div>

      {apps.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
          <p className="font-medium">Nothing tracked yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Save a {kind === "gig" ? "gig" : "role"} or start {kind === "gig" ? "a bid" : "an application"} and it appears here, so you always know what to follow up on.
          </p>
          <Button variant="gradient" size="sm" asChild><Link href={BASE[kind]}>{kind === "gig" ? "Browse gigs" : "Open the feed"}</Link></Button>
        </div>
      ) : (
        <>
          {/* Phones: one stage at a time */}
          <div className="md:hidden">
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
              {columns.map((c) => (
                <button key={c.key} onClick={() => setMobileCol(c.key)}
                  className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                    mobileCol === c.key ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>
                  <c.icon className="size-3.5" /> {c.label}
                  <span className="tabular-nums opacity-80">{inCol(c).length}</span>
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {(() => {
                const col = columns.find((c) => c.key === mobileCol) ?? columns[0];
                const items = inCol(col);
                return items.length ? items.map((a) => <AppCard key={a.id} app={a} kind={kind} onMove={move} onRemove={pipe.remove} onPatch={pipe.patch} />)
                  : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing in {col.label.toLowerCase()}.</p>;
              })()}
            </div>
          </div>

          {/* Tablets and up: a board you can drag across */}
          <div className="hidden overflow-x-auto pb-2 md:block">
            <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3">
              {columns.map((c) => {
                const items = inCol(c);
                return (
                  <section key={c.key}
                    onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(c.key); } }}
                    onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging) move(dragging, c.key === "Closed" ? "Lost" : (c.key as Stage));
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cn("flex min-h-64 flex-col rounded-2xl border border-border/60 bg-muted/30 p-2 transition-colors",
                      over === c.key && "border-primary bg-primary/5")}>
                    <header className="flex items-center gap-1.5 px-1.5 pb-2 pt-1 text-xs font-semibold">
                      <c.icon className={cn("size-3.5", c.key === "Won" ? "text-success" : c.key === "Closed" ? "text-muted-foreground" : "text-primary")} />
                      {c.label}
                      <span className="ml-auto rounded-full bg-background px-1.5 tabular-nums text-muted-foreground">{items.length}</span>
                    </header>
                    <div className="flex-1 space-y-2">
                      {items.map((a) => (
                        <div key={a.id} draggable onDragStart={() => setDragging(a.id)} onDragEnd={() => { setDragging(null); setOver(null); }}
                          className={cn("cursor-grab active:cursor-grabbing", dragging === a.id && "opacity-40")}>
                          <AppCard app={a} kind={kind} onMove={move} onRemove={pipe.remove} onPatch={pipe.patch} compact />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="panel p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-2xl font-bold tabular-nums", tone)}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function GoalCard({ weekly, goal, setGoal, noun, className }: {
  weekly: number; goal: number; setGoal: (g: number) => void; noun: string; className?: string;
}) {
  return (
    <div className={cn("panel flex items-center gap-3 p-3", className)}>
      <GoalRing value={weekly} goal={goal} size={44} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">This week</p>
        <p className="text-sm font-semibold tabular-nums">{weekly} / {goal} {noun}</p>
      </div>
      <div className="flex flex-col">
        <button className="rounded p-0.5 hover:bg-accent" aria-label="Raise weekly goal" onClick={() => setGoal(goal + 1)}><Plus className="size-3.5" /></button>
        <button className="rounded p-0.5 hover:bg-accent" aria-label="Lower weekly goal" onClick={() => setGoal(goal - 1)}><Minus className="size-3.5" /></button>
      </div>
    </div>
  );
}

function AppCard({ app, kind, onMove, onRemove, onPatch, compact }: {
  app: Application; kind: Kind; onMove: (id: string, s: Stage) => void; onRemove: (id: string) => void;
  onPatch: (id: string, p: Partial<Application>) => void; compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [notes, setNotes] = React.useState(app.notes ?? "");
  const amount = kind === "gig" && app.bidAmount ? compactMoney(app.bidAmount, app.currency) : compactMoney(app.budget, app.currency);
  const when = app.submittedAt ?? app.stageChangedAt ?? app.appliedAt;
  return (
    <article className="rounded-xl border border-border/70 bg-card p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link href={listingHref(kind, app.jobId)} className="line-clamp-2 text-sm font-semibold leading-snug hover:text-primary">{app.title}</Link>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{app.company} · {app.source}</p>
        </div>
        <button onClick={() => setOpen(!open)} aria-label={open ? "Hide details" : "Show details"} className="rounded p-0.5 text-muted-foreground hover:bg-accent">
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        {amount && <span className="font-semibold text-foreground">{kind === "gig" && app.bidAmount ? `Bid ${amount}` : amount}</span>}
        <span className="ml-auto">{formatRelative(when)}</span>
      </div>
      {(open || !compact) && (
        <div className="mt-2.5 space-y-2 border-t border-border/60 pt-2.5">
          <Select value={app.stage} onChange={(e) => onMove(app.id, e.target.value as Stage)} className="h-8 text-xs" aria-label="Stage">
            {STAGES.map((s) => <option key={s} value={s}>{stageLabel(kind, s)}</option>)}
          </Select>
          {open && (
            <>
              {app.proposal && <p className="line-clamp-4 rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground">{app.proposal}</p>}
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== app.notes && onPatch(app.id, { notes })}
                placeholder="Notes — who you spoke to, next follow-up…" className="text-xs" />
            </>
          )}
          <div className="flex items-center gap-1">
            {app.url && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
                <a href={app.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3.5" /> Original</a>
              </Button>
            )}
            <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs text-muted-foreground" onClick={() => onRemove(app.id)}>
              <Trash2 className="size-3.5" /> Remove
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
