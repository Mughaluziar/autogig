"use client";
/**
 * AutoGig project-credit prototype. SIMULATED: shapes mirror backend/app/routers/credit.py. Money is integer cents;
 * rates are basis points. Nothing here is a real loan, deposit, investment or insurance product.
 */
import * as React from "react";
import { API_URL, apiGet } from "@/lib/api";

export type Pool = {
  settlement: "simulated"; notice: string; contributionsCents: number; cashCents: number; committedCents: number; availableCents: number;
  outstandingCents: number; feesCents: number; lossesCents: number;
  repaymentsCents?: number; disbursedCents?: number; ledgerCheck?: boolean; agreements?: Record<string, number>;
};
export type Limits = {
  minContributionCents: number; maxContributionCents: number; minRequestCents: number; maxRequestCents: number;
  maxInstallments: number; installmentDays: number; offerValidDays: number; defaultAfterDays: number;
};
export type CreditOverview = { settlement: "simulated"; notice: string; pool: Pool; limits: Limits; eligibility: { reasons: string[] } };

export type Offer = {
  principalCents: number; feeBps: number; feeTotalCents: number; installments: number; totalRepayableCents: number;
  installmentDays: number; expiresAt: string; grade: string;
  signals?: { kycStatus: string; agreementsRepaid: number; agreementsDefaulted: number; agreementsOpen: number };
};
export type AppStatus = "submitted" | "offered" | "declined" | "accepted" | "rejected" | "withdrawn" | "expired";
export type CreditApplication = {
  id: string; title: string; description: string; requestedCents: number; preferredInstallments: number;
  documents: { label: string; url: string }[]; status: AppStatus; offer: Offer | null; createdAt: string;
  decision: { note?: string; at?: string } | null; applicantId?: string; applicantEmail?: string; applicantName?: string;
  signals?: NonNullable<Offer["signals"]>;
};
export type Installment = { n: number; dueAt: string; principalCents: number; feeCents: number; principalPaidCents: number; feePaidCents: number };
export type AgreementStatus = "active" | "late" | "repaid" | "defaulted" | "cancelled";
export type CreditAgreement = {
  id: string; title: string; grade: string; principalCents: number; feeBps: number; feeTotalCents: number; status: AgreementStatus;
  schedule: Installment[]; repayments: { id: string; amountCents: number; at: string }[]; openCents: number; principalOpenCents: number;
  writtenOffCents: number; acceptedAt: string; applicantId?: string;
};
export type Statement = {
  notice: string; contributedCents: number; poolContributionsCents: number; shareBps: number; attributedFeesCents: number;
  attributedLossesCents: number; simulatedNetCents: number; contributions: { id: string; amountCents: number; createdAt: string }[];
};
export type Allocation = { reference: string; grade: string; principalCents: number; status: AgreementStatus; fundedAt: string; repaidCents: number };
export type AuditRow = { id: string; action: string; subjectType: string; subjectId: string; actorRole: string; actorId: string; detail: Record<string, unknown>; createdAt: string };

export const APP_LABELS: Record<AppStatus, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "default" }> = {
  submitted: { label: "In review", variant: "warning" }, offered: { label: "Offer ready", variant: "default" },
  declined: { label: "Declined", variant: "destructive" }, accepted: { label: "Accepted", variant: "success" },
  rejected: { label: "Offer rejected", variant: "secondary" }, withdrawn: { label: "Withdrawn", variant: "secondary" },
  expired: { label: "Offer expired", variant: "secondary" },
};
export const AGREEMENT_LABELS: Record<AgreementStatus, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "default" }> = {
  active: { label: "Active", variant: "default" }, late: { label: "Late", variant: "warning" }, repaid: { label: "Repaid", variant: "success" },
  defaulted: { label: "Defaulted", variant: "destructive" }, cancelled: { label: "Cancelled", variant: "secondary" },
};

/** Loads credit data for a page; `admin` adds the owner-only sections. */
export function useCredit(opts: { borrower?: boolean; investor?: boolean; admin?: boolean }) {
  const [tick, setTick] = React.useState(0);
  const [state, setState] = React.useState<{
    overview: CreditOverview | null; applications: CreditApplication[]; agreements: CreditAgreement[]; statement: Statement | null;
    allocations: Allocation[]; adminApps: CreditApplication[]; adminAgreements: CreditAgreement[]; treasury: Pool | null; audit: AuditRow[]; loaded: boolean; denied: boolean;
  }>({ overview: null, applications: [], agreements: [], statement: null, allocations: [], adminApps: [], adminAgreements: [], treasury: null, audit: [], loaded: !API_URL, denied: false });
  const { borrower, investor, admin } = opts;
  React.useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    void Promise.all([
      apiGet<CreditOverview>("/api/credit/overview"),
      borrower ? apiGet<CreditApplication[]>("/api/credit/applications") : Promise.resolve(null),
      borrower ? apiGet<CreditAgreement[]>("/api/credit/agreements") : Promise.resolve(null),
      investor ? apiGet<Statement>("/api/credit/statement") : Promise.resolve(null),
      investor ? apiGet<{ allocations: Allocation[] }>("/api/credit/pool/allocations") : Promise.resolve(null),
      admin ? apiGet<CreditApplication[]>("/api/credit/admin/applications") : Promise.resolve(null),
      admin ? apiGet<CreditAgreement[]>("/api/credit/admin/agreements") : Promise.resolve(null),
      admin ? apiGet<Pool>("/api/credit/admin/treasury") : Promise.resolve(null),
      admin ? apiGet<AuditRow[]>("/api/credit/admin/audit") : Promise.resolve(null),
    ]).then(([overview, applications, agreements, statement, allocations, adminApps, adminAgreements, treasury, audit]) => {
      if (cancelled) return;
      setState({ overview, applications: applications ?? [], agreements: agreements ?? [], statement, allocations: allocations?.allocations ?? [],
        adminApps: adminApps ?? [], adminAgreements: adminAgreements ?? [], treasury, audit: audit ?? [], loaded: true, denied: overview == null });
    });
    return () => { cancelled = true; };
  }, [tick, borrower, investor, admin]);
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}
