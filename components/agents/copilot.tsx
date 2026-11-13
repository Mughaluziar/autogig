"use client";
import * as React from "react";
import Link from "next/link";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COPILOT_SUGGESTIONS } from "@/lib/fleet-copilot";
import { pendingApprovals, sumMetric, type ChatMessage, type FleetState } from "@/lib/fleet";
import { HAS_BACKEND, useFleet } from "./fleet-provider";
import { RunStatus, StepList } from "./agent-bits";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function greeting(fleet: FleetState, prevVisitAt: string, name: string): string {
  const h = new Date().getHours();
  const hello = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
  const first = name.split(" ")[0];
  const since = prevVisitAt ? Date.parse(prevVisitAt) : 0;
  const runs = fleet.runs.filter((r) => !r.dryRun && Date.parse(r.startedAt) > since);
  const pend = pendingApprovals(fleet).length;
  if (!fleet.runs.length) {
    return `${hello}${first ? `, ${first}` : ""}. I run your fleet for you. Try “scan for react gigs”, or press Run on Scout to start.`;
  }
  const bits = [
    runs.length ? `since your last visit the fleet ran ${plural(runs.length, "time")}` : "the fleet has been quiet since your last visit",
    sumMetric(runs, "matches") ? `found ${plural(sumMetric(runs, "matches"), "new match", "new matches")}` : "",
    sumMetric(runs, "drafted") ? `drafted ${plural(sumMetric(runs, "drafted"), "proposal")}` : "",
  ].filter(Boolean);
  return `${hello}${first ? `, ${first}` : ""}. ${bits.join(", ")}.${pend ? ` ${plural(pend, "item")} ${pend === 1 ? "is" : "are"} waiting on you.` : ""}`;
}

function TaskCard({ runId }: { runId: string }) {
  const { fleet, live } = useFleet();
  const run = fleet.runs.find((r) => r.id === runId);
  if (!run) return null;
  const liveRun = live[run.agentId]?.runId === runId ? live[run.agentId] : null;
  const steps = liveRun ? liveRun.steps : run.steps;
  return (
    <div className="mt-2 rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Task · {run.agentName}</p>
        <RunStatus run={run} />
      </div>
      <p className="mt-1 text-sm font-medium">{run.summary}</p>
      {steps.length > 0 && <StepList steps={steps.slice(-6)} live={run.status === "running"} className="mt-2" />}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" asChild>
          <Link href={`/dashboard/agents/runs?run=${run.id}`}>View run</Link>
        </Button>
        {run.status !== "running" && (run.metrics.drafted ?? 0) + (run.metrics.followUps ?? 0) > 0 && (
          <Button size="sm" variant="gradient" className="h-7 px-2 text-xs" asChild>
            <Link href="/dashboard/agents/approvals">Review drafts</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.from === "user";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm leading-relaxed",
          mine ? "rounded-br-md bg-gradient-to-r from-primary to-purple-500 text-white" : "rounded-bl-md bg-muted/70"
        )}
      >
        {m.text}
        {m.runId && <TaskCard runId={m.runId} />}
      </div>
    </div>
  );
}

export function CopilotPanel({ className, onClose, userName = "" }: { className?: string; onClose?: () => void; userName?: string }) {
  const { fleet, ready, prevVisitAt, ask } = useFleet();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [fleet.chat.length]);

  const send = async (msg: string) => {
    if (!msg.trim() || busy || !ready) return;
    setText("");
    setBusy(true);
    try {
      await ask(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cn("panel flex min-h-0 flex-col", className)} aria-label="Copilot">
      <div className="flex items-start gap-3 border-b border-border/60 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Copilot</h2>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", HAS_BACKEND ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
              <span className={cn("size-1.5 rounded-full", HAS_BACKEND ? "bg-success" : "bg-muted-foreground")} />
              {HAS_BACKEND ? "Online" : "Preview"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">Tell the fleet what to do in plain English. Anything sent to a client still waits for your OK.</p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close Copilot" className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <div className="flex justify-start">
          <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-muted/70 px-3 py-2 text-sm leading-relaxed">
            {ready ? greeting(fleet, prevVisitAt, userName) : "Loading your fleet…"}
          </div>
        </div>
        {fleet.chat.map((m) => <Bubble key={m.id} m={m} />)}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bot className="size-3.5 animate-pulse" /> Thinking…
          </div>
        )}
      </div>

      <div className="border-t border-border/60 p-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {COPILOT_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              disabled={!ready || busy}
              className="shrink-0 rounded-full border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tell the fleet what to do"
            maxLength={500}
            aria-label="Message Copilot"
            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" variant="gradient" size="icon" disabled={!text.trim() || busy || !ready} aria-label="Send">
            <Send />
          </Button>
        </form>
      </div>
    </section>
  );
}

/** Floating Copilot button + drawer (bottom sheet on phones, side sheet on desktop). */
export function CopilotLauncher({ hideOnDesktop, userName }: { hideOnDesktop?: boolean; userName?: string }) {
  const [open, setOpen] = React.useState(false);
  const { fleet } = useFleet();
  const pending = pendingApprovals(fleet).length;
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "glow-primary fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105",
          hideOnDesktop && "lg:hidden"
        )}
        aria-label="Open Copilot"
      >
        <Sparkles className="size-4" /> Copilot
        {pending > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-primary">{pending}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex h-[85dvh] animate-fade-in sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[420px]">
            <CopilotPanel className="w-full rounded-b-none bg-card sm:rounded-none" onClose={() => setOpen(false)} userName={userName} />
          </div>
        </div>
      )}
    </>
  );
}
