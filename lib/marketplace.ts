"use client";
/**
 * Investment marketplace (raises, the Platform Index, portfolios, revenue-
 * sharing and project-funding agreements). Shapes mirror
 * backend/app/routers/marketplace.py. Money is integer cents.
 * SIMULATED SETTLEMENT: no money moves until a licensed partner is integrated.
 */
import * as React from "react";
import { API_URL, apiGet } from "@/lib/api";

export type ListingKind = "project_funding" | "revenue_share";
export type Grade = "A" | "B" | "C" | "D" | "E";
export type ListingStatus = "draft" | "open" | "disbursing" | "refunding" | "active" | "completed" | "cancelled" | "expired";

export type TrackRecord = {
  verifiedOrders: number; completedOrders: number; completedValueCents: number; trailingYearCents: number;
  activeValueCents: number; lossRate: number; platforms: string[]; firstOrderAt: string | null;
  score: number; grade: Grade; gradeNote: string; computedAt: string;
};

export type ExpectedReturn =
  | { kind: "fixed"; totalCents: number; rateBps: number; months: number }
  | { kind: "capped"; maxCents: number; shareBps: number; months: number };

export type Listing = {
  id: string; kind: ListingKind; title: string; summary: string; displayName: string; targetCents: number;
  minInvestmentCents: number; terms: { termMonths?: number; shareBps?: number; periodMonths?: number; capBps?: number };
  uses: { category: string; amountCents: number; note: string }[]; status: ListingStatus; grade: Grade; gradeNote: string;
  rateBps: number | null; trackRecord: TrackRecord; raisedCents: number; remainingCents: number; progressBps: number;
  investors: number; opensAt: string | null; closesAt: string | null; daysLeft: number | null; mine: boolean;
  myInvestedCents: number; agreementId: string | null; fundedCents: number; fundedAt: string | null;
  example: ExpectedReturn; createdAt: string; settlement: string;
  ownerEstimate?: { monthlyRevenueCents: number; projectedPaidCents: number; capCents: number } | null;
  minCloseBps?: number; originationFeeBps?: number;
};

export type MarketPolicy = {
  maxRaiseCents: number; minRaiseCents: number; minInvestmentCents: number; raiseDays: number; minCloseBps: number;
  originationFeeBps: number; projectRateBps: Record<Grade, number>; termMonths: number[]; revShareMinBps: number;
  revShareMaxBps: number; revPeriodMonths: number[]; revCapBps: number; useOfFunds: string[]; defaultAfterDays: number;
};

export type Balances = { usdCents: number; usdcCents: number };

export type MarketOverview = {
  settlement: string; balances: Balances; investorReasons: string[]; kycStatus: string;
  index: { count: number; capacityCents: number; grades: Grade[]; avgRateBps: number };
  pool: { navCents: number; realisedYieldCents: number; defaultRate: number; sharePriceCents: number };
  stats: { openRaises: number; raisingCents: number; fundedRaises: number; fundedCents: number };
  policy: MarketPolicy;
};

export type Investment = {
  id: string; listingId: string; amountCents: number; via: "direct" | "index"; kind: ListingKind; title: string;
  grade: Grade; status: "escrow" | "active" | "completed" | "defaulted" | "refunded"; agreementId?: string; createdAt: string;
};

export type Position = {
  investment: Investment;
  listing: { id: string; title: string; displayName: string; kind: ListingKind; grade: Grade; status: ListingStatus } | null;
  agreement: { id: string; status: AgreementStatus; endAt: string | null } | null;
  distributedCents: number; expected: ExpectedReturn | null;
};

export type Portfolio = {
  settlement: string; positions: Position[];
  distributions: { id: string; amountCents: number; at: string; title: string; agreementId: string }[];
  totals: { investedCents: number; distributedCents: number; outstandingCents: number; escrowCents: number; positions: number; defaultedCents: number };
  risk: { byGrade: Partial<Record<Grade, number>>; byKind: Partial<Record<ListingKind, number>> };
  pool: { valueCents: number; gainCents: number; depositedCents: number };
  balances: Balances;
};

export type AgreementStatus = "active" | "late" | "defaulted" | "completed";
export type Agreement = {
  id: string; listingId: string; kind: ListingKind; title: string; displayName: string; grade: Grade;
  principalCents: number; feeCents: number; startAt: string; endAt: string; status: AgreementStatus;
  totalDueCents: number; rateBps?: number; termMonths?: number; shareBps?: number; capCents?: number; periodMonths?: number;
  role: "borrower" | "investor"; paidCents: number; progressBps: number;
  payments: { id: string; amountCents: number; at: string; posted: boolean }[];
  schedule: { n: number; dueAt: string; amountCents: number; paidCents: number; status: "paid" | "partial" | "overdue" | "upcoming" }[];
  due: { dueNowCents: number; remainingCents: number; daysLate: number; nextDueAt: string | null; nextAmountCents: number; eligibleRevenueCents: number | null };
  myShare: { investedCents: number; shareBps: number; receivedCents: number } | null;
  settlement: string;
};

export type MyTrackRecord = TrackRecord & { kycStatus: string; rateBps: number };

/** The Platform Index has its own invest page at …/marketplace/platform-index/invest. */
export const INDEX_ID = "platform-index";

export const KIND_LABEL: Record<ListingKind, string> = {
  project_funding: "Project funding",
  revenue_share: "Revenue share",
};

export const USE_LABEL: Record<string, string> = {
  hiring: "Hiring", equipment: "Equipment", expansion: "Expansion", marketing: "Marketing", software: "Software & tools",
  working_capital: "Working capital", other: "Other",
};

export const STATUS_LABEL: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "default" }> = {
  draft: { label: "Draft", variant: "secondary" },
  open: { label: "Raising", variant: "default" },
  disbursing: { label: "Closing", variant: "warning" },
  refunding: { label: "Refunding", variant: "warning" },
  active: { label: "Funded", variant: "success" },
  completed: { label: "Repaid", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
  expired: { label: "Didn't fund", variant: "secondary" },
  escrow: { label: "In escrow", variant: "warning" },
  refunded: { label: "Refunded", variant: "secondary" },
  late: { label: "Late", variant: "warning" },
  defaulted: { label: "In default", variant: "destructive" },
};

/** Grade tones run from calm (A) to alarming (E); the letter is always shown. */
export const GRADE_TONE: Record<Grade, string> = {
  A: "bg-success/15 text-success ring-success/30",
  B: "bg-primary/15 text-primary ring-primary/30",
  C: "bg-sky-500/15 text-sky-500 ring-sky-500/30",
  D: "bg-warning/15 text-warning ring-warning/30",
  E: "bg-destructive/15 text-destructive ring-destructive/30",
};

export const MARKET_RISKS = [
  "Investments are not bank deposits, are not FDIC insured, and can lose some or all of their value.",
  "Businesses can repay late or default. Revenue-share payments depend on revenue the marketplaces verify, which can fall short of projections.",
  "There is no secondary market: your money is committed until the agreement ends or is repaid.",
  "Risk grades describe a verified track record, not a guarantee. Past results don't predict future results.",
];

export const bps = (b: number | null | undefined) =>
  b == null ? "—" : `${(b / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

/** "detail. reason one. reason two." from an API error body. */
export function errorText(data: unknown, fallback = "Can't reach the server."): string {
  const d = data as { detail?: unknown; reasons?: unknown } | null;
  const detail = typeof d?.detail === "string" ? d.detail : Array.isArray(d?.detail) ? "Check the form and try again." : "";
  const reasons = Array.isArray(d?.reasons) ? (d!.reasons as string[]) : [];
  return [detail, ...reasons].filter(Boolean).join(" ") || fallback;
}

/** GET a backend path and refresh on demand. `null` path or no backend: nothing loads. */
export function useApi<T>(path: string | null): { data: T | null; loaded: boolean; refresh: () => void } {
  const [tick, setTick] = React.useState(0);
  const [state, setState] = React.useState<{ data: T | null; loaded: boolean; for: string | null }>({
    data: null, loaded: !API_URL, for: null,
  });
  React.useEffect(() => {
    if (!API_URL || !path) return;
    let cancelled = false;
    void apiGet<T>(path).then((d) => {
      if (!cancelled) setState({ data: d, loaded: true, for: path });
    });
    return () => { cancelled = true; };
  }, [path, tick]);
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  // A changed path never shows the previous path's data.
  const fresh = state.for === path;
  return { data: fresh ? state.data : null, loaded: !API_URL || (fresh && state.loaded), refresh };
}

export const useMarketOverview = () => useApi<MarketOverview>("/api/marketplace/overview");
export const useListings = (query = "") => useApi<Listing[]>(`/api/marketplace/listings${query}`);
export const useMyListings = () => useApi<Listing[]>("/api/marketplace/my-listings");
export const useListing = (id: string | null) => useApi<Listing>(id ? `/api/marketplace/listings/${encodeURIComponent(id)}` : null);
export const usePortfolio = () => useApi<Portfolio>("/api/marketplace/portfolio");
export const useAgreements = () => useApi<{ borrower: Agreement[]; investor: Agreement[] }>("/api/marketplace/agreements");
export const useAgreement = (id: string | null) => useApi<Agreement>(id ? `/api/marketplace/agreements/${encodeURIComponent(id)}` : null);
export const useTrackRecord = () => useApi<MyTrackRecord>("/api/marketplace/track-record");

/** Where a marketplace page links for banking, by portal. */
export const bankingBase = (marketBase: string) => marketBase.replace(/\/marketplace$/, "/banking");
