"use client";
/**
 * Treasury and financial reporting (platform owners). SIMULATED: shapes mirror backend/app/routers/treasury.py and
 * backend/app/capital/treasury.py. Every figure is an internal demo-ledger balance in integer cents (or pool-share units
 * for the SHARE unit); none of it is real money.
 */
import * as React from "react";
import { API_URL, apiFetch } from "@/lib/api";

/** The credit prototype's own treasury (GET /api/credit/admin/treasury), passed through unchanged. */
export type CreditTreasury = {
  contributionsCents: number; cashCents: number; committedCents: number; availableCents: number; outstandingCents: number;
  feesCents: number; lossesCents: number; repaymentsCents?: number; disbursedCents?: number; ledgerCheck?: boolean;
  agreements?: Record<string, number>;
};
export type Check = { key: string; label: string; ok: boolean; detail: string };
export type BalanceGroup = {
  key: string; label: string; unit: string; total: number;
  accounts: { account: string; balance: number }[];
  aggregate: { count: number; total: number } | null;
};
export type ClaimStat = { count: number; amountCents: number; paidCents: number };
export type TreasuryOverview = {
  settlement: "simulated"; notice: string; asOf: string; seq: number; ok: boolean;
  kpis: {
    pool: { navCents: number; cashCents: number; outstandingCents: number; capitalCents: number; feeIncomeCents: number; writtenOffCents: number };
    protection: {
      cashCents: number; incomeCents: number; premiumsCents: number; feeShareCents: number; payoutsCents: number;
      activeCovers: number; activeExposureCents: number; coverageRatioBps: number | null;
    };
    claims: Record<string, ClaimStat>;
    platform: { cashCents: number; incomeCents: number };
    credit: CreditTreasury;
    customers: { usdCents: number; usdAccounts: number; usdcCents: number; usdcAccounts: number; totalCents: number };
    escrow: { totalCents: number; listings: number };
    shares: { issuedUnits: number; displayShares: number; sharePriceCents: number; holderAccounts: number; heldUnits: number; tokenUnits: number };
  };
  groups: BalanceGroup[];
  checks: Check[];
};

export type ReportGroup = {
  key: string; label: string; unit: string; opening: number; netFlow: number; closing: number;
  accounts: { account: string; opening: number; closing: number }[];
  aggregate: { openingCount: number; closingCount: number; opening: number; closing: number } | null;
};
export type TreasuryReport = {
  settlement: "simulated"; notice: string; generatedAt: string; start: string; end: string; entries: number;
  groups: ReportGroup[];
  flows: { kind: string; count: number; grossCents: number }[];
  income: {
    poolFeeIncomeCents: number; protectionPremiumsCents: number; protectionFeeShareCents: number; platformIncomeCents: number;
    marketplaceFeesCents: number; creditFeesCents: number; totalCents: number;
  };
  losses: {
    poolWriteOffsCents: number; poolRecoveriesCents: number; creditWriteOffsCents: number; creditRecoveriesCents: number;
    protectionPayoutsCents: number; totalCents: number;
  };
  external: { account: string; inCents: number; outCents: number; netInCents: number }[];
};

export const MAX_PERIOD_DAYS = 366;

/** Pool shares are stored in units: one displayed share is 1,000,000 units. */
export const SHARE_UNITS = 1_000_000;

/** YYYY-MM-DD in UTC: the backend reports by UTC day. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** The current UTC month to date. */
export function defaultPeriod(now = new Date()): { start: string; end: string } {
  return { start: `${utcDay(now).slice(0, 8)}01`, end: utcDay(now) };
}

/** Client-side mirror of the server's period rules, so the form can explain a bad range before asking. */
export function periodError(start: string, end: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(start) || !re.test(end)) return "Choose a start and an end date.";
  const s = Date.parse(`${start}T00:00:00Z`), e = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return "Choose valid dates.";
  if (e < s) return "The end date is before the start date.";
  if ((e - s) / 86_400_000 + 1 > MAX_PERIOD_DAYS) return `Choose a period of at most ${MAX_PERIOD_DAYS} days.`;
  return null;
}

/** Ledger amounts by unit: cents as dollars, share units as shares. */
export function amount(value: number, unit: string): string {
  if (unit === "USD") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
  if (unit === "SHARE") return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value / SHARE_UNITS)} sh`;
  return `${value.toLocaleString("en-US")} ${unit}`;
}

/** Coverage ratio from integer basis points (10,000 = the fund equals the active cover). */
export const ratio = (bps: number | null) => (bps == null ? "No active cover" : `${(bps / 10_000).toFixed(2)}×`);

export const kindLabel = (kind: string) => kind.replace(/_/g, " ");

type Read<T> = { status: number; data: T | null; detail: string | null };

async function read<T>(path: string): Promise<Read<T>> {
  try {
    const res = await apiFetch(path);
    if (res.ok) return { status: res.status, data: (await res.json()) as T, detail: null };
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
    return { status: res.status, data: null, detail: typeof body.detail === "string" ? body.detail : null };
  } catch {
    return { status: 0, data: null, detail: null };
  }
}

const period = (start: string, end: string) => `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;

/** Owner overview: figures, grouped balances and integrity checks. */
export function useTreasuryOverview() {
  const [tick, setTick] = React.useState(0);
  const [state, setState] = React.useState<{ data: TreasuryOverview | null; loaded: boolean; denied: boolean; failed: boolean }>(
    { data: null, loaded: !API_URL, denied: false, failed: false });
  React.useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    void read<TreasuryOverview>("/api/treasury/overview").then((r) => {
      if (cancelled) return;
      setState({ data: r.data, loaded: true, denied: r.status === 401 || r.status === 403, failed: r.data === null });
    });
    return () => { cancelled = true; };
  }, [tick]);
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}

export const loadReport = (start: string, end: string) => read<TreasuryReport>(`/api/treasury/report?${period(start, end)}`);

/**
 * Downloads the period's journal as CSV. The export is cookie-authenticated, so it is fetched with the session and saved
 * from a blob rather than opened as a link. Returns an error message, or null on success.
 */
export async function downloadJournalCsv(start: string, end: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/api/treasury/journal.csv?${period(start, end)}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      return typeof body.detail === "string" ? body.detail : `The export failed (${res.status}).`;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `treasury-journal-${start}-to-${end}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return null;
  } catch {
    return "Can't reach the server.";
  }
}
