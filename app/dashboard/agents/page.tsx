"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell, Check, ChevronRight, Copy, FlaskConical, Flame, Hand, History, LayoutTemplate, OctagonX, Pause, Play,
  Plus, Search, Settings2, Sparkles, Square, Trophy, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useDemoStore } from "@/lib/demo-store";
import { useAuth } from "@/lib/auth";
import { cn, formatRelative } from "@/lib/utils";
import {
  KIND_META, RUNS_WHILE, actionsToday, agentHealth, blockedReason, dayKey, pendingApprovals, runsToday, successRate, sumMetric,
  type FleetAgent, type FleetRun, type FleetState,
} from "@/lib/fleet";
import { scheduleNote, useFleet } from "@/components/agents/fleet-provider";
import { LiveMap } from "@/components/agents/live-map";
import { CopilotPanel } from "@/components/agents/copilot";
import { ApprovalCard } from "@/components/agents/approval-card";
import {
  AgentAvatar, AutonomyPicker, HealthPill, KindTag, RunRow, StatTile, StepList,
} from "@/components/agents/agent-bits";

const TAKE_OVER: Record<FleetAgent["kind"], { href: string; label: string }> = {
  scout: { href: "/dashboard/job-radar", label: "Job Radar" },
  writer: { href: "/dashboard/agents/approvals", label: "Approvals" },
  applier: { href: "/dashboard/job-radar", label: "your pipeline" },
  closer: { href: "/dashboard/conversations", label: "the inbox" },
  keeper: { href: "/dashboard/accounts", label: "Accounts & Gigs" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function todayStats(agent: FleetAgent, runs: FleetRun[]): { label: string; value: string }[] {
  const m = (k: string) => String(sumMetric(runs, k));
  switch (agent.kind) {
    case "scout": return [{ label: "Scanned", value: m("scanned") }, { label: "Matches", value: m("matches") }];
    case "writer": return [{ label: "Drafted", value: m("drafted") }, { label: "Failed", value: m("failed") }];
    case "applier": return [{ label: "Tracked", value: m("tracked") }, { label: "Follow-ups", value: m("followUps") }];
    case "closer": return [{ label: "Unread", value: m("unread") }, { label: "Replies", value: m("drafted") }];
    case "keeper": return [{ label: "Accounts", value: m("accounts") }, { label: "Issues", value: m("issues") }];
  }
}

export default function AgentFleetPage() {
  const { fleet, ready, live, prevVisitAt, startRun, setAgentState, updateAgent, duplicateAgent, updateGuardrails, update } = useFleet();
  const demo = useDemoStore();
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = React.useState<string | undefined>();
  const [search, setSearch] = React.useState("");
  const [tab, setTab] = React.useState("agents");
  const searchRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const working = React.useMemo(() => new Set(Object.keys(live)), [live]);
  const selected = fleet.agents.find((a) => a.id === selectedId) ?? fleet.agents[0];
  const q = search.trim().toLowerCase();
  const agents = q ? fleet.agents.filter((a) => `${a.name} ${a.role} ${a.kind} ${a.lastSummary ?? ""}`.toLowerCase().includes(q)) : fleet.agents;
  const runningCount = fleet.agents.filter((a) => a.state === "running").length;
  const pending = pendingApprovals(fleet);
  const applications = demo?.state.radar?.applications ?? [];

  const select = (id: string) => {
    setSelectedId(id);
    setTab("agents");
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const run = (agent: FleetAgent, dryRun = false) => {
    const res = startRun(agent.id, { dryRun });
    if ("blocked" in res) toast({ title: `${agent.name} can't run`, description: res.blocked });
  };

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1.5 h-1 w-10 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" />
          <h1 className="text-3xl font-bold tracking-tight">Agent Fleet</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">Your control center for every agent: see them, steer them, stop them. Nothing reaches a client without your OK.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents and runs" className="h-9 pl-9 pr-12" aria-label="Search agents and runs" />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] text-muted-foreground sm:block">⌘K</kbd>
          </div>
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-success/30 bg-success/10 pl-3 pr-1 text-sm sm:flex-none">
            <span className={cn("size-2 rounded-full", runningCount && !fleet.guardrails.killSwitch ? "animate-pulse bg-success" : "bg-muted-foreground")} />
            <span className="flex-1 truncate whitespace-nowrap font-medium">{plural(runningCount, "agent")} running</span>
            {runningCount > 0 ? (
              <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5" onClick={() => { setAgentState("all", "paused", "Paused by you."); toast({ title: "All agents paused" }); }}>Pause all</Button>
            ) : (
              <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5" disabled={!ready || fleet.guardrails.killSwitch} onClick={() => { setAgentState("all", "running"); toast({ title: "All agents resumed", description: `Scheduled runs happen ${RUNS_WHILE}.`, variant: "success" }); }}>Resume all</Button>
            )}
          </div>
          <Button variant="outline" size="icon" className="relative size-9" asChild>
            <Link href="/dashboard/agents/approvals" aria-label={`${pending.length} approvals waiting`}>
              <Bell />
              {pending.length > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-warning-foreground">{pending.length}</span>}
            </Link>
          </Button>
          <Button variant="gradient" size="sm" className="h-9" asChild>
            <Link href="/dashboard/agents/new" aria-label="New agent"><Plus /><span className="hidden sm:inline">New</span></Link>
          </Button>
        </div>
      </div>

      {!ready ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="panel h-24 animate-pulse" />)}
          <div className="panel h-80 animate-pulse sm:col-span-2 lg:col-span-5" />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            <SetupChecklist fleet={fleet} accounts={demo?.state.accounts?.length ?? 0} onQuery={(query) => {
              const scout = fleet.agents.find((a) => a.kind === "scout");
              if (scout) updateAgent(scout.id, { query });
            }} onDismiss={() => update((f) => ({ ...f, setupDismissed: true }))} />
            <Digest fleet={fleet} prevVisitAt={prevVisitAt} name={user?.name ?? ""} />
            <Kpis fleet={fleet} bidCredits={demo?.state.monetization?.bidCredits ?? 0} pro={demo?.state.monetization?.plan === "pro"} />
            <LiveMap fleet={fleet} working={working} applications={applications} onSelect={select} selectedId={selected?.id} />

            <section className="panel p-4">
              <Tabs value={tab} onValueChange={setTab}>
                <div className="flex flex-wrap items-center gap-2">
                  <TabsList>
                    <TabsTrigger value="agents">Agents</TabsTrigger>
                    <TabsTrigger value="approvals">Waiting{pending.length > 0 && <span className="ml-1.5 rounded-full bg-warning/20 px-1.5 text-[10px] text-warning">{pending.length}</span>}</TabsTrigger>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                    <TabsTrigger value="guardrails">Guardrails</TabsTrigger>
                  </TabsList>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" asChild><Link href="/dashboard/agents/templates"><LayoutTemplate /> Templates</Link></Button>
                    <Button size="sm" variant="gradient" asChild><Link href="/dashboard/agents/new"><Plus /> Deploy agent</Link></Button>
                  </div>
                </div>

                <TabsContent value="agents" className="mt-4">
                  {agents.length === 0 ? (
                    <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                      {q ? `No agents match “${search}”.` : "No agents yet."}{" "}
                      <Link href="/dashboard/agents/new" className="text-primary hover:underline">Deploy one</Link>
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {agents.map((a) => {
                        const h = agentHealth(fleet, a, working.has(a.id));
                        const liveStep = live[a.id]?.steps.at(-1)?.text;
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => select(a.id)}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                              selected?.id === a.id ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "border-border/60 hover:bg-accent/40"
                            )}
                          >
                            <AgentAvatar kind={a.kind} health={h} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium">{a.name}</span>
                                <KindTag kind={a.kind} />
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                {liveStep ?? (a.lastSummary ? `${a.lastSummary} · ${formatRelative(a.lastRunAt)}` : a.role)}
                              </p>
                            </div>
                            <HealthPill health={h} className="hidden sm:inline-flex" />
                            <span className={cn("size-2 rounded-full sm:hidden", h === "working" ? "animate-pulse bg-primary" : h === "running" ? "bg-success" : h === "waiting" ? "bg-warning" : h === "paused" ? "bg-muted-foreground" : "bg-destructive")} />
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {selected && (
                    <div ref={panelRef} className="scroll-mt-4">
                      <AgentPanel
                        agent={selected}
                        fleet={fleet}
                        liveSteps={live[selected.id]?.steps}
                        onRun={(dry) => run(selected, dry)}
                        onToggle={() => setAgentState([selected.id], selected.state === "running" ? "paused" : "running", "Paused by you.")}
                        onStop={() => { setAgentState([selected.id], "stopped", "Stopped by you."); toast({ title: `${selected.name} stopped` }); }}
                        onTakeOver={() => {
                          updateAgent(selected.id, { autonomy: "manual" });
                          toast({ title: `You're in control`, description: `${selected.name} is on Manual until you change it back.` });
                          router.push(TAKE_OVER[selected.kind].href);
                        }}
                        onAutonomy={(autonomy) => updateAgent(selected.id, { autonomy })}
                        onDuplicate={() => {
                          const copy = duplicateAgent(selected.id);
                          if (copy) { setSelectedId(copy.id); toast({ title: `Duplicated ${selected.name}`, description: "The copy starts paused.", variant: "success" }); }
                        }}
                      />
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="approvals" className="mt-4 space-y-3">
                  {pending.length === 0 ? (
                    <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">Nothing waiting on you. Drafts from Writer, Closer and Applier land here.</p>
                  ) : (
                    <>
                      {pending.slice(0, 3).map((a) => <ApprovalCard key={a.id} approval={a} compact />)}
                      {pending.length > 3 && (
                        <Button variant="outline" className="w-full" asChild><Link href="/dashboard/agents/approvals">See all {pending.length} <ChevronRight /></Link></Button>
                      )}
                    </>
                  )}
                </TabsContent>

                <TabsContent value="activity" className="mt-4">
                  <ActivityFeed fleet={fleet} live={live} search={q} />
                </TabsContent>

                <TabsContent value="guardrails" className="mt-4">
                  <QuickGuardrails fleet={fleet} onChange={updateGuardrails} />
                </TabsContent>
              </Tabs>
            </section>
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-0 flex h-[calc(100dvh-7.5rem)] flex-col gap-4">
              <CopilotPanel className="min-h-0 flex-1" userName={user?.name ?? ""} />
              <KillSwitchCard fleet={fleet} onToggle={(on) => updateGuardrails({ killSwitch: on })} />
            </div>
          </aside>
          <div className="lg:hidden">
            <KillSwitchCard fleet={fleet} onToggle={(on) => updateGuardrails({ killSwitch: on })} />
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function Kpis({ fleet, bidCredits, pro }: { fleet: FleetState; bidCredits: number; pro: boolean }) {
  const today = runsToday(fleet);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yKey = dayKey(y);
  const yesterday = fleet.runs.filter((r) => !r.dryRun && dayKey(new Date(r.startedAt)) === yKey).length;
  const rate = successRate(today) ?? successRate(fleet.runs.filter((r) => !r.dryRun).slice(0, 30));
  const failed = today.filter((r) => r.status === "error").length;
  const healthy = fleet.agents.filter((a) => a.state === "running" && a.lastStatus !== "error").length;
  const pending = pendingApprovals(fleet).length;
  const delta = yesterday ? Math.round(((today.length - yesterday) / yesterday) * 100) : null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <StatTile label="Agents" value={fleet.agents.length} sub={`${healthy} running healthy`} tone="success" />
      <StatTile label="Runs today" value={today.length} sub={delta == null ? (today.length ? "first runs today" : "none yet") : `${delta >= 0 ? "+" : ""}${delta}% vs yesterday`} tone={delta != null && delta >= 0 ? "success" : "default"} />
      <StatTile label="Success rate" value={rate == null ? "—" : `${rate}%`} sub={failed ? `${failed} failed today` : "no failures today"} tone={failed ? "warning" : "success"} />
      <StatTile label="Waiting on you" value={pending} sub={pending ? "tap to review" : "all clear"} tone={pending ? "warning" : "default"} href="/dashboard/agents/approvals" pulse={pending > 0} />
      <StatTile
        label="Drafts today"
        value={<span>{actionsToday(fleet)}<span className="text-base font-medium text-muted-foreground"> / {fleet.guardrails.dailyActionCap}</span></span>}
        sub={pro ? "Pro: unlimited bids" : `${bidCredits} bid credits left`}
        tone="primary"
      />
    </div>
  );
}

function Digest({ fleet, prevVisitAt, name }: { fleet: FleetState; prevVisitAt: string; name: string }) {
  const since = prevVisitAt ? Date.parse(prevVisitAt) : 0;
  const runs = fleet.runs.filter((r) => !r.dryRun && since && Date.parse(r.startedAt) > since);
  const pending = pendingApprovals(fleet).length;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const sent = fleet.approvals.filter((a) => a.status === "approved" && Date.parse(a.resolvedAt ?? "") > weekAgo).length;
  if (!runs.length && !pending && !sent && fleet.streak.count < 2) return null;
  const first = name.split(" ")[0];
  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-fuchsia-500/10 to-transparent p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Your daily digest</p>
          <h2 className="mt-1 text-lg font-semibold">
            {runs.length
              ? `${first ? `${first}, w` : "W"}hile you were away the fleet ran ${plural(runs.length, "time")}.`
              : pending ? `${first ? `${first}, y` : "Y"}our agents left you ${plural(pending, "draft")} to review.` : `${first ? `Nice work, ${first}.` : "Nice work."}`}
          </h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {runs.length > 0 && <span><b className="text-foreground">{sumMetric(runs, "matches")}</b> new matches</span>}
            {runs.length > 0 && <span><b className="text-foreground">{sumMetric(runs, "drafted")}</b> drafts written</span>}
            {sent > 0 && <span className="inline-flex items-center gap-1"><Trophy className="size-3.5 text-warning" /><b className="text-foreground">{sent}</b> sent this week</span>}
            {fleet.streak.count >= 2 && <span className="inline-flex items-center gap-1"><Flame className="size-3.5 text-orange-400" /><b className="text-foreground">{fleet.streak.count}-day</b> streak</span>}
          </div>
        </div>
        {pending > 0 && (
          <Button variant="gradient" asChild><Link href="/dashboard/agents/approvals">Review {pending} <ChevronRight /></Link></Button>
        )}
      </div>
    </section>
  );
}

function SetupChecklist({ fleet, accounts, onQuery, onDismiss }: { fleet: FleetState; accounts: number; onQuery: (q: string) => void; onDismiss: () => void }) {
  const scout = fleet.agents.find((a) => a.kind === "scout");
  const [query, setQuery] = React.useState(scout?.query ?? "");
  const steps = [
    { label: "Tell Scout what to look for", done: !!scout?.query || fleet.runs.some((r) => r.kind === "scout" && r.status === "success") },
    { label: "Start Scout", done: fleet.agents.some((a) => a.kind === "scout" && a.state === "running") },
    { label: "Start Writer", done: fleet.agents.some((a) => a.kind === "writer" && a.state === "running") },
    { label: "Review your first draft", done: fleet.approvals.some((a) => a.status !== "pending") },
    { label: "Link a platform account", done: accounts > 0, href: "/dashboard/accounts" },
  ];
  const done = steps.filter((s) => s.done).length;
  if (fleet.setupDismissed || done === steps.length) return null;
  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"><Sparkles className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Get your fleet working · {done}/{steps.length}</h2>
            <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground" aria-label="Hide setup"><X className="size-4" /></button>
          </div>
          <Progress value={(done / steps.length) * 100} className="mt-2 h-1.5" />
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.label} className={cn("flex items-center gap-2 text-sm", s.done ? "text-muted-foreground line-through" : "")}>
                <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", s.done ? "border-success bg-success text-white" : "border-border")}>
                  {s.done && <Check className="size-3" />}
                </span>
                {s.href && !s.done ? <Link href={s.href} className="text-primary hover:underline">{s.label}</Link> : s.label}
              </li>
            ))}
          </ul>
          {!steps[0].done && (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (query.trim()) onQuery(query.trim()); }}>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Your skills, e.g. react, next.js, figma" className="h-9" aria-label="Skills for Scout" />
              <Button size="sm" className="h-9" type="submit" disabled={!query.trim()}>Save</Button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function AgentPanel({
  agent, fleet, liveSteps, onRun, onToggle, onStop, onTakeOver, onAutonomy, onDuplicate,
}: {
  agent: FleetAgent;
  fleet: FleetState;
  liveSteps?: { at: string; text: string; tone: "ok" | "info" | "warn" | "error" }[];
  onRun: (dry: boolean) => void;
  onToggle: () => void;
  onStop: () => void;
  onTakeOver: () => void;
  onAutonomy: (a: FleetAgent["autonomy"]) => void;
  onDuplicate: () => void;
}) {
  const working = !!liveSteps;
  const health = agentHealth(fleet, agent, working);
  const today = runsToday(fleet, agent.id);
  const rate = successRate(today);
  const blocked = blockedReason(fleet, agent, { scheduled: false });
  const lastRun = fleet.runs.find((r) => r.agentId === agent.id && r.status !== "running");
  const stats = [...todayStats(agent, today), { label: "Runs today", value: String(today.length) }, { label: "Success", value: rate == null ? "—" : `${rate}%` }];
  return (
    <div className="mt-4 rounded-2xl border border-border/60 bg-background/40 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <AgentAvatar kind={agent.kind} health={health} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{agent.name}</h3>
            <HealthPill health={health} />
          </div>
          <p className="text-sm text-muted-foreground">{agent.role}</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button size="sm" variant="outline" onClick={onToggle} disabled={fleet.guardrails.killSwitch && agent.state !== "running"} className="grow sm:grow-0">
            {agent.state === "running" ? <><Pause /> Pause</> : <><Play /> {agent.state === "stopped" ? "Restart" : "Resume"}</>}
          </Button>
          <Button size="sm" variant="outline" onClick={onTakeOver} className="grow sm:grow-0"><Hand /> Take over</Button>
          {agent.state !== "stopped" && (
            <Button size="sm" variant="outline" onClick={onStop} className="grow border-destructive/40 text-destructive hover:bg-destructive/10 sm:grow-0"><Square /> Stop</Button>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-muted/50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Doing now</p>
        {working ? (
          <StepList steps={liveSteps!.slice(-4)} live className="mt-2" />
        ) : (
          <p className="mt-1 text-sm">
            {agent.stoppedReason && agent.state !== "running" ? agent.stoppedReason : blocked ?? scheduleNote(fleet, agent)}
            {lastRun && <span className="text-muted-foreground"> · last run {formatRelative(lastRun.startedAt)}: {lastRun.summary}</span>}
          </p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Autonomy</p>
        <AutonomyPicker value={agent.autonomy} onChange={onAutonomy} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="gradient" onClick={() => onRun(false)} disabled={working}><Zap /> Run now</Button>
        <Button size="sm" variant="outline" onClick={() => onRun(true)} disabled={working}><FlaskConical /> Dry run</Button>
        <Button size="sm" variant="outline" asChild><Link href={`/dashboard/agents/${agent.id}?tab=prompt`}><Settings2 /> Edit prompt and rules</Link></Button>
        <Button size="sm" variant="outline" onClick={onDuplicate}><Copy /> Duplicate</Button>
        <Button size="sm" variant="ghost" asChild><Link href={`/dashboard/agents/runs?agent=${agent.id}`}><History /> View all runs</Link></Button>
      </div>

      <ul className="mt-4 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
        {KIND_META[agent.kind].does.map((d) => <li key={d} className="flex gap-1.5"><Check className="mt-0.5 size-3 shrink-0 text-primary" />{d}</li>)}
      </ul>
    </div>
  );
}

function ActivityFeed({ fleet, live, search }: { fleet: FleetState; live: Record<string, { runId: string; steps: { at: string; text: string; tone: "ok" | "info" | "warn" | "error" }[] }>; search: string }) {
  const [errorsOnly, setErrorsOnly] = React.useState(false);
  const runs = fleet.runs
    .filter((r) => !errorsOnly || r.status === "error")
    .filter((r) => !search || `${r.agentName} ${r.summary}`.toLowerCase().includes(search))
    .slice(0, 12);
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => setErrorsOnly(false)} className={cn("rounded-full px-3 py-1 text-xs", !errorsOnly ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>All</button>
        <button onClick={() => setErrorsOnly(true)} className={cn("rounded-full px-3 py-1 text-xs", errorsOnly ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>Problems</button>
        <Link href="/dashboard/agents/runs" className="ml-auto text-xs text-primary hover:underline">All runs</Link>
      </div>
      {runs.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{errorsOnly ? "No problems. Nice." : "No runs yet. Press Run on an agent."}</p>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <RunRow key={r.id} run={r} defaultOpen={r.status === "running"} liveSteps={live[r.agentId]?.runId === r.id ? live[r.agentId].steps : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuickGuardrails({ fleet, onChange }: { fleet: FleetState; onChange: (p: Partial<FleetState["guardrails"]>) => void }) {
  const g = fleet.guardrails;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
        <div>
          <p className="text-sm font-medium">Daily draft cap</p>
          <p className="text-xs text-muted-foreground">{actionsToday(fleet)} used today. Writer, Closer and Applier stop at the cap.</p>
        </div>
        <Input type="number" min={1} max={500} value={g.dailyActionCap} onChange={(e) => onChange({ dailyActionCap: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} className="h-9 w-20" aria-label="Daily draft cap" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
        <div>
          <p className="text-sm font-medium">Quiet hours</p>
          <p className="text-xs text-muted-foreground">No scheduled runs between these times.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="time" value={g.quietHours.start} onChange={(e) => onChange({ quietHours: { ...g.quietHours, start: e.target.value } })} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Quiet hours start" />
          <span className="text-muted-foreground">–</span>
          <input type="time" value={g.quietHours.end} onChange={(e) => onChange({ quietHours: { ...g.quietHours, end: e.target.value } })} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Quiet hours end" />
          <Switch checked={g.quietHours.enabled} onCheckedChange={(v) => onChange({ quietHours: { ...g.quietHours, enabled: v } })} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
        <div>
          <p className="text-sm font-medium">Minimum match</p>
          <p className="text-xs text-muted-foreground">Scouts ignore anything below {g.minMatch}%.</p>
        </div>
        <Input type="number" min={0} max={99} value={g.minMatch} onChange={(e) => onChange({ minMatch: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })} className="h-9 w-20" aria-label="Minimum match" />
      </div>
      <Button variant="outline" className="w-full" asChild><Link href="/dashboard/agents/guardrails">All guardrails <ChevronRight /></Link></Button>
    </div>
  );
}

function KillSwitchCard({ fleet, onToggle }: { fleet: FleetState; onToggle: (on: boolean) => void }) {
  const on = fleet.guardrails.killSwitch;
  const g = fleet.guardrails;
  return (
    <section className={cn("panel p-4", on && "border-destructive/50")}>
      <div className="flex items-center gap-2">
        <span className={cn("size-2 rounded-full", on ? "bg-destructive" : "animate-pulse bg-success")} />
        <p className="text-sm font-semibold">{on ? "Autopilot is stopped" : "Autopilot is on"}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Cap {g.dailyActionCap} drafts/day{g.quietHours.enabled ? ` · quiet ${g.quietHours.start}–${g.quietHours.end}` : ""} · runs {RUNS_WHILE}
      </p>
      <Button
        size="sm"
        variant={on ? "outline" : "destructive"}
        className="mt-3 w-full"
        onClick={() => onToggle(!on)}
      >
        <OctagonX /> {on ? "Release kill switch" : "Kill switch"}
      </Button>
    </section>
  );
}
