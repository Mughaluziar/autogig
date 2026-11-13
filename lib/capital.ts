"use client";
/**
 * Capital program (investor pool, early payment, protection fund).
 * Shapes mirror backend/app/routers/capital.py. Money is integer cents.
 * SIMULATED SETTLEMENT: no money moves until a licensed partner is integrated.
 */
import * as React from "react";
import { API_URL, apiGet } from "@/lib/api";
import type { Order } from "@/lib/orders";

export type KycStatus = "none" | "pending" | "verified" | "rejected";

export type CapitalProfile = {
  roles: ("freelancer" | "investor")[];
  kyc: { status: KycStatus; legalName: string; country: string; method: string | null; submittedAt: string | null; reviewedAt: string | null; note: string };
  investor: { accredited: boolean; basis: string | null; attestedAt: string | null; riskAckAt: string | null };
  investorReasons: string[];
};

export type PoolSummary = {
  settlement: "simulated";
  currency: string;
  navCents: number;
  cashCents: number;
  outstandingCents: number;
  reserveCents: number;
  availableForAdvancesCents: number;
  realisedYieldCents: number;
  writtenOffCents: number;
  sharePriceCents: number;
  totalShares: number;
  protectionFundCents: number;
  protectionPaidCents: number;
  advances: Record<string, number>;
  defaultRate: number;
  policy: {
    advanceRateBps: number; feeBps: number; termDays: number; graceDays: number;
    investorShareBps: number; protectionShareBps: number; platformShareBps: number; liquidityReserveBps: number;
    protectionMaxCoverBps: number; protectionMaxCoverCents: number; protectionPremiumBps: number; protectionTermDays: number;
  };
};

export type Overview = { settlement: "simulated"; profile: CapitalProfile; pool: PoolSummary };

export type InvestorPosition = {
  shares: number; valueCents: number; depositedCents: number; withdrawnCents: number; gainCents: number;
  settlement: "simulated"; reasons: string[];
};

export type Underwriting = { eligible: boolean; reasons: string[]; orderCents: number; maxPrincipalCents: number; feeBps: number };
export type EligibleRow = { order: Order; underwriting: Underwriting; covered: boolean; coverClosesAt: string | null };

/** A new order still inside its protection window (GET /api/capital/coverages/offers). */
export type CoverOffer = {
  order: Order;
  closesAt: string;
  eligible: boolean;
  identityVerified: boolean;
  reasons: string[];
  maxCoverCents: number;
  premiumCents: number;
  premiumBps: number;
  termDays: number;
};

export type AdvanceStatus = "quoted" | "expired" | "disbursing" | "active" | "overdue" | "repaid" | "covered" | "defaulted" | "cancelled";
export type Advance = {
  id: string; orderId: string; platform: string; orderExternalId: string | null; orderTitle: string | null;
  orderCents: number; currency: string; principalCents: number; feeCents: number;
  feeSplit: { investors: number; protection: number; platform: number };
  status: AdvanceStatus; quoteExpiresAt: string; termDays: number; graceDays: number;
  principalRepaidCents: number; feeRepaidCents: number; principalCoveredCents: number; feeWaivedCents: number;
  writtenOffCents: number; coverageId: string | null; dueAt?: string; acceptedAt?: string;
  principalDueCents: number; feeDueCents: number; totalDueCents: number; createdAt: string; settlement: "simulated";
  /** Set when the early payment was received in the Autopilot balance instead of the bank. */
  payoutTo?: "usd_balance" | "usdc_balance";
};

export type Coverage = {
  id: string; orderId: string; kind: "advance" | "standalone"; advanceId: string | null; platform: string;
  orderTitle: string | null; coveredCents: number; premiumCents: number;
  status: "active" | "claimed" | "paid" | "expired"; startsAt: string; endsAt: string | null; createdAt: string;
};

export type Claim = {
  id: string; coverageId: string; orderId: string; platform: string; orderTitle: string | null;
  kind: "advance" | "standalone";
  status: "eligible" | "waiting" | "ineligible" | "paying" | "paid" | "denied";
  reason: string; amountCents: number; paidCents: number; payoutCents?: number; shortfallCents?: number;
  lossEvent: { to: string; at: string; source: string } | null; openedBy: "user" | "system";
  reviewNote?: string; createdAt: string; userId?: string;
};

export const usd = (cents: number | null | undefined) =>
  cents == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** "5h 12m" until `until`; "0m" once it has passed. */
export function timeLeft(until: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((Date.parse(until) - now) / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

export const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** Dollars typed by a user → integer cents, or null when invalid. */
export function toCents(value: string): number | null {
  const n = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export const newIdempotencyKey = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, "");

export const ADVANCE_LABELS: Record<AdvanceStatus, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "default" }> = {
  quoted: { label: "Quoted", variant: "secondary" },
  expired: { label: "Expired", variant: "secondary" },
  disbursing: { label: "Sending", variant: "warning" },
  active: { label: "Active", variant: "default" },
  overdue: { label: "Overdue", variant: "warning" },
  repaid: { label: "Repaid", variant: "success" },
  covered: { label: "Covered by insurance", variant: "success" },
  defaulted: { label: "In default", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export type CapitalData = {
  overview: Overview | null;
  position: InvestorPosition | null;
  orders: EligibleRow[];
  advances: Advance[];
  coverages: Coverage[];
  claims: Claim[];
  loaded: boolean;
  refresh: () => void;
};

/** Loads the capital sections a page needs and refreshes them together. */
export function useCapitalData(sections: { freelancer?: boolean; investor?: boolean }): CapitalData {
  const [tick, setTick] = React.useState(0);
  const [data, setData] = React.useState<Omit<CapitalData, "refresh">>({
    overview: null, position: null, orders: [], advances: [], coverages: [], claims: [], loaded: !API_URL,
  });
  const { freelancer, investor } = sections;
  React.useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    void Promise.all([
      apiGet<Overview>("/api/capital/overview"),
      investor ? apiGet<InvestorPosition>("/api/capital/investor") : Promise.resolve(null),
      freelancer ? apiGet<EligibleRow[]>("/api/capital/early-pay/orders") : Promise.resolve(null),
      freelancer ? apiGet<Advance[]>("/api/capital/advances") : Promise.resolve(null),
      freelancer ? apiGet<Coverage[]>("/api/capital/coverages") : Promise.resolve(null),
      freelancer ? apiGet<Claim[]>("/api/capital/claims") : Promise.resolve(null),
    ]).then(([overview, position, orders, advances, coverages, claims]) => {
      if (cancelled) return;
      setData({
        overview, position, orders: orders ?? [], advances: advances ?? [], coverages: coverages ?? [],
        claims: claims ?? [], loaded: true,
      });
    });
    return () => { cancelled = true; };
  }, [tick, freelancer, investor]);
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  return { ...data, refresh };
}
