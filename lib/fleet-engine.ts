/**
 * Agent Fleet run engine. Each agent kind calls the app's real features
 * through `FleetDeps` (Job Radar scans, proposal drafts, the inbox, account
 * checks) and returns an outcome the provider applies to the fleet state.
 *
 * Nothing here sends anything to a client or a marketplace: proposals,
 * replies and follow-ups become Approvals the user acts on.
 */
import type { Row } from "@/lib/demo-engine";
import {
  type Approval, type FleetAgent, type FleetJob, type FleetState, type RunStatus, type RunStep, type StepTone,
  DESC_CHARS, MAX_STEPS, actionsLeft, budgetNumber, newId, splitList,
} from "@/lib/fleet";

export type FleetDeps = {
  /** True when the Autopilot server is connected (real account). */
  hasBackend: boolean;
  userName: string;
  scan: (query: string, kind: string) => Promise<{ jobs: Row[]; sources: string[] } | null>;
  skills: () => Promise<string[]>;
  draft: (job: FleetJob, agent: FleetAgent) => Promise<{ text: string; proposalId?: string; aiGenerated: boolean } | null>;
  conversations: () => Promise<Row[] | null>;
  replyDraft: (messageId: string, tone: string) => Promise<{ reply: string; aiGenerated: boolean } | null>;
  applications: () => Row[];
  track: (job: Row, stage: string, proposal?: string) => void;
  accounts: () => Row[];
  inboxStatus: () => Promise<Row | null>;
  monetization: () => { plan: string; bidCredits: number };
};

export type RunOutcome = {
  status: RunStatus;
  summary: string;
  metrics: Record<string, number>;
  approvals: Approval[];
  queueAdd: FleetJob[];
  queueDone: string[];
  seenAdd: string[];
  actionsUsed: number;
  /** Agent kinds to run next (Scout → Writer). */
  chain: FleetAgent["kind"][];
  sourceCounts?: Record<string, number>;
  error?: string;
};

type Ctx = {
  agent: FleetAgent;
  fleet: FleetState;
  deps: FleetDeps;
  dryRun: boolean;
  step: (text: string, tone?: StepTone) => void;
};

const emptyOutcome = (): RunOutcome => ({
  status: "success", summary: "", metrics: {}, approvals: [], queueAdd: [], queueDone: [], seenAdd: [], actionsUsed: 0, chain: [],
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function executeRun(
  agent: FleetAgent,
  fleet: FleetState,
  deps: FleetDeps,
  opts: { dryRun: boolean; onStep: (s: RunStep) => void }
): Promise<{ outcome: RunOutcome; steps: RunStep[] }> {
  const steps: RunStep[] = [];
  const step = (text: string, tone: StepTone = "info") => {
    const s = { at: now(), text, tone };
    if (steps.length < MAX_STEPS) steps.push(s);
    opts.onStep(s);
  };
  const ctx: Ctx = { agent, fleet, deps, dryRun: opts.dryRun, step };
  if (opts.dryRun) step("Dry run: nothing will be saved, drafted or tracked.", "info");
  let outcome: RunOutcome;
  try {
    outcome = await RUNNERS[agent.kind](ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    step(message, "error");
    outcome = { ...emptyOutcome(), status: "error", summary: message, error: message };
  }
  if (opts.dryRun) {
    // A dry run only reports; it never changes the fleet.
    outcome = { ...outcome, approvals: [], queueAdd: [], queueDone: [], seenAdd: [], actionsUsed: 0, chain: [], sourceCounts: undefined };
  }
  return { outcome, steps };
}

// ----------------------------------------------------------------------------
// Scout — real Job Radar scans
// ----------------------------------------------------------------------------

function toFleetJob(j: Row, foundBy: string): FleetJob {
  return {
    id: String(j.id),
    title: String(j.title ?? "Untitled listing"),
    company: String(j.company ?? ""),
    source: String(j.source ?? ""),
    url: String(j.url ?? ""),
    budget: j.budget ?? null,
    currency: j.currency ?? null,
    tags: Array.isArray(j.tags) ? j.tags.slice(0, 8).map(String) : [],
    description: String(j.description ?? "").slice(0, DESC_CHARS),
    postedAt: j.postedAt ? String(j.postedAt) : undefined,
    matchScore: Number(j.matchScore ?? 0),
    kind: j.kind === "gig" || j.kind === "job" ? j.kind : undefined,
    foundAt: now(),
    foundBy,
    status: "new",
  };
}

async function runScout({ agent, fleet, deps, dryRun, step }: Ctx): Promise<RunOutcome> {
  const out = emptyOutcome();
  let query = agent.query.trim();
  if (!query) {
    const skills = await deps.skills();
    query = skills.join(", ");
    if (query) step(`Using your Job Radar skills: ${query}`);
  }
  if (!query) {
    step("No skills to search for. Add keywords to this agent or your Job Radar profile.", "warn");
    return { ...out, status: "skipped", summary: "Needs skills to search for" };
  }
  const allowed = intersect(agent.sources, fleet.guardrails.sources);
  step(`Searching ${allowed.length ? allowed.join(", ") : "every enabled source"} for “${query}”`);
  const res = await deps.scan(query, agent.scanKind);
  if (!res) {
    step(deps.hasBackend ? "Couldn't reach the job service. Will retry next run." : "Job scans need the Autopilot server, which isn't connected in this preview.", deps.hasBackend ? "error" : "warn");
    return { ...out, status: deps.hasBackend ? "error" : "skipped", summary: deps.hasBackend ? "Job service unreachable" : "Server not connected", error: deps.hasBackend ? "Job service unreachable" : undefined };
  }
  const scanned = res.jobs.length;
  step(`Scanned ${plural(scanned, "listing")} from ${plural(res.sources.length, "source")}`, scanned ? "ok" : "warn");

  const floor = Math.max(agent.minMatch, fleet.guardrails.minMatch);
  const blocked = [...agent.excludeKeywords, ...fleet.guardrails.blockKeywords].map((k) => k.toLowerCase()).filter(Boolean);
  const seen = new Set(fleet.seen);
  const queued = new Set(fleet.queue.map((q) => q.id));
  let low = 0, budgetMiss = 0, blockedHits = 0, old = 0, sourceMiss = 0;
  const matches: FleetJob[] = [];
  for (const j of res.jobs) {
    const id = String(j.id);
    if (seen.has(id) || queued.has(id)) { old++; continue; }
    if (allowed.length && !allowed.includes(String(j.source))) { sourceMiss++; continue; }
    if (Number(j.matchScore ?? 0) < floor) { low++; continue; }
    const budget = budgetNumber(j.budget);
    if (agent.minBudget > 0 && (budget == null || budget < agent.minBudget)) { budgetMiss++; continue; }
    const hay = `${j.title} ${j.description ?? ""} ${(j.tags ?? []).join(" ")}`.toLowerCase();
    if (blocked.some((k) => hay.includes(k))) { blockedHits++; continue; }
    matches.push(toFleetJob(j, agent.name));
  }
  const skippedBits = [
    old && `${old} already seen`, low && `${low} under ${floor}% match`, budgetMiss && `${budgetMiss} under budget`,
    blockedHits && `${blockedHits} blocked by keywords`, sourceMiss && `${sourceMiss} from other sources`,
  ].filter(Boolean);
  if (skippedBits.length) step(`Filtered out ${skippedBits.join(", ")}`);
  matches.sort((a, b) => b.matchScore - a.matchScore);
  const top = matches.slice(0, Math.max(agent.perRunLimit * 3, 10));
  if (top.length) {
    step(`${plural(top.length, "new match", "new matches")} ≥ ${floor}%: best is “${top[0].title}” at ${top[0].matchScore}%`, "ok");
  } else {
    step("No new matches this time.", "info");
  }
  out.metrics = { scanned, matches: top.length };
  out.sourceCounts = res.jobs.reduce<Record<string, number>>((acc, j) => {
    const src = String(j.source || "Other");
    acc[src] = (acc[src] ?? 0) + 1;
    return acc;
  }, {});
  out.queueAdd = top;
  out.seenAdd = top.map((m) => m.id);
  out.summary = top.length ? `${plural(top.length, "new match", "new matches")} from ${plural(scanned, "listing")}` : `No new matches in ${plural(scanned, "listing")}`;
  if (top.length && (agent.autonomy === "approve" || agent.autonomy === "auto")) out.chain = ["writer"];
  if (dryRun && top.length) step(`Would hand ${plural(top.length, "match", "matches")} to Writer.`);
  return out;
}

function intersect(a: string[], b: string[]): string[] {
  if (!a.length) return b;
  if (!b.length) return a;
  return a.filter((x) => b.includes(x));
}

// ----------------------------------------------------------------------------
// Writer — real proposal drafts (POST /api/radar/proposal)
// ----------------------------------------------------------------------------

async function runWriter({ agent, fleet, deps, dryRun, step }: Ctx): Promise<RunOutcome> {
  const out = emptyOutcome();
  const waiting = fleet.queue.filter((q) => q.status === "new").sort((a, b) => b.matchScore - a.matchScore);
  if (!waiting.length) {
    step("Nothing to draft: no new matches waiting from Scout.", "info");
    return { ...out, status: "skipped", summary: "No matches waiting" };
  }
  const room = Math.min(agent.perRunLimit, actionsLeft(fleet));
  if (room <= 0) {
    step(`Daily cap of ${fleet.guardrails.dailyActionCap} drafts reached. Resets at midnight.`, "warn");
    return { ...out, status: "skipped", summary: "Daily cap reached" };
  }
  const batch = waiting.slice(0, room);
  step(`${plural(waiting.length, "match", "matches")} waiting; drafting the best ${batch.length}.`);
  if (agent.instructions.trim()) step(`Following your rules: “${agent.instructions.trim().slice(0, 120)}”`);
  let drafted = 0, failed = 0;
  for (const job of batch) {
    step(`Drafting a proposal for “${job.title}” (${job.matchScore}% match)`);
    if (dryRun) {
      await pause(250);
      step("Would draft and send it to Approvals.", "info");
      continue;
    }
    const res = await deps.draft(job, agent);
    if (!res) {
      failed++;
      step(`Couldn't draft “${job.title}”. It stays in the queue for the next run.`, "error");
      continue;
    }
    drafted++;
    step(res.aiGenerated ? "Draft ready (AI-written)." : "Draft ready (template: AI writing isn't configured on the server).", "ok");
    out.queueDone.push(job.id);
    out.approvals.push({
      id: newId("ap"),
      kind: "proposal",
      agentId: agent.id,
      agentName: agent.name,
      title: job.title,
      subtitle: [job.company, job.source].filter(Boolean).join(" · "),
      body: res.text,
      url: job.url,
      job,
      proposalId: res.proposalId,
      matchScore: job.matchScore,
      aiGenerated: res.aiGenerated,
      createdAt: now(),
      status: "pending",
    });
    // Approve-each and Auto put the draft in the Job Radar pipeline too.
    if (agent.autonomy === "approve" || agent.autonomy === "auto") {
      deps.track({ ...job, budget: budgetNumber(job.budget) }, "Drafted", res.text);
    }
  }
  out.actionsUsed = drafted;
  out.metrics = { drafted, failed };
  if (failed && !drafted) {
    out.status = "error";
    out.error = "Proposal service unreachable";
  }
  out.summary = dryRun ? `Would draft ${plural(batch.length, "proposal")}` : drafted ? `${plural(drafted, "proposal")} ready for your OK` : "No drafts written";
  return out;
}

// ----------------------------------------------------------------------------
// Applier — the Job Radar pipeline (follow-ups, stale applications)
// ----------------------------------------------------------------------------

const DAY = 86_400_000;

function followUpText(app: Row, userName: string): string {
  const first = (userName || "").split(" ")[0];
  return [
    `Hi — following up on my proposal for “${app.title}”.`,
    "I'm still very interested and available to start this week. Happy to jump on a short call or share a relevant example if that helps you decide.",
    first ? `Thanks, ${first}` : "Thanks",
  ].join("\n\n");
}

async function runApplier({ agent, fleet, deps, dryRun, step }: Ctx): Promise<RunOutcome> {
  const out = emptyOutcome();
  const apps = deps.applications();
  if (!apps.length) {
    step("Your pipeline is empty. Approve a proposal or track a job in Job Radar to start it.", "info");
    return { ...out, status: "skipped", summary: "Pipeline is empty" };
  }
  const by = (stage: string) => apps.filter((a) => a.stage === stage).length;
  step(`Pipeline: ${by("Drafted")} drafted · ${by("Applied")} applied · ${by("Interview")} interviewing · ${by("Won")} won`, "ok");

  const hasFollowUp = new Set(fleet.approvals.filter((a) => a.kind === "follow-up").map((a) => a.appJobId));
  const due = apps.filter((a) => a.stage === "Applied" && !hasFollowUp.has(a.jobId)
    && Date.now() - Date.parse(a.appliedAt ?? "") > agent.followUpDays * DAY);
  const room = Math.min(agent.perRunLimit, actionsLeft(fleet));
  const batch = due.slice(0, room);
  if (due.length) step(`${plural(due.length, "application")} quiet for ${agent.followUpDays}+ days.`, "warn");
  for (const app of batch) {
    step(dryRun ? `Would draft a follow-up for “${app.title}”.` : `Drafted a follow-up for “${app.title}”.`, dryRun ? "info" : "ok");
    if (dryRun) continue;
    out.approvals.push({
      id: newId("ap"), kind: "follow-up", agentId: agent.id, agentName: agent.name,
      title: `Follow up: ${app.title}`, subtitle: [app.company, app.source].filter(Boolean).join(" · "),
      body: followUpText(app, deps.userName), url: app.url, appJobId: app.jobId,
      createdAt: now(), status: "pending",
    });
  }
  // Auto: applications silent for 3× the follow-up window are marked Ghosted.
  let ghosted = 0;
  if (agent.autonomy === "auto") {
    const stale = apps.filter((a) => a.stage === "Applied" && hasFollowUp.has(a.jobId)
      && Date.now() - Date.parse(a.appliedAt ?? "") > agent.followUpDays * 3 * DAY);
    for (const app of stale) {
      ghosted++;
      if (!dryRun) deps.track({ id: app.jobId, title: app.title, company: app.company, url: app.url, source: app.source }, "Ghosted");
    }
    if (ghosted) step(`${dryRun ? "Would mark" : "Marked"} ${plural(ghosted, "silent application")} as Ghosted.`, "info");
  }
  out.actionsUsed = dryRun ? 0 : batch.length;
  out.metrics = { tracked: apps.length, followUps: batch.length, ghosted };
  out.summary = batch.length ? `${plural(batch.length, "follow-up")} ready for your OK` : `Pipeline checked: ${plural(apps.length, "application")}`;
  return out;
}

// ----------------------------------------------------------------------------
// Closer — unread inbox threads (GET /api/conversations, reply drafts)
// ----------------------------------------------------------------------------

async function runCloser({ agent, fleet, deps, dryRun, step }: Ctx): Promise<RunOutcome> {
  const out = emptyOutcome();
  if (!deps.hasBackend) {
    step("The inbox needs the Autopilot server, which isn't connected in this preview.", "warn");
    return { ...out, status: "skipped", summary: "Server not connected" };
  }
  step("Reading your unified inbox");
  const threads = await deps.conversations();
  if (!threads) {
    step("Couldn't reach your inbox. Will retry next run.", "error");
    return { ...out, status: "error", summary: "Inbox unreachable", error: "Inbox unreachable" };
  }
  if (!threads.length) {
    step("No messages yet. Forward marketplace notification emails to your Autopilot inbox address (Accounts & Gigs) to start.", "info");
    return { ...out, status: "skipped", summary: "Inbox is empty" };
  }
  const already = new Set(fleet.approvals.filter((a) => a.kind === "reply" && a.status === "pending").map((a) => a.messageId));
  const unread = threads
    .map((t) => ({ t, msg: [...(t.thread ?? [])].reverse().find((m: Row) => m.unread && !m.replyDraft && m.from === "contact") }))
    .filter((x) => x.msg && !already.has(x.msg.id));
  step(`${plural(threads.length, "thread")} · ${plural(unread.length, "unread message")} without a reply`, unread.length ? "warn" : "ok");
  const room = Math.min(agent.perRunLimit, actionsLeft(fleet));
  let drafted = 0;
  for (const { t, msg } of unread.slice(0, room)) {
    step(`${dryRun ? "Would draft" : "Drafting"} a reply to ${t.contact} on ${t.channel}`);
    if (dryRun) continue;
    const res = await deps.replyDraft(msg!.id, agent.tone);
    if (!res) {
      step(`Couldn't draft a reply to ${t.contact}.`, "error");
      continue;
    }
    drafted++;
    out.approvals.push({
      id: newId("ap"), kind: "reply", agentId: agent.id, agentName: agent.name,
      title: `Reply to ${t.contact}`, subtitle: `${t.channel} · “${String(msg!.text ?? "").slice(0, 90)}”`,
      body: res.reply, url: t.deepLink || undefined, messageId: msg!.id, aiGenerated: res.aiGenerated,
      createdAt: now(), status: "pending",
    });
  }
  if (drafted) step(`${plural(drafted, "reply", "replies")} waiting for your OK.`, "ok");
  out.actionsUsed = drafted;
  out.metrics = { unread: unread.length, drafted };
  out.summary = unread.length ? (dryRun ? `Would draft ${plural(Math.min(unread.length, room), "reply", "replies")}` : `${plural(drafted, "reply", "replies")} drafted`) : "Inbox zero";
  return out;
}

// ----------------------------------------------------------------------------
// Account Keeper — connected accounts, mailbox sync, credits
// ----------------------------------------------------------------------------

async function runKeeper({ deps, step }: Ctx): Promise<RunOutcome> {
  const out = emptyOutcome();
  let issues = 0;
  const accounts = deps.accounts();
  if (!accounts.length) {
    issues++;
    step("No platform accounts linked yet. Link them in Accounts & Gigs so agents know where you work.", "warn");
  } else {
    const bad = accounts.filter((a) => !/connected|active/i.test(String(a.status ?? "")));
    issues += bad.length;
    step(bad.length ? `${plural(bad.length, "account")} need attention: ${bad.map((a) => a.platform).join(", ")}` : `${plural(accounts.length, "linked account")}, all healthy`, bad.length ? "warn" : "ok");
  }
  if (deps.hasBackend) {
    step("Upwork: forward your job-alert emails to Autopilot to get jobs in Gigs. You submit proposals yourself.", "info");
    const inbox = await deps.inboxStatus();
    if (inbox) step(inbox.ready ? "Mailbox sync is ready." : `Mailbox sync: ${inbox.reason}`, inbox.ready ? "ok" : "info");
  }
  const mon = deps.monetization();
  if (mon.plan === "pro") step("Pro plan: unlimited bids.", "ok");
  else if (mon.bidCredits <= 3) { issues++; step(`Only ${plural(mon.bidCredits, "bid credit")} left. Top up in Money before your next applications.`, "warn"); }
  else step(`${plural(mon.bidCredits, "bid credit")} left.`, "ok");
  out.metrics = { accounts: accounts.length, issues };
  out.summary = issues ? `${plural(issues, "thing")} need attention` : "Everything looks healthy";
  return out;
}

const RUNNERS: Record<FleetAgent["kind"], (ctx: Ctx) => Promise<RunOutcome>> = {
  scout: runScout,
  writer: runWriter,
  applier: runApplier,
  closer: runCloser,
  keeper: runKeeper,
};

/** Applies a finished run to the fleet (pure — the provider persists it). */
export function applyOutcome(f: FleetState, agentId: string, runId: string, outcome: RunOutcome, steps: RunStep[], dryRun: boolean): FleetState {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const usage = f.usage.day === day ? f.usage : { day, actions: 0 };
  const done = new Set(outcome.queueDone);
  const finishedAt = new Date().toISOString();
  return {
    ...f,
    agents: dryRun ? f.agents : f.agents.map((a) => a.id === agentId ? {
      ...a,
      lastRunAt: finishedAt,
      lastStatus: outcome.status,
      lastSummary: outcome.summary,
      lastError: outcome.status === "error" ? outcome.error ?? outcome.summary : undefined,
    } : a),
    runs: f.runs.map((r) => r.id === runId ? { ...r, status: outcome.status, summary: outcome.summary, metrics: outcome.metrics, steps, finishedAt } : r),
    approvals: [...outcome.approvals, ...f.approvals],
    queue: [...outcome.queueAdd, ...f.queue.map((q) => done.has(q.id) ? { ...q, status: "drafted" as const } : q)]
      .filter((q) => q.status === "new"),
    seen: [...f.seen, ...outcome.seenAdd],
    usage: { day, actions: usage.actions + outcome.actionsUsed },
    sources: !dryRun && outcome.sourceCounts && Object.keys(outcome.sourceCounts).length ? outcome.sourceCounts : f.sources,
  };
}
