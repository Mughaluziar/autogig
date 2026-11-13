/**
 * Agent Fleet — the data model, templates and pure helpers.
 *
 * The fleet orchestrates the app's real features: Scout runs Job Radar scans,
 * Writer drafts proposals, Applier keeps the Job Radar pipeline current,
 * Closer drafts inbox replies and Account Keeper checks connected accounts.
 * Nothing an agent produces is ever sent to a client or a marketplace by the
 * agent itself: anything outward-facing waits in Approvals for the user.
 *
 * State lives in the user's workspace under the "fleet" slice
 * (useWorkspaceSlice), so it's saved per user on the server.
 */

export type AgentKind = "scout" | "writer" | "applier" | "closer" | "keeper";
export type Autonomy = "manual" | "assisted" | "approve" | "auto";
export type AgentState = "running" | "paused" | "stopped";
export type Schedule = "manual" | "chain" | "15m" | "30m" | "1h" | "3h" | "6h" | "daily";
export type ScanKind = "all" | "job" | "gig";

export type FleetAgent = {
  id: string;
  kind: AgentKind;
  name: string;
  role: string;
  state: AgentState;
  autonomy: Autonomy;
  schedule: Schedule;
  /** Scout: skills / keywords, comma separated. Empty = your Job Radar skills. */
  query: string;
  scanKind: ScanKind;
  /** Sources this agent may use (Job Radar source names). Empty = all. */
  sources: string[];
  minMatch: number;
  minBudget: number;
  excludeKeywords: string[];
  tone: string;
  /** Free-form prompt and rules, passed to the writer and shown on every run. */
  instructions: string;
  perRunLimit: number;
  /** Applier: days after applying before a follow-up is drafted. */
  followUpDays: number;
  createdAt: string;
  lastRunAt?: string;
  lastStatus?: RunStatus;
  lastSummary?: string;
  lastError?: string;
  /** Why the agent is stopped/paused when it wasn't the user (cap, error). */
  stoppedReason?: string;
  templateId?: string;
};

export type RunStatus = "running" | "success" | "error" | "skipped";
export type RunTrigger = "manual" | "schedule" | "chain" | "copilot" | "dry-run";
export type StepTone = "ok" | "info" | "warn" | "error";
export type RunStep = { at: string; text: string; tone: StepTone };

export type FleetRun = {
  id: string;
  agentId: string;
  agentName: string;
  kind: AgentKind;
  trigger: RunTrigger;
  dryRun: boolean;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  summary: string;
  steps: RunStep[];
  metrics: Record<string, number>;
};

export type FleetJob = {
  id: string;
  title: string;
  company: string;
  source: string;
  url: string;
  budget?: number | string | null;
  currency?: string | null;
  tags: string[];
  description: string;
  postedAt?: string;
  matchScore: number;
  kind?: "job" | "gig";
  foundAt: string;
  foundBy: string;
  status: "new" | "drafted" | "skipped";
};

export type ApprovalKind = "proposal" | "reply" | "follow-up";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export type Approval = {
  id: string;
  kind: ApprovalKind;
  agentId: string;
  agentName: string;
  title: string;
  subtitle: string;
  body: string;
  url?: string;
  job?: FleetJob;
  proposalId?: string;
  messageId?: string;
  appJobId?: string;
  matchScore?: number;
  aiGenerated?: boolean;
  createdAt: string;
  status: ApprovalStatus;
  resolvedAt?: string;
};

export type Guardrails = {
  /** Stops every agent, including manual runs, until turned off. */
  killSwitch: boolean;
  /** Drafts + replies the whole fleet may prepare per day. */
  dailyActionCap: number;
  quietHours: { enabled: boolean; start: string; end: string };
  /** Floor for every scout's match threshold. */
  minMatch: number;
  /** Sources the whole fleet may use. Empty = all. */
  sources: string[];
  blockKeywords: string[];
};

export type ChatMessage = { id: string; from: "user" | "copilot"; text: string; at: string; runId?: string };

export type FleetState = {
  v: 1;
  agents: FleetAgent[];
  runs: FleetRun[];
  approvals: Approval[];
  /** Scout → Writer hand-off: matches waiting for a draft. */
  queue: FleetJob[];
  /** Listing ids scouts have already surfaced, so "new" means new. */
  seen: string[];
  guardrails: Guardrails;
  usage: { day: string; actions: number };
  /** Consecutive days the user reviewed approvals or ran the fleet. */
  streak: { count: number; lastDay: string };
  /** Start of the previous visit — the digest covers what happened since. */
  lastVisitAt: string;
  chat: ChatMessage[];
  /** Listings per source from Scout's latest real scan (feeds the live map). */
  sources?: Record<string, number>;
  setupDismissed?: boolean;
};

// Caps keep the slice small (the whole workspace is capped at 1 MB).
export const MAX_RUNS = 80;
export const MAX_APPROVALS = 60;
export const MAX_QUEUE = 30;
export const MAX_SEEN = 400;
export const MAX_CHAT = 40;
export const MAX_STEPS = 24;
export const DESC_CHARS = 700;

/**
 * Where scheduled runs happen. The scheduler lives in FleetProvider, mounted by
 * app/dashboard/agents/layout.tsx, so agents run while an Agent Fleet page is
 * open. Mount the provider higher up and update this sentence to match.
 */
export const RUNS_WHILE = "while your Autopilot dashboard is open in a tab";

export const SCHEDULE_MS: Partial<Record<Schedule, number>> = {
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "3h": 3 * 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

export const SCHEDULE_LABEL: Record<Schedule, string> = {
  manual: "Manual only",
  chain: "After Scout finds matches",
  "15m": "Every 15 minutes",
  "30m": "Every 30 minutes",
  "1h": "Every hour",
  "3h": "Every 3 hours",
  "6h": "Every 6 hours",
  daily: "Once a day",
};

export const AUTONOMY: { id: Autonomy; label: string; short: string; desc: string }[] = [
  { id: "manual", label: "Manual", short: "Manual", desc: "Only runs when you press Run." },
  { id: "assisted", label: "Assisted", short: "Assisted", desc: "Runs on its schedule and reports what it found. You decide what happens next." },
  { id: "approve", label: "Approve each", short: "Approve", desc: "Runs on schedule, hands work to the next agent and prepares drafts. Every draft waits for your OK." },
  { id: "auto", label: "Auto within rules", short: "Auto", desc: "Also keeps your pipeline tidy on its own, inside your guardrails. Anything sent to a client still needs your OK." },
];

export const KIND_META: Record<AgentKind, { label: string; verb: string; color: string; hex: string; does: string[] }> = {
  scout: {
    label: "Scout", verb: "Scanning job feeds", color: "text-violet-400", hex: "#a78bfa",
    does: ["Scans Job Radar's public feeds and approved APIs", "Scores every listing against your skills", "Hands new strong matches to Writer"],
  },
  writer: {
    label: "Writer", verb: "Drafting proposals", color: "text-fuchsia-400", hex: "#e879f9",
    does: ["Writes a tailored proposal for each match", "Follows your prompt and rules", "Puts every draft in Approvals"],
  },
  applier: {
    label: "Applier", verb: "Working the pipeline", color: "text-sky-400", hex: "#38bdf8",
    does: ["Keeps your Job Radar pipeline current", "Drafts follow-ups when clients go quiet", "Flags stale applications"],
  },
  closer: {
    label: "Closer", verb: "Answering messages", color: "text-emerald-400", hex: "#34d399",
    does: ["Reads unread client messages in your inbox", "Drafts a reply in your tone", "Leaves sending to you"],
  },
  keeper: {
    label: "Account Keeper", verb: "Checking accounts", color: "text-amber-400", hex: "#fbbf24",
    does: ["Checks your connected platform accounts", "Watches Upwork and mailbox connections", "Warns before bid credits run out"],
  },
};

export type Template = {
  id: string;
  kind: AgentKind;
  name: string;
  blurb: string;
  tags: string[];
  defaults: Partial<FleetAgent>;
};

export const TEMPLATES: Template[] = [
  { id: "gig-scout", kind: "scout", name: "Gig Scout", blurb: "Scans freelance feeds every hour for gigs that match your skills.", tags: ["Freelance", "Popular"], defaults: { scanKind: "gig", schedule: "1h", minMatch: 60 } },
  { id: "job-scout", kind: "scout", name: "Remote Job Scout", blurb: "Finds remote roles on public job boards and company career pages.", tags: ["Jobs"], defaults: { scanKind: "job", schedule: "3h", minMatch: 55 } },
  { id: "big-budget", kind: "scout", name: "High-budget Hunter", blurb: "Only surfaces listings at $1,000 or more, so you spend bids where they pay.", tags: ["Freelance", "Selective"], defaults: { scanKind: "gig", schedule: "1h", minMatch: 50, minBudget: 1000 } },
  { id: "writer", kind: "writer", name: "Proposal Writer", blurb: "Drafts a tailored proposal for every strong match the moment Scout finds it.", tags: ["Popular"], defaults: { schedule: "chain", perRunLimit: 3, tone: "professional" } },
  { id: "writer-short", kind: "writer", name: "Fast-turnaround Writer", blurb: "Short, punchy proposals for quick gigs where speed wins.", tags: ["Freelance"], defaults: { schedule: "chain", perRunLimit: 5, tone: "concise", instructions: "Keep it under 90 words. Lead with how fast I can start." } },
  { id: "applier", kind: "applier", name: "Application Tracker", blurb: "Keeps your pipeline current and drafts a polite follow-up when a client goes quiet.", tags: ["Pipeline"], defaults: { schedule: "6h", followUpDays: 4 } },
  { id: "closer", kind: "closer", name: "Inbox Closer", blurb: "Drafts replies to unread client messages so nobody waits on you.", tags: ["Inbox"], defaults: { schedule: "30m", tone: "friendly" } },
  { id: "keeper", kind: "keeper", name: "Account Keeper", blurb: "Checks connected accounts, mailbox sync and your bid credits once a day.", tags: ["Health"], defaults: { schedule: "daily" } },
];

const BASE_AGENT: Omit<FleetAgent, "id" | "kind" | "name" | "role" | "createdAt"> = {
  state: "paused",
  autonomy: "approve",
  schedule: "1h",
  query: "",
  scanKind: "all",
  sources: [],
  minMatch: 60,
  minBudget: 0,
  excludeKeywords: [],
  tone: "professional",
  instructions: "",
  perRunLimit: 3,
  followUpDays: 4,
};

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function agentFromTemplate(t: Template, overrides: Partial<FleetAgent> = {}): FleetAgent {
  return {
    ...BASE_AGENT,
    ...t.defaults,
    id: newId("ag"),
    kind: t.kind,
    name: t.name,
    role: t.blurb,
    createdAt: new Date().toISOString(),
    templateId: t.id,
    ...overrides,
  };
}

const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!;

/** A new account's fleet: one of each agent, paused until the user starts it. */
export function defaultFleet(): FleetState {
  const created = "2026-01-01T00:00:00.000Z";
  const mk = (id: string, templateId: string, name: string, role: string, extra: Partial<FleetAgent> = {}) =>
    ({ ...agentFromTemplate(tpl(templateId)), id, name, role, createdAt: created, ...extra });
  return {
    v: 1,
    agents: [
      mk("scout", "gig-scout", "Scout", "Finds matching jobs and gigs", { scanKind: "all" }),
      mk("writer", "writer", "Writer", "Drafts proposals for strong matches"),
      mk("applier", "applier", "Applier", "Keeps your pipeline moving"),
      mk("closer", "closer", "Closer", "Drafts replies to client messages"),
      mk("keeper", "keeper", "Account Keeper", "Watches your accounts and credits"),
    ],
    runs: [],
    approvals: [],
    queue: [],
    seen: [],
    guardrails: {
      killSwitch: false,
      dailyActionCap: 30,
      quietHours: { enabled: true, start: "23:00", end: "07:00" },
      minMatch: 40,
      sources: [],
      blockKeywords: [],
    },
    usage: { day: "", actions: 0 },
    streak: { count: 0, lastDay: "" },
    lastVisitAt: "",
    chat: [],
  };
}

export const DEFAULT_FLEET: FleetState = defaultFleet();

/** Fills fields added after a workspace was first saved. */
export function normalizeFleet(f: FleetState | undefined | null): FleetState {
  const base = defaultFleet();
  if (!f || f.v !== 1) return base;
  return {
    ...base,
    ...f,
    agents: (f.agents ?? base.agents).map((a) => ({ ...BASE_AGENT, ...a })),
    guardrails: { ...base.guardrails, ...(f.guardrails ?? {}), quietHours: { ...base.guardrails.quietHours, ...(f.guardrails?.quietHours ?? {}) } },
    usage: f.usage ?? base.usage,
    streak: f.streak ?? base.streak,
  };
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function inQuietHours(g: Guardrails, now = new Date()): boolean {
  if (!g.quietHours.enabled) return false;
  const start = minutesOf(g.quietHours.start);
  const end = minutesOf(g.quietHours.end);
  const cur = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

export function actionsToday(f: FleetState): number {
  return f.usage.day === dayKey() ? f.usage.actions : 0;
}

export function actionsLeft(f: FleetState): number {
  return Math.max(0, f.guardrails.dailyActionCap - actionsToday(f));
}

/** Why a scheduled run can't start right now, or null if it can. */
export function blockedReason(f: FleetState, agent: FleetAgent, opts: { scheduled: boolean }): string | null {
  if (f.guardrails.killSwitch) return "The kill switch is on.";
  if (agent.state === "stopped") return agent.stoppedReason || "This agent is stopped.";
  if (opts.scheduled) {
    if (agent.state !== "running") return "This agent is paused.";
    if (agent.autonomy === "manual") return "Manual agents only run when you press Run.";
    if (inQuietHours(f.guardrails)) return `Quiet hours (${f.guardrails.quietHours.start}–${f.guardrails.quietHours.end}).`;
  }
  if ((agent.kind === "writer" || agent.kind === "closer") && actionsLeft(f) <= 0) {
    return `Daily cap reached (${f.guardrails.dailyActionCap} drafts). It resets at midnight.`;
  }
  return null;
}

/** When a scheduled agent is next due, or null if it isn't on a timer. */
export function nextRunAt(agent: FleetAgent): number | null {
  const every = SCHEDULE_MS[agent.schedule];
  if (!every || agent.state !== "running" || agent.autonomy === "manual") return null;
  const last = agent.lastRunAt ? Date.parse(agent.lastRunAt) : 0;
  return last ? last + every : Date.now();
}

export function runsToday(f: FleetState, agentId?: string): FleetRun[] {
  const today = dayKey();
  return f.runs.filter((r) => dayKey(new Date(r.startedAt)) === today && (!agentId || r.agentId === agentId) && !r.dryRun);
}

export function successRate(runs: FleetRun[]): number | null {
  const done = runs.filter((r) => r.status === "success" || r.status === "error");
  if (!done.length) return null;
  return Math.round((done.filter((r) => r.status === "success").length * 100) / done.length);
}

export function pendingApprovals(f: FleetState): Approval[] {
  return f.approvals.filter((a) => a.status === "pending");
}

export function sumMetric(runs: FleetRun[], key: string): number {
  return runs.reduce((n, r) => n + (r.metrics[key] ?? 0), 0);
}

export type AgentHealth = "working" | "running" | "waiting" | "paused" | "stopped" | "error";

export function agentHealth(f: FleetState, agent: FleetAgent, working: boolean): AgentHealth {
  if (working) return "working";
  if (agent.state === "stopped") return "stopped";
  if (f.guardrails.killSwitch) return "stopped";
  if (agent.lastStatus === "error") return "error";
  if (agent.state === "paused") return "paused";
  if (pendingApprovals(f).some((a) => a.agentId === agent.id)) return "waiting";
  return "running";
}

export const HEALTH_STYLE: Record<AgentHealth, { label: string; dot: string; pill: string }> = {
  working: { label: "Working", dot: "bg-primary animate-pulse", pill: "bg-primary/15 text-primary" },
  running: { label: "Running", dot: "bg-success", pill: "bg-success/15 text-success" },
  waiting: { label: "Waiting on you", dot: "bg-warning", pill: "bg-warning/15 text-warning" },
  paused: { label: "Paused", dot: "bg-muted-foreground", pill: "bg-muted text-muted-foreground" },
  stopped: { label: "Stopped", dot: "bg-destructive", pill: "bg-destructive/15 text-destructive" },
  error: { label: "Needs attention", dot: "bg-destructive", pill: "bg-destructive/15 text-destructive" },
};

export function budgetNumber(b: FleetJob["budget"]): number | null {
  if (b == null || b === "") return null;
  if (typeof b === "number") return b;
  const m = String(b).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function formatBudget(job: Pick<FleetJob, "budget" | "currency">): string {
  const n = budgetNumber(job.budget);
  if (n == null) return typeof job.budget === "string" && job.budget ? job.budget : "Budget not listed";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: job.currency || "USD", maximumFractionDigits: 0 }).format(n);
}

export function splitList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export function trimFleet(f: FleetState): FleetState {
  // Keep pending approvals; drop the oldest resolved ones first.
  let approvals = f.approvals;
  if (approvals.length > MAX_APPROVALS) {
    const pending = approvals.filter((a) => a.status === "pending");
    const resolved = approvals.filter((a) => a.status !== "pending").slice(0, Math.max(0, MAX_APPROVALS - pending.length));
    approvals = [...pending, ...resolved].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return {
    ...f,
    runs: f.runs.slice(0, MAX_RUNS),
    approvals,
    queue: f.queue.slice(0, MAX_QUEUE),
    seen: f.seen.slice(-MAX_SEEN),
    chat: f.chat.slice(-MAX_CHAT),
  };
}

/** Records that the user showed up today (keeps the streak honest). */
export function touchStreak(f: FleetState): FleetState {
  const today = dayKey();
  if (f.streak.lastDay === today) return f;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const count = f.streak.lastDay === dayKey(y) ? f.streak.count + 1 : 1;
  return { ...f, streak: { count, lastDay: today } };
}
