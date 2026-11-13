/**
 * Copilot command parser — turns plain-English instructions into fleet
 * actions without an AI call ("pause all bidding", "run scout for react",
 * "why did Writer stop"). Anything it can't parse goes to the server's
 * /api/fleet/copilot, which uses the configured LLM when there is one.
 */
import type { Autonomy, FleetAgent } from "@/lib/fleet";

export type CopilotAction =
  | { type: "pause"; ids: string[] | "all" }
  | { type: "resume"; ids: string[] | "all" }
  | { type: "stop"; ids: string[] }
  | { type: "kill"; on: boolean }
  | { type: "run"; id: string; query?: string; dryRun?: boolean }
  | { type: "explain"; id: string }
  | { type: "autonomy"; id: string; level: Autonomy }
  | { type: "cap"; value: number }
  | { type: "quiet"; start: string; end: string }
  | { type: "quiet-off" }
  | { type: "status" }
  | { type: "approvals" }
  | { type: "digest" }
  | { type: "help" };

const KIND_WORDS: Record<FleetAgent["kind"], string[]> = {
  scout: ["scout", "scan", "scanner", "search", "find", "radar"],
  writer: ["writer", "write", "draft", "drafts", "proposal", "proposals"],
  applier: ["applier", "apply", "pipeline", "follow-up", "follow up", "followup", "applications"],
  closer: ["closer", "inbox", "reply", "replies", "messages", "message"],
  keeper: ["keeper", "account keeper", "accounts", "account", "credits", "health"],
};

/** Agents a phrase refers to: exact names first, then kind words. */
export function resolveAgents(text: string, agents: FleetAgent[]): FleetAgent[] {
  const t = ` ${text.toLowerCase()} `;
  const byName = agents.filter((a) => t.includes(` ${a.name.toLowerCase()}`));
  if (byName.length) return byName;
  if (/\bbid(ding|s)?\b/.test(t)) return agents.filter((a) => a.kind === "scout" || a.kind === "writer");
  const kinds = (Object.keys(KIND_WORDS) as FleetAgent["kind"][]).filter((k) =>
    KIND_WORDS[k].some((w) => new RegExp(`\\b${w.replace(/[-\s]/g, "[-\\s]?")}\\b`).test(t))
  );
  return agents.filter((a) => kinds.includes(a.kind));
}

const TIME = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
function toHHMM(raw: string): string | null {
  const m = raw.match(TIME);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseCommand(input: string, agents: FleetAgent[]): CopilotAction | null {
  const text = input.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (!text) return null;
  if (/^(help|what can you do|commands|\?)$/.test(text)) return { type: "help" };

  if (/\b(kill switch|emergency stop|stop everything|stop all|halt)\b/.test(text) && !/\bbid/.test(text)) {
    return { type: "kill", on: !/\b(off|disable|release|resume|turn off)\b/.test(text) };
  }

  const all = /\b(all|everything|every agent|whole fleet|fleet)\b/.test(text);
  const targets = resolveAgents(text, agents);
  const ids = (): string[] | "all" => (all && !/\bbid/.test(text) ? "all" : targets.map((a) => a.id));

  if (/^(pause|hold|sleep)\b|\bpause\b/.test(text) && !/\bwhy\b/.test(text)) {
    const t = ids();
    if (t === "all" || t.length) return { type: "pause", ids: t };
  }
  if (/^(resume|start|unpause|wake|turn on)\b|\b(resume|unpause)\b/.test(text)) {
    const t = ids();
    if (t === "all" || t.length) return { type: "resume", ids: t };
  }
  if (/^stop\b/.test(text) && targets.length) return { type: "stop", ids: targets.map((a) => a.id) };

  const cap = text.match(/\b(?:daily )?(?:cap|limit)\b.*?(\d{1,4})|(\d{1,4})\s*(?:drafts|actions)\s*(?:a|per)\s*day/);
  if (cap) return { type: "cap", value: Number(cap[1] ?? cap[2]) };

  if (/\bquiet hours?\b/.test(text)) {
    if (/\b(off|disable|none|turn off)\b/.test(text)) return { type: "quiet-off" };
    const parts = text.split(/\s(?:to|until|-|–)\s|(?<=\d)\s*[-–]\s*(?=\d)/);
    if (parts.length >= 2) {
      const start = toHHMM(parts[0].replace(/.*?(\d)/, "$1"));
      const end = toHHMM(parts[1]);
      if (start && end) return { type: "quiet", start, end };
    }
  }

  const level = /\b(auto(matic)?|autopilot)\b/.test(text) ? "auto"
    : /\bapprove each|approval\b/.test(text) ? "approve"
    : /\bassist(ed)?\b/.test(text) ? "assisted"
    : /\bmanual\b/.test(text) ? "manual" : null;
  if (level && /\b(set|make|switch|change|put)\b/.test(text) && targets.length) {
    return { type: "autonomy", id: targets[0].id, level };
  }

  if (/^(why|what happened|what's wrong|whats wrong)\b/.test(text) && targets.length) {
    return { type: "explain", id: targets[0].id };
  }

  if (/\b(dry run|dry-run|test run|preview)\b/.test(text) && targets.length) {
    return { type: "run", id: targets[0].id, dryRun: true };
  }

  // "run scout for react", "scan for figma", "find shopify gigs"
  const runVerb = /^(run|scan|search|find|look for|hunt|check|draft|write)\b/.test(text);
  if (runVerb) {
    const scoutish = /^(scan|search|find|look for|hunt)\b/.test(text);
    const agent = targets[0] ?? (scoutish ? agents.find((a) => a.kind === "scout") : undefined);
    if (agent) {
      let query: string | undefined;
      const q = text.match(/\b(?:for|about|on)\s+(.+)$/);
      if (agent.kind === "scout") {
        query = q?.[1] ?? (scoutish ? text.replace(/^(scan|search|find|look for|hunt)\s+/, "").replace(/\b(jobs?|gigs?|listings?|work)\b/g, "").trim() : undefined);
        if (query) query = query.replace(/\b(jobs?|gigs?|listings?)\b/g, "").replace(/\s+/g, " ").trim() || undefined;
      }
      return { type: "run", id: agent.id, query };
    }
  }

  if (/\b(approvals?|waiting|pending|to review|needs? me)\b/.test(text)) return { type: "approvals" };
  if (/\b(digest|summary|summarize|today|overnight|what did|recap|report)\b/.test(text)) return { type: "digest" };
  if (/\b(status|how are|health|running)\b/.test(text)) return { type: "status" };
  if (targets.length === 1 && /\b(why|stopp?ed|paused|stuck|error|fail)/.test(text)) return { type: "explain", id: targets[0].id };
  return null;
}

export const COPILOT_SUGGESTIONS = [
  "What's waiting on me?",
  "Scan for react gigs",
  "Pause all bidding",
  "Why did Writer stop?",
  "Give me today's summary",
  "Set daily cap to 20",
];

export const COPILOT_HELP = [
  "Here's what I can do:",
  "• “scan for figma gigs” or “run scout for react” — run a scan now",
  "• “dry run writer” — preview a run without saving anything",
  "• “pause all bidding”, “resume closer”, “stop everything”",
  "• “why did Scout stop?” — explain an agent's state",
  "• “set writer to auto” — change autonomy",
  "• “set daily cap to 20”, “quiet hours 11pm to 7am”",
  "• “what's waiting on me?”, “today's summary”",
].join("\n");
