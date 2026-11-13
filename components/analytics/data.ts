"use client";
/**
 * Analytics — computed in the browser from the signed-in user's own data:
 *   Money ledger (workspace `ledger`): income, expenses, invoices
 *   Job Radar pipeline (workspace `radar.applications`)
 *   Outreach (workspace `growth`): campaigns and direct outreach
 *   Agent Fleet runs (workspace slice `fleet`)
 *   Calendar (workspace `calendarEvents`)
 *   Orders (server, GET /api/orders) when a backend is connected
 * Nothing here is sample data: a new account sees zeros and empty states.
 * Each source is read defensively, since the features that own them evolve.
 */
import * as React from "react";
import { useDemoStore, useWorkspaceSlice } from "@/lib/demo-store";
import { SERVER_FEATURES, useApi } from "@/components/security/use-api";

export type RangeId = "7d" | "30d" | "90d" | "12m" | "all";
export const RANGES: { id: RangeId; label: string; long: string }[] = [
  { id: "7d", label: "7D", long: "Last 7 days" },
  { id: "30d", label: "30D", long: "Last 30 days" },
  { id: "90d", label: "90D", long: "Last 90 days" },
  { id: "12m", label: "12M", long: "Last 12 months" },
  { id: "all", label: "All", long: "All time" },
];

type Bucket = "day" | "week" | "month";
export type Window = { from: string | null; to: string; prevFrom: string | null; prevTo: string | null; bucket: Bucket };

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local calendar day of an ISO timestamp or a YYYY-MM-DD date. */
export const keyOf = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : dayKey(new Date(t));
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parseKey = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));

export function windowFor(range: RangeId, earliest: string | null): Window {
  const today = new Date();
  const to = dayKey(today);
  if (range === "all") {
    const from = earliest;
    const span = from ? (parseKey(to).getTime() - parseKey(from).getTime()) / 86_400_000 : 0;
    return { from, to, prevFrom: null, prevTo: null, bucket: span > 120 ? "month" : span > 31 ? "week" : "day" };
  }
  if (range === "12m") {
    const from = dayKey(new Date(today.getFullYear(), today.getMonth() - 11, 1));
    const prevFrom = dayKey(new Date(today.getFullYear(), today.getMonth() - 23, 1));
    return { from, to, prevFrom, prevTo: dayKey(addDays(parseKey(from), -1)), bucket: "month" };
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const from = dayKey(addDays(today, -(days - 1)));
  return {
    from, to, prevFrom: dayKey(addDays(today, -(2 * days - 1))), prevTo: dayKey(addDays(today, -days)),
    bucket: days === 90 ? "week" : "day",
  };
}

export const inWindow = (k: string | null, w: Window) => !!k && (!w.from || k >= w.from) && k <= w.to;
export const inPrev = (k: string | null, w: Window) => !!k && !!w.prevFrom && !!w.prevTo && k >= w.prevFrom && k <= w.prevTo;

/** Ordered buckets covering the window, e.g. one per day or per month. */
export function buckets(w: Window): { key: string; label: string; match: (k: string) => boolean }[] {
  if (!w.from) return [];
  const out: { key: string; label: string; match: (k: string) => boolean }[] = [];
  const start = parseKey(w.from);
  const end = parseKey(w.to);
  if (w.bucket === "month") {
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const prefix = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      out.push({ key: prefix, label: d.toLocaleDateString("en", { month: "short", year: d.getMonth() === 0 ? "2-digit" : undefined }), match: (k) => k.startsWith(prefix) });
    }
    return out;
  }
  const step = w.bucket === "week" ? 7 : 1;
  for (let d = start; d <= end; d = addDays(d, step)) {
    const a = dayKey(d);
    const b = dayKey(addDays(d, step - 1));
    out.push({ key: a, label: d.toLocaleDateString("en", { month: "short", day: "numeric" }), match: (k) => k >= a && k <= b });
  }
  return out;
}

/** % change vs the previous period; undefined when there's nothing to compare. */
export function change(now: number, before: number | null): number | undefined {
  if (before === null || before === 0) return undefined;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);
const arr = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);

export function rank(rows: { name: string; value: number }[], top = 6): { name: string; value: number }[] {
  const merged = new Map<string, number>();
  for (const r of rows) merged.set(r.name, (merged.get(r.name) ?? 0) + r.value);
  const sorted = Array.from(merged.entries()).map(([name, value]) => ({ name, value })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= top) return sorted;
  const rest = sorted.slice(top - 1).reduce((n, r) => n + r.value, 0);
  return [...sorted.slice(0, top - 1), { name: "Other", value: rest }];
}

// --------------------------------------------------------------------------- //
// Sources
// --------------------------------------------------------------------------- //
export const STAGES = ["Saved", "Drafted", "Applied", "Interview", "Won"] as const;
const STAGE_RANK: Record<string, number> = { Saved: 0, Drafted: 1, Applied: 2, Lost: 2, Ghosted: 2, Interview: 3, Won: 4 };

export type Sources = {
  ready: boolean;
  txns: { date: string; type: "income" | "expense"; amount: number; category: string; party: string }[];
  invoices: { client: string; amount: number; issued: string; due: string; status: string; paidOn?: string; paidVia?: string; milestones: { amount: number; due: string; status: string; paidOn?: string; paidVia?: string }[] }[];
  applications: { stage: string; at: string | null; source: string; title: string; respondedAt: string | null }[];
  campaigns: { at: string | null; sent: number; failed: number; name: string }[];
  outreach: { at: string | null; status: string; platform: string }[];
  runs: { at: string | null; agent: string; status: string; dryRun: boolean }[];
  events: { date: string; kind: string; title: string }[];
  orders: { at: string | null; platform: string; status: string; amount: number; currency: string | null }[];
  ordersAvailable: boolean;
};

export function useAnalyticsSources(): Sources {
  const store = useDemoStore();
  const s = store?.state as Record<string, any> | undefined;
  const ordersApi = useApi<{ orders: Record<string, any>[] }>(SERVER_FEATURES ? "/api/orders" : null);

  return React.useMemo(() => {
    const ledger = (s?.ledger ?? {}) as Record<string, any>;
    const txns = arr(ledger.txns)
      .map((t) => ({ date: str(t.date), type: (t.type === "expense" ? "expense" : "income") as "income" | "expense", amount: num(t.amount), category: str(t.category, "Uncategorized"), party: str(t.party, "Unknown") }))
      .filter((t) => keyOf(t.date) && t.amount > 0);
    const invoices = arr(ledger.invoices).map((i) => ({
      client: str(i.client, "Unknown client"), amount: num(i.amount), issued: str(i.issued), due: str(i.due), status: str(i.status, "Draft"),
      paidOn: str(i.paidOn) || undefined, paidVia: str(i.paidVia) || undefined,
      milestones: arr(i.milestones).map((m) => ({ amount: num(m.amount), due: str(m.due), status: str(m.status, "Due"), paidOn: str(m.paidOn) || undefined, paidVia: str(m.paidVia) || undefined })),
    }));
    const applications = arr(s?.radar?.applications).map((a) => {
      const history = arr(a.history);
      const responded = history.find((h) => ["Interview", "Won", "Lost"].includes(str(h.stage)));
      return {
        stage: str(a.stage, "Saved"), at: keyOf(a.appliedAt ?? a.createdAt), source: str(a.source, "Other"), title: str(a.title, "Untitled"),
        respondedAt: keyOf(responded?.at ?? a.respondedAt),
      };
    });
    const growth = (s?.growth ?? {}) as Record<string, any>;
    const campaigns = arr(growth.campaigns).map((c) => ({ at: keyOf(c.createdAt ?? c.at), sent: num(c.sent), failed: num(c.failed), name: str(c.name, "Campaign") }));
    const outreach = arr(growth.outreach).map((o) => ({ at: keyOf(o.at ?? o.createdAt), status: str(o.status, "Draft"), platform: str(o.platform, "Other") }));
    const runs = arr(s?.slices?.fleet?.runs).map((r) => ({ at: keyOf(r.startedAt), agent: str(r.agentName, "Agent"), status: str(r.status), dryRun: Boolean(r.dryRun) }));
    const events = arr(s?.calendarEvents).map((e) => ({ date: str(e.date), kind: str(e.kind, "event"), title: str(e.title) })).filter((e) => keyOf(e.date));
    const orders = arr(ordersApi.data?.orders).map((o) => ({
      at: keyOf(o.orderCreatedAt ?? o.arrivedAt ?? o.detectedAt), platform: str(o.platform, "Other"), status: str(o.status, "unknown"),
      amount: o.pricing === "hourly" ? 0 : num(o.amount), currency: typeof o.currency === "string" ? o.currency : null,
    }));
    return {
      ready: Boolean(store?.hydrated), txns, invoices, applications, campaigns, outreach, runs, events, orders,
      ordersAvailable: SERVER_FEATURES && !!ordersApi.data,
    };
  }, [s, store?.hydrated, ordersApi.data]);
}

/** Earliest dated record across every source — where "All time" starts. */
export function earliestKey(src: Sources): string | null {
  const keys = [
    ...src.txns.map((t) => keyOf(t.date)), ...src.invoices.map((i) => keyOf(i.issued)), ...src.applications.map((a) => a.at),
    ...src.campaigns.map((c) => c.at), ...src.outreach.map((o) => o.at), ...src.runs.map((r) => r.at), ...src.orders.map((o) => o.at),
  ].filter((k): k is string => !!k);
  return keys.length ? keys.sort()[0] : null;
}

/** The analytics date range, remembered with the workspace. */
export function useRange(): [RangeId, (r: RangeId) => void] {
  const [prefs, setPrefs] = useWorkspaceSlice<{ range: RangeId }>("analytics.prefs", { range: "30d" });
  const range = RANGES.some((r) => r.id === prefs.range) ? prefs.range : "30d";
  return [range, (r) => setPrefs((p) => ({ ...p, range: r }))];
}

// --------------------------------------------------------------------------- //
// Derived metrics
// --------------------------------------------------------------------------- //
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
const daysBetween = (a: string, b: string) => Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86_400_000);

export function moneyMetrics(src: Sources, w: Window) {
  const inRange = src.txns.filter((t) => inWindow(keyOf(t.date), w));
  const prev = src.txns.filter((t) => inPrev(keyOf(t.date), w));
  const income = sum(inRange.filter((t) => t.type === "income").map((t) => t.amount));
  const expense = sum(inRange.filter((t) => t.type === "expense").map((t) => t.amount));
  const prevIncome = w.prevFrom ? sum(prev.filter((t) => t.type === "income").map((t) => t.amount)) : null;
  const prevExpense = w.prevFrom ? sum(prev.filter((t) => t.type === "expense").map((t) => t.amount)) : null;
  const series = buckets(w).map((b) => ({
    label: b.label,
    income: sum(inRange.filter((t) => t.type === "income" && b.match(t.date)).map((t) => t.amount)),
    expense: sum(inRange.filter((t) => t.type === "expense" && b.match(t.date)).map((t) => t.amount)),
  }));
  const byClient = rank(inRange.filter((t) => t.type === "income").map((t) => ({ name: t.party, value: t.amount })));
  const incomeByCategory = rank(inRange.filter((t) => t.type === "income").map((t) => ({ name: t.category, value: t.amount })));
  const expenseByCategory = rank(inRange.filter((t) => t.type === "expense").map((t) => ({ name: t.category, value: t.amount })));

  // Invoices: payments received in range, by how they were paid.
  const VIA: Record<string, string> = { debit: "Debit card", credit: "Credit card", crypto: "Crypto (USDC)", manual: "Recorded by hand" };
  const paidParts = src.invoices.flatMap((i) =>
    i.milestones.length
      ? i.milestones.filter((m) => m.status === "Paid").map((m) => ({ amount: m.amount, paidOn: m.paidOn, via: m.paidVia }))
      : i.status === "Paid" ? [{ amount: i.amount, paidOn: i.paidOn, via: i.paidVia }] : []
  ).filter((p) => inWindow(keyOf(p.paidOn), w));
  const byMethod = rank(paidParts.map((p) => ({ name: VIA[p.via ?? "manual"] ?? "Recorded by hand", value: p.amount })));

  const today = dayKey(new Date());
  const open = src.invoices.filter((i) => i.status === "Sent");
  const dueParts = open.flatMap((i) => (i.milestones.length ? i.milestones.filter((m) => m.status !== "Paid") : [{ amount: i.amount, due: i.due, status: "Due" }]));
  const outstanding = sum(dueParts.map((p) => p.amount));
  const aging = [
    { name: "Not due yet", value: sum(dueParts.filter((p) => !p.due || p.due >= today).map((p) => p.amount)) },
    { name: "1–30 days late", value: sum(dueParts.filter((p) => p.due && p.due < today && daysBetween(p.due, today) <= 30).map((p) => p.amount)) },
    { name: "31–60 days late", value: sum(dueParts.filter((p) => p.due && daysBetween(p.due, today) > 30 && daysBetween(p.due, today) <= 60).map((p) => p.amount)) },
    { name: "60+ days late", value: sum(dueParts.filter((p) => p.due && daysBetween(p.due, today) > 60).map((p) => p.amount)) },
  ];
  const overdue = sum(aging.slice(1).map((a) => a.value));
  const paidInvoices = src.invoices.filter((i) => i.status === "Paid" && i.issued && i.paidOn && inWindow(keyOf(i.paidOn), w));
  const avgDaysToPaid = paidInvoices.length
    ? Math.round(paidInvoices.reduce((n, i) => n + Math.max(0, daysBetween(i.issued, i.paidOn!)), 0) / paidInvoices.length)
    : null;
  const issuedInRange = src.invoices.filter((i) => i.status !== "Draft" && inWindow(keyOf(i.issued), w));

  return {
    income, expense, net: Math.round((income - expense) * 100) / 100, prevIncome, prevExpense,
    prevNet: prevIncome === null || prevExpense === null ? null : prevIncome - prevExpense,
    series, byClient, incomeByCategory, expenseByCategory, byMethod, outstanding, overdue, aging, avgDaysToPaid,
    paidCount: paidInvoices.length, issuedCount: issuedInRange.length, issuedValue: sum(issuedInRange.map((i) => i.amount)),
    hasAny: src.txns.length > 0 || src.invoices.length > 0,
  };
}

export function pipelineMetrics(src: Sources, w: Window) {
  const apps = src.applications.filter((a) => inWindow(a.at, w));
  const prevApps = src.applications.filter((a) => inPrev(a.at, w));
  const reached = (min: number, list = apps) => list.filter((a) => (STAGE_RANK[a.stage] ?? 0) >= min).length;
  const funnel = STAGES.map((stage, i) => ({ stage, value: reached(i) }));
  const applied = reached(2);
  const won = apps.filter((a) => a.stage === "Won").length;
  const lost = apps.filter((a) => a.stage === "Lost").length;
  const ghosted = apps.filter((a) => a.stage === "Ghosted").length;
  const interviews = reached(3);
  const responded = apps.filter((a) => ["Interview", "Won", "Lost"].includes(a.stage)).length;
  const prevApplied = w.prevFrom ? reached(2, prevApps) : null;
  const respondTimes = apps.filter((a) => a.at && a.respondedAt).map((a) => Math.max(0, daysBetween(a.at!, a.respondedAt!)));
  const sources = new Map<string, { total: number; won: number }>();
  for (const a of apps.filter((x) => (STAGE_RANK[x.stage] ?? 0) >= 2)) {
    const row = sources.get(a.source) ?? { total: 0, won: 0 };
    row.total += 1;
    if (a.stage === "Won") row.won += 1;
    sources.set(a.source, row);
  }
  return {
    tracked: apps.length, applied, prevApplied, won, lost, ghosted, interviews, funnel,
    winRate: applied ? Math.round((won / applied) * 1000) / 10 : null,
    responseRate: applied ? Math.round((responded / applied) * 1000) / 10 : null,
    avgDaysToResponse: respondTimes.length ? Math.round((respondTimes.reduce((a, b) => a + b, 0) / respondTimes.length) * 10) / 10 : null,
    bySource: Array.from(sources.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total).slice(0, 8),
    series: buckets(w).map((b) => ({ label: b.label, value: apps.filter((a) => a.at && b.match(a.at)).length })),
    outcomes: [
      { name: "Won", value: won }, { name: "In interview", value: apps.filter((a) => a.stage === "Interview").length },
      { name: "Waiting to hear", value: apps.filter((a) => a.stage === "Applied").length }, { name: "Lost", value: lost }, { name: "Ghosted", value: ghosted },
    ],
  };
}

export function outreachMetrics(src: Sources, w: Window) {
  const campaigns = src.campaigns.filter((c) => inWindow(c.at, w));
  const outreach = src.outreach.filter((o) => inWindow(o.at, w));
  const byStatus = rank(outreach.map((o) => ({ name: o.status, value: 1 })), 6);
  return {
    campaigns: campaigns.length, sent: sum(campaigns.map((c) => c.sent)), failed: sum(campaigns.map((c) => c.failed)),
    direct: outreach.length, byStatus, byPlatform: rank(outreach.map((o) => ({ name: o.platform, value: 1 })), 6),
  };
}

export function agentMetrics(src: Sources, w: Window) {
  const runs = src.runs.filter((r) => !r.dryRun && inWindow(r.at, w));
  const done = runs.filter((r) => r.status === "success" || r.status === "error");
  return {
    runs: runs.length,
    succeeded: runs.filter((r) => r.status === "success").length,
    failed: runs.filter((r) => r.status === "error").length,
    successRate: done.length ? Math.round((runs.filter((r) => r.status === "success").length / done.length) * 1000) / 10 : null,
    byAgent: rank(runs.map((r) => ({ name: r.agent, value: 1 })), 6),
    series: buckets(w).map((b) => ({ label: b.label, value: runs.filter((r) => r.at && b.match(r.at)).length })),
  };
}

export function orderMetrics(src: Sources, w: Window) {
  const orders = src.orders.filter((o) => inWindow(o.at, w));
  const active = src.orders.filter((o) => ["active", "delivered", "paused"].includes(o.status)).length;
  return {
    total: orders.length, active,
    completed: orders.filter((o) => o.status === "completed").length,
    cancelled: orders.filter((o) => ["cancelled", "refunded", "disputed"].includes(o.status)).length,
    byPlatform: rank(orders.map((o) => ({ name: o.platform, value: 1 })), 6),
    valueUsd: sum(orders.filter((o) => !o.currency || o.currency === "USD").map((o) => o.amount)),
  };
}

export function calendarMetrics(src: Sources) {
  const today = dayKey(new Date());
  const week = dayKey(addDays(new Date(), 7));
  return { upcoming: src.events.filter((e) => e.date >= today && e.date <= week).length };
}
