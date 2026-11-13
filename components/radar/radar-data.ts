/**
 * Pure helpers shared by Job Radar and Gigs: money labels, facets parsed from
 * the listing text, skill matching, links, and the browser's copy of the last
 * scan (so detail and apply pages still open after the server's index expires,
 * and in the frontend-only demo).
 */
import { formatCurrency } from "@/lib/utils";
import type { Application, Kind, Listing } from "./types";

export const BASE: Record<Kind, string> = { job: "/dashboard/job-radar", gig: "/dashboard/gigs" };

export const listingHref = (kind: Kind, id: string) => `${BASE[kind]}/${encodeURIComponent(id)}`;
export const applyHref = (kind: Kind, id: string) => `${listingHref(kind, id)}/apply`;

/** Route params arrive percent-encoded in some Next versions; decode once, safely. */
export function decodeId(param: string): string {
  if (!param.includes("%")) return param;
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

export const kindOf = (l: { kind?: Kind | string | null }): Kind => (l.kind === "gig" ? "gig" : "job");

// ---------------------------------------------------------------- money ----

/** Feeds report amounts in their own currency (EUR, GBP…); never assume dollars. */
export function money(amount: number | null | undefined, currency?: string | null): string {
  const n = Number(amount);
  if (!amount || !Number.isFinite(n)) return "";
  try {
    return formatCurrency(n, currency || "USD");
  } catch {
    return n.toLocaleString();
  }
}

/** $150k, €2.5k, $45 — for tight spaces. */
export function compactMoney(amount: number | null | undefined, currency?: string | null): string {
  const n = Number(amount);
  if (!amount || !Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: currency || "USD", notation: n >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: n >= 10_000 ? 1 : 0,
    }).format(n);
  } catch {
    return n.toLocaleString();
  }
}

/** Gig budget: "$250–$750 fixed", "$30–$45/hr", or just the amount. */
export function gigBudget(l: Listing): { amount: string; unit: string } {
  if (!l.budget) return { amount: "", unit: "" };
  const hi = compactMoney(l.budget, l.currency);
  const lo = l.budgetMin ? compactMoney(l.budgetMin, l.currency) : "";
  const amount = lo ? `${lo}–${hi}` : hi;
  if (l.rateType === "hourly") return { amount, unit: "/hr" };
  if (l.rateType === "fixed") return { amount, unit: "fixed" };
  return { amount, unit: "" };
}

/** Job pay: "Up to $150k" (salaries) or the amount. */
export function jobPay(l: Listing): string {
  if (!l.budget) return "";
  const v = compactMoney(l.budget, l.currency);
  return l.budget >= 1000 ? `Up to ${v}` : v;
}

// --------------------------------------------------------------- facets ----

/** Boards that only list remote roles. */
const REMOTE_ONLY = new Set([
  "RemoteOK", "WeWorkRemotely", "Jobicy", "Himalayas", "Working Nomads", "Remotive",
  "Real Work From Anywhere", "NoDesk",
]);

export type Facets = { workplace: string | null; type: string | null; seniority: string | null };

/**
 * Facets read from the listing itself. Nothing is guessed: when the text
 * doesn't say, the facet is null and the UI doesn't show it.
 */
export function facets(l: Listing): Facets {
  const text = `${l.title} ${(l.tags ?? []).join(" ")} ${l.description}`;
  const workplace = REMOTE_ONLY.has(l.source) || /\b(remote|work from anywhere|wfh)\b/i.test(text)
    ? (/\bhybrid\b/i.test(text) ? "Hybrid" : "Remote")
    : /\bhybrid\b/i.test(text) ? "Hybrid"
    : /\b(on-?site|in[- ]office)\b/i.test(text) ? "On-site" : null;
  const type = /\bfull[- ]?time\b/i.test(text) ? "Full-time"
    : /\bpart[- ]?time\b/i.test(text) ? "Part-time"
    : /\bintern(ship)?\b/i.test(text) ? "Internship"
    : /\bfreelanc/i.test(text) ? "Freelance"
    : /\bcontract/i.test(text) || l.kind === "gig" ? "Contract" : null;
  const title = l.title;
  const seniority = /\b(head of|director|vp|chief|cto|ceo)\b/i.test(title) ? "Executive"
    : /\b(principal|staff|lead)\b/i.test(title) ? "Lead"
    : /\b(senior|sr\.?)\b/i.test(title) ? "Senior"
    : /\b(junior|jr\.?|entry[- ]level|graduate)\b/i.test(title) ? "Junior"
    : /\bintern\b/i.test(title) ? "Intern"
    : /\b(mid[- ]?level|intermediate)\b/i.test(title) ? "Mid-level" : null;
  return { workplace, type, seniority };
}

// ------------------------------------------------------------- matching ----

const tokens = (s: string) => new Set((s || "").toLowerCase().split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1));

export const skillList = (q: string) => q.split(",").map((s) => s.trim()).filter(Boolean);

/** Which of the user's skills the listing mentions (same rule as the server's score). */
export function matchBreakdown(l: Listing, skills: string[]): { matched: string[]; missing: string[] } {
  const hay = tokens(`${l.title} ${(l.tags ?? []).join(" ")} ${l.company} ${l.description}`);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const sk of skills) {
    const t = tokens(sk);
    if (Array.from(t).some((x) => hay.has(x))) matched.push(sk);
    else missing.push(sk);
  }
  return { matched, missing };
}

export const matchTone = (score: number) =>
  score >= 80 ? "text-success" : score >= 60 ? "text-primary" : "text-muted-foreground";

// ---------------------------------------------------------------- misc ----

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const ageMs = (iso: string) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? Date.now() - t : Infinity;
};

/** A deterministic hue per company so avatars are stable and distinguishable. */
export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** A tracked application, as a listing — the detail page's last-resort source. */
export function appToListing(a: Application): Listing {
  return {
    id: a.jobId, kind: a.kind ?? "job", title: a.title, company: a.company, source: a.source, url: a.url,
    tags: a.tags ?? [], budget: a.budget, currency: a.currency ?? null, description: a.description ?? "",
    postedAt: a.postedAt ?? "", matchScore: a.matchScore ?? 0,
  };
}

// ------------------------------------------------------ last-scan cache ----

export type ScanSnapshot = { query: string; fetchedAt: string; jobs: Listing[]; sources: string[] };

const scanKey = (userId: string, kind: Kind) => `radar.lastScan.v1:${userId}:${kind}`;

export function readScan(userId: string | undefined, kind: Kind): ScanSnapshot | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(scanKey(userId, kind));
    return raw ? (JSON.parse(raw) as ScanSnapshot) : null;
  } catch {
    return null;
  }
}

export function writeScan(userId: string | undefined, kind: Kind, snap: ScanSnapshot) {
  if (!userId || typeof window === "undefined") return;
  try {
    localStorage.setItem(scanKey(userId, kind), JSON.stringify(snap));
  } catch {
    /* storage full or blocked — the feed still works for this visit */
  }
}

/** Look a listing up in this browser's last scans (either product). */
export function findInScans(userId: string | undefined, id: string): { listing: Listing; pool: Listing[] } | null {
  for (const kind of ["job", "gig"] as Kind[]) {
    const snap = readScan(userId, kind);
    const hit = snap?.jobs.find((j) => j.id === id);
    if (hit && snap) return { listing: hit, pool: snap.jobs };
  }
  return null;
}

/** Same kind, ranked by shared tags and title words (mirrors the server). */
export function similarFrom(l: Listing, pool: Listing[], n = 4): Listing[] {
  const tags = new Set((l.tags ?? []).map((t) => t.toLowerCase()));
  const words = tokens(l.title);
  return pool
    .filter((r) => r.id !== l.id && kindOf(r) === kindOf(l))
    .map((r) => {
      const shared = (r.tags ?? []).filter((t) => tags.has(t.toLowerCase())).length;
      const titleHits = Array.from(tokens(r.title)).filter((w) => words.has(w)).length;
      return { r, score: 2 * shared + titleHits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.matchScore - a.r.matchScore)
    .slice(0, n)
    .map((x) => x.r);
}

/** Upwork listings are human-in-the-loop only: Autopilot drafts, the user submits on upwork.com. */
export const isUpwork = (l: { source?: string; url?: string }): boolean =>
  /^upwork/i.test(l.source ?? "") || /(^|\.)upwork\.com$/i.test(hostOf(l.url ?? ""));
