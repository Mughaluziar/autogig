"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { useDemoStore, useWorkspaceSlice } from "@/lib/demo-store";
import { DEMO_MODE, useAuth } from "@/lib/auth";
import { API_URL, apiCall, apiGet } from "@/lib/api";
import type { Row } from "@/lib/demo-engine";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/utils";
import {
  type AgentState, type Approval, type FleetAgent, type FleetRun, type FleetState, type Guardrails,
  type RunStep, type RunTrigger,
  DEFAULT_FLEET, KIND_META, RUNS_WHILE, SCHEDULE_LABEL, actionsLeft, actionsToday, blockedReason, budgetNumber,
  inQuietHours, newId, nextRunAt, normalizeFleet, pendingApprovals, runsToday, sumMetric, touchStreak, trimFleet,
} from "@/lib/fleet";
import { applyOutcome, executeRun, type FleetDeps } from "@/lib/fleet-engine";
import { COPILOT_HELP, parseCommand, type CopilotAction } from "@/lib/fleet-copilot";
import { sampleScan } from "@/lib/fleet-samples";

export const HAS_BACKEND = !DEMO_MODE && !!API_URL;
const TICK_MS = 20_000;
const FAILS_BEFORE_PAUSE = 3;

export type LiveRun = { runId: string; agentId: string; steps: RunStep[]; startedAt: string; dryRun: boolean };
export type StartResult = { runId: string } | { blocked: string };

type FleetContextValue = {
  fleet: FleetState;
  ready: boolean;
  live: Record<string, LiveRun>;
  /** Start of the previous visit — what the digest covers. */
  prevVisitAt: string;
  startRun: (id: string, opts?: { trigger?: RunTrigger; dryRun?: boolean; query?: string }) => StartResult;
  setAgentState: (ids: string[] | "all", state: AgentState, reason?: string) => void;
  updateAgent: (id: string, patch: Partial<FleetAgent>) => void;
  addAgent: (agent: FleetAgent) => void;
  duplicateAgent: (id: string) => FleetAgent | null;
  removeAgent: (id: string) => void;
  updateGuardrails: (patch: Partial<Guardrails>) => void;
  resolveApproval: (id: string, status: "approved" | "rejected", body?: string) => void;
  ask: (text: string) => Promise<void>;
  explain: (id: string) => string;
  update: (fn: (f: FleetState) => FleetState) => void;
};

const FleetContext = React.createContext<FleetContextValue | null>(null);

export function useFleet(): FleetContextValue {
  const ctx = React.useContext(FleetContext);
  if (!ctx) throw new Error("useFleet must be used inside <FleetProvider>");
  return ctx;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const inFuture = (ms: number) => {
  const mins = Math.max(1, Math.round((ms - Date.now()) / 60000));
  return mins < 60 ? `in ${mins}m` : `in ${Math.round(mins / 60)}h`;
};

export function FleetProvider({ children }: { children: React.ReactNode }) {
  const demo = useDemoStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const [raw, setRaw, ready] = useWorkspaceSlice<FleetState>("fleet", DEFAULT_FLEET);
  const fleet = React.useMemo(() => normalizeFleet(raw), [raw]);

  // Refs always hold the latest values, so async runs never act on a stale render.
  const fleetRef = React.useRef(fleet);
  fleetRef.current = fleet;
  const demoRef = React.useRef(demo);
  demoRef.current = demo;
  const readyRef = React.useRef(ready);
  readyRef.current = ready;
  const userName = user?.name ?? "";

  /** Mutates the fleet; the store applies `fn` synchronously, so the ref is fresh at once. */
  const update = React.useCallback((fn: (f: FleetState) => FleetState) => {
    setRaw((cur) => {
      const next = trimFleet(fn(normalizeFleet(cur)));
      fleetRef.current = next;
      return next;
    });
  }, [setRaw]);

  const [live, setLive] = React.useState<Record<string, LiveRun>>({});
  const running = React.useRef(new Set<string>());
  const skillsCache = React.useRef<string[] | null>(null);

  const deps = React.useMemo<FleetDeps>(() => ({
    hasBackend: HAS_BACKEND,
    userName,
    scan: async (query, kind) => {
      if (!HAS_BACKEND) return DEMO_MODE ? sampleScan(query, kind) : null;
      const res = await apiGet<{ jobs: Row[]; sources: string[] }>(
        `/api/radar/jobs?q=${encodeURIComponent(query)}&limit=100&kind=${encodeURIComponent(kind)}`
      );
      return res ? { jobs: res.jobs ?? [], sources: res.sources ?? [] } : null;
    },
    skills: async () => {
      if (skillsCache.current) return skillsCache.current;
      if (!HAS_BACKEND) return [];
      const res = await apiGet<{ skills?: string[] }>("/api/radar/profile");
      skillsCache.current = res?.skills ?? [];
      return skillsCache.current;
    },
    draft: async (job, agent) => {
      const skills = agent.query || fleetRef.current.agents.find((a) => a.kind === "scout" && a.query)?.query || (skillsCache.current ?? []).join(", ");
      if (!HAS_BACKEND) {
        if (!DEMO_MODE) return null;
        return {
          aiGenerated: false,
          text: `Hi, your posting for “${job.title}” lines up closely with my work in ${skills || "this area"}. I can start right away. My plan: (1) a quick call to confirm scope, (2) a working first version fast, (3) revisions until you're happy. What's your ideal timeline?`,
        };
      }
      const res = await apiCall<{ proposal: string; proposalId: string; aiGenerated: boolean }>("/api/fleet/draft", {
        jobId: job.id, jobTitle: job.title, jobDescription: job.description, jobUrl: job.url,
        platform: job.source, matchScore: job.matchScore, skills: skills.slice(0, 1000), userName,
        tone: agent.tone.slice(0, 40), instructions: agent.instructions.slice(0, 1500),
      });
      if (!res || res.status >= 400 || !res.data?.proposal) return null;
      return { text: res.data.proposal, proposalId: res.data.proposalId, aiGenerated: res.data.aiGenerated };
    },
    conversations: async () => (HAS_BACKEND ? apiGet<Row[]>("/api/conversations") : null),
    replyDraft: async (messageId, tone) => {
      const res = await apiCall<{ reply: string; aiGenerated: boolean }>("/api/inbox/reply-draft", { messageId, tone: tone.slice(0, 40) });
      return res && res.status < 400 && res.data?.reply ? res.data : null;
    },
    applications: () => demoRef.current?.state.radar?.applications ?? [],
    track: (job, stage, proposal) => { demoRef.current?.radarTrackJob(job, stage, proposal ?? ""); },
    accounts: () => demoRef.current?.state.accounts ?? [],
    inboxStatus: () => apiGet<Row>("/api/inbox/sync/status"),
    monetization: () => {
      const m = demoRef.current?.state.monetization;
      return { plan: m?.plan ?? "free", bidCredits: m?.bidCredits ?? 0 };
    },
  }), [userName]);

  const startRunRef = React.useRef<FleetContextValue["startRun"]>(() => ({ blocked: "Not ready" }));

  const startRun = React.useCallback<FleetContextValue["startRun"]>((id, opts = {}) => {
    const f = fleetRef.current;
    const agent = f.agents.find((a) => a.id === id);
    if (!agent) return { blocked: "That agent doesn't exist." };
    if (!readyRef.current) return { blocked: "Your fleet is still loading." };
    if (running.current.has(id)) return { blocked: `${agent.name} is already running.` };
    const dryRun = !!opts.dryRun;
    const trigger: RunTrigger = dryRun ? "dry-run" : opts.trigger ?? "manual";
    const scheduled = trigger === "schedule" || trigger === "chain";
    const reason = dryRun
      ? (f.guardrails.killSwitch ? "The kill switch is on." : null)
      : blockedReason(f, agent, { scheduled });
    if (reason) return { blocked: reason };

    const cfg: FleetAgent = opts.query ? { ...agent, query: opts.query } : agent;
    const runId = newId("run");
    const startedAt = new Date().toISOString();
    const run: FleetRun = {
      id: runId, agentId: id, agentName: agent.name, kind: agent.kind, trigger, dryRun,
      startedAt, status: "running", summary: dryRun ? "Dry run…" : `${KIND_META[agent.kind].verb}…`, steps: [], metrics: {},
    };
    running.current.add(id);
    update((fl) => ({
      ...fl,
      runs: [run, ...fl.runs],
      // Stamp the start so the scheduler doesn't fire the same agent again.
      agents: dryRun ? fl.agents : fl.agents.map((a) => (a.id === id ? { ...a, lastRunAt: startedAt } : a)),
    }));
    setLive((l) => ({ ...l, [id]: { runId, agentId: id, steps: [], startedAt, dryRun } }));

    void (async () => {
      const { outcome, steps } = await executeRun(cfg, fleetRef.current, deps, {
        dryRun,
        onStep: (s) => setLive((l) => (l[id] ? { ...l, [id]: { ...l[id], steps: [...l[id].steps, s] } } : l)),
      });
      update((fl) => {
        let next = applyOutcome(fl, id, runId, outcome, steps, dryRun);
        // Reliability: three failed runs in a row pause the agent with the reason.
        if (!dryRun && outcome.status === "error") {
          const recent = next.runs.filter((r) => r.agentId === id && !r.dryRun).slice(0, FAILS_BEFORE_PAUSE);
          if (recent.length === FAILS_BEFORE_PAUSE && recent.every((r) => r.status === "error")) {
            next = {
              ...next,
              agents: next.agents.map((a) => (a.id === id ? { ...a, state: "paused" as const, stoppedReason: `Paused after ${FAILS_BEFORE_PAUSE} failed runs in a row (${outcome.summary}). Resume it once the problem is fixed.` } : a)),
            };
          }
        }
        return next;
      });
      running.current.delete(id);
      setLive((l) => {
        const rest = { ...l };
        delete rest[id];
        return rest;
      });

      if (outcome.approvals.length) {
        toast({ title: `${agent.name}: ${outcome.summary}`, description: "They're waiting in Approvals.", variant: "success" });
      } else if (outcome.status === "error") {
        toast({ title: `${agent.name} hit a problem`, description: outcome.summary });
      } else if (!scheduled) {
        toast({ title: `${agent.name}${dryRun ? " (dry run)" : ""}`, description: outcome.summary });
      }
      if (!dryRun) {
        for (const kind of outcome.chain) {
          for (const next of fleetRef.current.agents) {
            if (next.kind === kind && next.state === "running" && next.schedule === "chain"
              && (next.autonomy === "approve" || next.autonomy === "auto")) {
              startRunRef.current(next.id, { trigger: "chain" });
            }
          }
        }
      }
    })();
    return { runId };
  }, [deps, toast, update]);
  startRunRef.current = startRun;

  // ---- load: close runs a closed tab left "running", record the visit
  const [prevVisitAt, setPrevVisitAt] = React.useState("");
  const loaded = React.useRef(false);
  // Only while Agent Fleet is actually open. Recording a visit changes the saved workspace, so doing it on
  // every dashboard page load made each new tab invalidate the other tabs' copies of the workspace.
  const onFleetPage = usePathname().startsWith("/dashboard/agents");
  React.useEffect(() => {
    if (!ready || loaded.current || !onFleetPage) return;
    loaded.current = true;
    setPrevVisitAt(fleetRef.current.lastVisitAt);
    update((f) => touchStreak({
      ...f,
      lastVisitAt: new Date().toISOString(),
      runs: f.runs.map((r) => (r.status === "running" && !running.current.has(r.agentId)
        ? { ...r, status: "error", summary: "Interrupted: the page was closed mid-run", finishedAt: r.finishedAt ?? r.startedAt }
        : r)),
    }));
  }, [ready, update, onFleetPage]);

  // ---- scheduler: runs due agents while Agent Fleet is open
  React.useEffect(() => {
    if (!ready) return;
    const tick = () => {
      const f = fleetRef.current;
      for (const a of f.agents) {
        const due = nextRunAt(a);
        if (due == null || due > Date.now() || running.current.has(a.id)) continue;
        if (blockedReason(f, a, { scheduled: true })) continue;
        startRunRef.current(a.id, { trigger: "schedule" });
      }
    };
    const first = setTimeout(tick, 1500);
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ready]);

  // ---- agent + guardrail actions
  const setAgentState = React.useCallback((ids: string[] | "all", state: AgentState, reason?: string) => {
    update((f) => ({
      ...f,
      agents: f.agents.map((a) => (ids === "all" || ids.includes(a.id)
        ? { ...a, state, stoppedReason: state === "running" ? undefined : reason, lastError: state === "running" ? undefined : a.lastError, lastStatus: state === "running" && a.lastStatus === "error" ? undefined : a.lastStatus }
        : a)),
    }));
  }, [update]);

  const updateAgent = React.useCallback((id: string, patch: Partial<FleetAgent>) => {
    update((f) => ({ ...f, agents: f.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  }, [update]);

  const addAgent = React.useCallback((agent: FleetAgent) => {
    update((f) => ({ ...f, agents: [...f.agents, agent] }));
  }, [update]);

  const duplicateAgent = React.useCallback((id: string) => {
    const src = fleetRef.current.agents.find((a) => a.id === id);
    if (!src) return null;
    const copy: FleetAgent = {
      ...src, id: newId("ag"), name: `${src.name} copy`, state: "paused", createdAt: new Date().toISOString(),
      lastRunAt: undefined, lastStatus: undefined, lastSummary: undefined, lastError: undefined, stoppedReason: undefined,
    };
    update((f) => ({ ...f, agents: [...f.agents, copy] }));
    return copy;
  }, [update]);

  const removeAgent = React.useCallback((id: string) => {
    update((f) => ({
      ...f,
      agents: f.agents.filter((a) => a.id !== id),
      approvals: f.approvals.filter((a) => a.agentId !== id || a.status !== "pending"),
    }));
  }, [update]);

  const updateGuardrails = React.useCallback((patch: Partial<Guardrails>) => {
    update((f) => ({ ...f, guardrails: { ...f.guardrails, ...patch } }));
  }, [update]);

  const resolveApproval = React.useCallback((id: string, status: "approved" | "rejected", body?: string) => {
    const ap = fleetRef.current.approvals.find((a) => a.id === id);
    if (!ap) return;
    const text = body ?? ap.body;
    if (status === "approved") {
      // Copy first (needs the click's user activation), then open the listing.
      void navigator.clipboard?.writeText(text).catch(() => {});
      if (ap.url) window.open(ap.url, "_blank", "noopener,noreferrer");
      if (ap.kind === "proposal" && ap.job) {
        demoRef.current?.radarTrackJob({ ...ap.job, budget: budgetNumber(ap.job.budget) }, "Applied", text);
      }
      if (HAS_BACKEND && ap.kind === "proposal" && ap.proposalId && text !== ap.body) {
        void apiCall(`/api/radar/proposals/${encodeURIComponent(ap.proposalId)}`, { body: text }, "PUT");
      }
      if (HAS_BACKEND && ap.kind === "reply" && ap.messageId) {
        void apiCall(`/api/inbox/messages/${encodeURIComponent(ap.messageId)}/reply-draft`, { reply: text }, "PUT");
        void apiCall(`/api/inbox/messages/${encodeURIComponent(ap.messageId)}/read`, {});
      }
    }
    update((f) => touchStreak({
      ...f,
      approvals: f.approvals.map((a) => (a.id === id ? { ...a, body: text, status, resolvedAt: new Date().toISOString() } : a)),
    }));
  }, [update]);

  // ---- Copilot
  const explain = React.useCallback((id: string): string => {
    const f = fleetRef.current;
    const a = f.agents.find((x) => x.id === id);
    if (!a) return "I can't find that agent.";
    const parts: string[] = [];
    if (running.current.has(id)) parts.push(`${a.name} is working right now.`);
    if (f.guardrails.killSwitch) parts.push("The kill switch is on, so every agent is stopped. Turn it off in Guardrails.");
    if (a.state === "stopped") parts.push(a.stoppedReason ? `${a.name} is stopped: ${a.stoppedReason}` : `${a.name} is stopped because you stopped it.`);
    else if (a.state === "paused") parts.push(a.stoppedReason ?? `${a.name} is paused. Resume it to put it back on its schedule.`);
    if (a.lastStatus === "error") parts.push(`Its last run failed: ${a.lastError ?? a.lastSummary ?? "unknown error"}.`);
    if (a.autonomy === "manual") parts.push("It's set to Manual, so it only runs when you press Run.");
    if (inQuietHours(f.guardrails)) parts.push(`Quiet hours are on until ${f.guardrails.quietHours.end}, so scheduled runs wait.`);
    if ((a.kind === "writer" || a.kind === "closer" || a.kind === "applier") && actionsLeft(f) <= 0) {
      parts.push(`The daily cap of ${f.guardrails.dailyActionCap} drafts is used up. It resets at midnight.`);
    }
    if (a.kind === "writer" && !f.queue.length) parts.push("Scout hasn't handed it any new matches to draft.");
    if (!parts.length || (parts.length === 1 && running.current.has(id))) {
      const next = nextRunAt(a);
      parts.push(`${a.name} is healthy.${a.lastRunAt ? ` Last run ${formatRelative(a.lastRunAt)}: ${a.lastSummary ?? "done"}.` : " It hasn't run yet."}`
        + (a.schedule === "chain" ? " It runs whenever Scout hands it matches." : next ? ` Next run ${inFuture(next)}.` : ""));
    }
    return parts.join(" ");
  }, []);

  const appendChat = React.useCallback((from: "user" | "copilot", text: string, runId?: string) => {
    update((f) => ({ ...f, chat: [...f.chat, { id: newId("m"), from, text, at: new Date().toISOString(), runId }] }));
  }, [update]);

  const perform = React.useCallback((action: CopilotAction): { text: string; runId?: string } => {
    const f = fleetRef.current;
    const name = (id: string) => f.agents.find((a) => a.id === id)?.name ?? "that agent";
    const names = (ids: string[] | "all") => (ids === "all" ? "every agent" : ids.map(name).join(" and "));
    switch (action.type) {
      case "pause":
        setAgentState(action.ids, "paused", "Paused by you from Copilot.");
        return { text: `Paused ${names(action.ids)}. Nothing new will be drafted until you resume.` };
      case "resume":
        if (f.guardrails.killSwitch) return { text: "The kill switch is on. Turn it off first (say “kill switch off”)." };
        setAgentState(action.ids, "running");
        return { text: `Resumed ${names(action.ids)}. Scheduled runs happen ${RUNS_WHILE}.` };
      case "stop":
        setAgentState(action.ids, "stopped", "Stopped by you from Copilot.");
        return { text: `Stopped ${names(action.ids)}. Resume it any time from its card.` };
      case "kill":
        updateGuardrails({ killSwitch: action.on });
        return { text: action.on ? "Kill switch on. Every agent is stopped, including manual runs." : "Kill switch off. Agents you left running will pick up on their schedules." };
      case "run": {
        const res = startRun(action.id, { trigger: "copilot", query: action.query, dryRun: action.dryRun });
        if ("blocked" in res) return { text: `I can't run ${name(action.id)} right now: ${res.blocked}` };
        return { text: `${action.dryRun ? "Dry-running" : "Running"} ${name(action.id)}${action.query ? ` for “${action.query}”` : ""}. Live steps below.`, runId: res.runId };
      }
      case "explain":
        return { text: explain(action.id) };
      case "autonomy":
        updateAgent(action.id, { autonomy: action.level });
        return { text: `${name(action.id)} is now on “${action.level === "approve" ? "Approve each" : action.level === "auto" ? "Auto within rules" : action.level[0].toUpperCase() + action.level.slice(1)}”.` };
      case "cap":
        updateGuardrails({ dailyActionCap: Math.max(1, Math.min(500, action.value)) });
        return { text: `Daily cap set to ${action.value} drafts. ${actionsToday(f)} used so far today.` };
      case "quiet":
        updateGuardrails({ quietHours: { enabled: true, start: action.start, end: action.end } });
        return { text: `Quiet hours set: no scheduled runs from ${action.start} to ${action.end}.` };
      case "quiet-off":
        updateGuardrails({ quietHours: { ...f.guardrails.quietHours, enabled: false } });
        return { text: "Quiet hours off. Scheduled runs can happen any time." };
      case "approvals": {
        const p = pendingApprovals(f);
        if (!p.length) return { text: "Nothing is waiting on you. Inbox zero for approvals." };
        const by = (k: string) => p.filter((a) => a.kind === k).length;
        return { text: `${plural(p.length, "item")} waiting: ${by("proposal")} proposals, ${by("reply")} replies, ${by("follow-up")} follow-ups. The best one: “${p[0].title}”. Open Approvals to review.` };
      }
      case "digest":
      case "status": {
        const today = runsToday(f);
        const live = f.agents.filter((a) => a.state === "running").length;
        const pend = pendingApprovals(f).length;
        if (action.type === "status") {
          return { text: `${live} of ${plural(f.agents.length, "agent")} running${f.guardrails.killSwitch ? " (kill switch on)" : ""}. ${plural(pend, "item")} waiting on you. ${actionsToday(f)}/${f.guardrails.dailyActionCap} drafts used today.` };
        }
        if (!today.length) return { text: `No runs yet today. ${pend ? `${plural(pend, "item")} still waiting on you.` : "Start Scout to get the day going."}` };
        return { text: `Today: ${plural(today.length, "run")}, ${sumMetric(today, "scanned")} listings scanned, ${sumMetric(today, "matches")} new matches, ${sumMetric(today, "drafted")} drafts written. ${plural(pend, "item")} waiting on you.` };
      }
      case "help":
      default:
        return { text: COPILOT_HELP };
    }
  }, [explain, setAgentState, startRun, updateAgent, updateGuardrails]);

  const ask = React.useCallback(async (text: string) => {
    const message = text.trim();
    if (!message) return;
    appendChat("user", message);
    const f = fleetRef.current;
    const action = parseCommand(message, f.agents);
    if (action) {
      const out = perform(action);
      appendChat("copilot", out.text, out.runId);
      return;
    }
    if (HAS_BACKEND) {
      const res = await apiCall<{ reply: string | null; action: CopilotAction | null; aiGenerated: boolean }>("/api/fleet/copilot", {
        message: message.slice(0, 500),
        context: {
          agents: f.agents.slice(0, 20).map((a) => ({
            id: a.id, name: a.name.slice(0, 80), kind: a.kind, state: a.state, autonomy: a.autonomy,
            lastStatus: a.lastStatus ?? "", lastSummary: (a.lastSummary ?? "").slice(0, 200), lastError: (a.lastError ?? "").slice(0, 200),
          })),
          pendingApprovals: pendingApprovals(f).length,
          killSwitch: f.guardrails.killSwitch,
          quietHours: f.guardrails.quietHours.enabled ? `${f.guardrails.quietHours.start}-${f.guardrails.quietHours.end}` : "off",
          dailyCap: f.guardrails.dailyActionCap,
          actionsToday: actionsToday(f),
        },
      });
      if (res && res.status < 400 && (res.data.reply || res.data.action)) {
        const out = res.data.action ? perform(res.data.action) : null;
        const parts = [res.data.reply, out && out.text !== res.data.reply ? out.text : null].filter(Boolean);
        appendChat("copilot", parts.join("\n"), out?.runId);
        return;
      }
    }
    appendChat("copilot", `I didn't catch that${HAS_BACKEND ? "" : " (free-form questions need the Autopilot server with AI configured)"}.\n${COPILOT_HELP}`);
  }, [appendChat, perform]);

  const value: FleetContextValue = {
    fleet, ready, live, prevVisitAt, startRun, setAgentState, updateAgent, addAgent, duplicateAgent, removeAgent,
    updateGuardrails, resolveApproval, ask, explain, update,
  };
  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

/** Human description of when an agent runs next, for cards and the detail page. */
export function scheduleNote(f: FleetState, a: FleetAgent): string {
  if (f.guardrails.killSwitch) return "Kill switch on";
  if (a.state === "stopped") return "Stopped";
  if (a.state === "paused") return "Paused";
  if (a.autonomy === "manual") return "Runs when you press Run";
  if (a.schedule === "chain") return "Runs when Scout finds matches";
  if (inQuietHours(f.guardrails)) return `Quiet hours until ${f.guardrails.quietHours.end}`;
  const next = nextRunAt(a);
  if (next == null) return SCHEDULE_LABEL[a.schedule];
  return next <= Date.now() ? "Due now" : `Next run ${inFuture(next)}`;
}

export type { Approval };
