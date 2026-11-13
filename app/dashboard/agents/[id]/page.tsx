"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Check, Copy, FlaskConical, Pause, Play, Save, Square, Trash2, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/utils";
import {
  KIND_META, SCHEDULE_LABEL, agentHealth, blockedReason, successRate, sumMetric, type FleetAgent,
} from "@/lib/fleet";
import { scheduleNote, useFleet } from "@/components/agents/fleet-provider";
import { AgentFields, sectionsFor, type FormSection } from "@/components/agents/agent-form";
import { AgentAvatar, AutonomyPicker, HealthPill, KindTag, RunRow, StatTile, StepList } from "@/components/agents/agent-bits";
import { ApprovalCard } from "@/components/agents/approval-card";

const SECTION_LABEL: Record<FormSection, string> = { basics: "Configure", targeting: "Targeting", prompt: "Prompt & rules" };
const WEEK = 7 * 86_400_000;

export default function AgentDetailPage() {
  return (
    <React.Suspense fallback={<div className="panel h-64 animate-pulse" aria-busy="true" />}>
      <AgentDetail />
    </React.Suspense>
  );
}

function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { fleet, ready, live, startRun, setAgentState, updateAgent, duplicateAgent, removeAgent } = useFleet();
  const agent = fleet.agents.find((a) => a.id === id);

  const sections = agent ? sectionsFor(agent.kind) : [];
  const [requestedTab, setTab] = React.useState(params.get("tab") ?? "overview");
  // "prompt" means "where this agent's rules live": targeting for scouts.
  const tab = requestedTab === "prompt" && agent && !sections.includes("prompt")
    ? (sections.includes("targeting") ? "targeting" : "basics")
    : requestedTab;
  const [draft, setDraft] = React.useState<FleetAgent | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  React.useEffect(() => {
    if (agent && (!draft || draft.id !== agent.id)) setDraft(agent);
  }, [agent, draft]);

  if (!ready) return <div className="panel h-64 animate-pulse" aria-busy="true" />;
  if (!agent || !draft) {
    return (
      <div className="panel py-16 text-center">
        <p className="text-muted-foreground">This agent doesn&apos;t exist anymore.</p>
        <Button variant="outline" className="mt-4" asChild><Link href="/dashboard/agents"><ArrowLeft /> Back to the fleet</Link></Button>
      </div>
    );
  }

  const working = !!live[agent.id];
  const health = agentHealth(fleet, agent, working);
  const runs = fleet.runs.filter((r) => r.agentId === agent.id);
  const week = runs.filter((r) => !r.dryRun && Date.now() - Date.parse(r.startedAt) < WEEK);
  const rate = successRate(week);
  const pending = fleet.approvals.filter((a) => a.agentId === agent.id && a.status === "pending");
  const dirty = JSON.stringify(draft) !== JSON.stringify(agent);
  const blocked = blockedReason(fleet, agent, { scheduled: false });

  const run = (dryRun: boolean) => {
    const res = startRun(agent.id, { dryRun });
    if ("blocked" in res) toast({ title: `${agent.name} can't run`, description: res.blocked });
    else setTab("overview");
  };
  const save = () => {
    const { name, role, schedule, query, scanKind, sources, minMatch, minBudget, excludeKeywords, tone, instructions, perRunLimit, followUpDays } = draft;
    updateAgent(agent.id, { name: name.trim() || agent.name, role, schedule, query, scanKind, sources, minMatch, minBudget, excludeKeywords, tone, instructions, perRunLimit, followUpDays });
    toast({ title: "Saved", description: `${name.trim() || agent.name} uses the new settings from its next run.`, variant: "success" });
  };

  const weekStat = (key: string, label: string) => ({ label, value: sumMetric(week, key) });
  const kindStats = {
    scout: [weekStat("scanned", "Scanned (7d)"), weekStat("matches", "Matches (7d)")],
    writer: [weekStat("drafted", "Drafts (7d)"), { label: "Waiting", value: pending.length }],
    applier: [weekStat("followUps", "Follow-ups (7d)"), weekStat("ghosted", "Marked ghosted")],
    closer: [weekStat("drafted", "Replies (7d)"), { label: "Waiting", value: pending.length }],
    keeper: [{ label: "Issues found", value: runs[0]?.metrics.issues ?? 0 }, { label: "Accounts", value: runs[0]?.metrics.accounts ?? 0 }],
  }[agent.kind];

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
        <Link href="/dashboard/agents"><ArrowLeft /> Fleet</Link>
      </Button>

      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <AgentAvatar kind={agent.kind} health={health} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
              <HealthPill health={health} />
              <KindTag kind={agent.kind} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{agent.role}</p>
            <p className="mt-1 text-xs text-muted-foreground">{SCHEDULE_LABEL[agent.schedule]} · {scheduleNote(fleet, agent)}</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="gradient" onClick={() => run(false)} disabled={working}><Zap /> Run now</Button>
            <Button variant="outline" onClick={() => run(true)} disabled={working}><FlaskConical /> Dry run</Button>
            <Button variant="outline" onClick={() => setAgentState([agent.id], agent.state === "running" ? "paused" : "running", "Paused by you.")} disabled={fleet.guardrails.killSwitch && agent.state !== "running"}>
              {agent.state === "running" ? <><Pause /> Pause</> : <><Play /> {agent.state === "stopped" ? "Restart" : "Resume"}</>}
            </Button>
            {agent.state !== "stopped" && (
              <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setAgentState([agent.id], "stopped", "Stopped by you.")}><Square /> Stop</Button>
            )}
          </div>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Runs (7d)" value={week.length} sub={agent.lastRunAt ? `last ${formatRelative(agent.lastRunAt)}` : "never run"} />
        <StatTile label="Success" value={rate == null ? "—" : `${rate}%`} sub={`${week.filter((r) => r.status === "error").length} failed`} tone={rate != null && rate < 70 ? "warning" : "success"} />
        {kindStats.map((s) => <StatTile key={s.label} label={s.label} value={s.value} />)}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-5">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {sections.map((s) => <TabsTrigger key={s} value={s}>{SECTION_LABEL[s]}</TabsTrigger>)}
          <TabsTrigger value="autonomy">Autonomy</TabsTrigger>
          <TabsTrigger value="runs">Runs{runs.length > 0 && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px]">{runs.length}</span>}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-4">
              <section className="panel p-4">
                <h2 className="font-semibold">Live console</h2>
                {working ? (
                  <StepList steps={live[agent.id].steps} live className="mt-3 font-mono" />
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {blocked ?? `Idle. ${scheduleNote(fleet, agent)}.`} Press <b className="text-foreground">Run now</b> to watch it work, or <b className="text-foreground">Dry run</b> to preview without saving anything.
                  </p>
                )}
              </section>
              {pending.length > 0 && (
                <section className="space-y-3">
                  <h2 className="font-semibold">Waiting on you ({pending.length})</h2>
                  {pending.slice(0, 3).map((a) => <ApprovalCard key={a.id} approval={a} compact />)}
                  {pending.length > 3 && <Button variant="outline" className="w-full" asChild><Link href="/dashboard/agents/approvals">See all</Link></Button>}
                </section>
              )}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Recent runs</h2>
                  {runs.length > 5 && <button className="text-xs text-primary hover:underline" onClick={() => setTab("runs")}>All runs</button>}
                </div>
                {runs.length === 0 ? <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">No runs yet.</p>
                  : runs.slice(0, 5).map((r, i) => <RunRow key={r.id} run={r} defaultOpen={i === 0} liveSteps={live[agent.id]?.runId === r.id ? live[agent.id].steps : undefined} />)}
              </section>
            </div>
            <aside className="space-y-4">
              <section className="panel p-4">
                <h2 className="font-semibold">What it does</h2>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {KIND_META[agent.kind].does.map((d) => <li key={d} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{d}</li>)}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">It never sends anything to a client or a marketplace by itself. Drafts wait in Approvals.</p>
              </section>
              <section className="panel space-y-2 p-4">
                <h2 className="font-semibold">Manage</h2>
                <Button variant="outline" className="w-full justify-start" onClick={() => {
                  const copy = duplicateAgent(agent.id);
                  if (copy) { toast({ title: "Duplicated", description: "The copy starts paused.", variant: "success" }); router.push(`/dashboard/agents/${copy.id}`); }
                }}><Copy /> Duplicate</Button>
                <Button variant="outline" className="w-full justify-start border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}><Trash2 /> Delete agent</Button>
              </section>
            </aside>
          </div>
        </TabsContent>

        {sections.map((s) => (
          <TabsContent key={s} value={s} className="mt-4">
            <section className="panel p-4 sm:p-5">
              <AgentFields value={draft} onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))} section={s} />
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                <Button variant="gradient" onClick={save} disabled={!dirty}><Save /> Save changes</Button>
                <Button variant="ghost" onClick={() => setDraft(agent)} disabled={!dirty}>Discard</Button>
                <Button variant="outline" className="ml-auto" onClick={() => { if (dirty) save(); run(true); }}><FlaskConical /> Save and dry run</Button>
              </div>
            </section>
          </TabsContent>
        ))}

        <TabsContent value="autonomy" className="mt-4">
          <section className="panel space-y-4 p-4 sm:p-5">
            <div>
              <h2 className="font-semibold">How much it does on its own</h2>
              <p className="text-sm text-muted-foreground">Changes apply immediately.</p>
            </div>
            <AutonomyPicker value={agent.autonomy} onChange={(autonomy) => updateAgent(agent.id, { autonomy })} />
            <ul className="space-y-1.5 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
              <li>• Outward-facing work (proposals, replies, follow-ups) always waits for your OK, at every level.</li>
              <li>• Guardrails (daily cap, quiet hours, kill switch) apply on top. <Link href="/dashboard/agents/guardrails" className="text-primary hover:underline">Edit guardrails</Link></li>
            </ul>
          </section>
        </TabsContent>

        <TabsContent value="runs" className="mt-4 space-y-2">
          {runs.length === 0 ? <p className="panel py-10 text-center text-sm text-muted-foreground">No runs yet.</p>
            : runs.map((r) => <RunRow key={r.id} run={r} liveSteps={live[agent.id]?.runId === r.id ? live[agent.id].steps : undefined} />)}
        </TabsContent>
      </Tabs>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogHeader>
          <DialogTitle>Delete {agent.name}?</DialogTitle>
          <DialogDescription>Its pending drafts are discarded. Its run history stays in Runs.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { removeAgent(agent.id); toast({ title: `${agent.name} deleted` }); router.push("/dashboard/agents"); }}>
            <Trash2 /> Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
