"use client";
/**
 * AutoGig project-credit prototype. SIMULATED: shapes mirror backend/app/routers/credit.py. Money is integer cents;
 * rates are basis points. Nothing here is a real loan, deposit, investment or insurance product.
 */
import * as React from "react";
import { API_URL, apiFetch } from "@/lib/api";

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
export type CreditDocument = { id: string; label: string; mime: string; size: number; ext: string; slot: number };
export const MAX_DOCS = 3;
export const MAX_DOC_BYTES = 2 * 1024 * 1024;
export const DOC_ACCEPT = "application/pdf,image/png,image/jpeg";
/** Private download address (cookie-authenticated GET). The server forces a download and never renders the file. */
export const documentUrl = (id: string) => `/api/credit/documents/${encodeURIComponent(id)}`;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

export type AppStatus = "submitted" | "offered" | "declined" | "accepted" | "rejected" | "withdrawn" | "expired";
export type CreditApplication = {
  id: string; title: string; description: string; requestedCents: number; preferredInstallments: number;
  documents: CreditDocument[]; status: AppStatus; offer: Offer | null; createdAt: string;
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
export type WithdrawalStatus = "requested" | "paying" | "paid" | "declined" | "cancelled";
export type Withdrawal = {
  id: string; amountCents: number; status: WithdrawalStatus; note?: string | null; reviewNote?: string | null; createdAt: string;
  paidAt?: string; decidedAt?: string; contributorId?: string;
  position?: { netCents: number; lossShareCents: number; withdrawableCents: number; poolAvailableCents: number };
};
export type Statement = {
  notice: string; contributedCents: number; poolContributionsCents: number; shareBps: number; attributedFeesCents: number;
  attributedLossesCents: number; simulatedNetCents: number; contributions: { id: string; amountCents: number; createdAt: string }[];
  withdrawnCents: number; netContributedCents: number; withdrawableCents: number; pendingWithdrawalCents: number; withdrawals: Withdrawal[];
};
export const WITHDRAWAL_LABELS: Record<WithdrawalStatus, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "default" }> = {
  requested: { label: "Waiting for review", variant: "warning" }, paying: { label: "Being paid", variant: "default" },
  paid: { label: "Paid", variant: "success" }, declined: { label: "Declined", variant: "destructive" }, cancelled: { label: "Cancelled", variant: "secondary" },
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

async function readCredit<T>(path: string): Promise<{ status: number; data: T | null }> {
  try {
    const response = await apiFetch(path);
    return { status: response.status, data: response.ok ? await response.json() as T : null };
  } catch {
    return { status: 0, data: null };
  }
}

/** Loads credit data for a page; `admin` adds the owner-only sections. */
export function useCredit(opts: { borrower?: boolean; investor?: boolean; admin?: boolean }) {
  const [tick, setTick] = React.useState(0);
  const [state, setState] = React.useState<{
    overview: CreditOverview | null; applications: CreditApplication[]; agreements: CreditAgreement[]; statement: Statement | null;
    allocations: Allocation[]; adminApps: CreditApplication[]; adminAgreements: CreditAgreement[]; treasury: Pool | null; audit: AuditRow[];
    adminWithdrawals: Withdrawal[]; loaded: boolean; denied: boolean; failed: boolean;
  }>({ overview: null, applications: [], agreements: [], statement: null, allocations: [], adminApps: [], adminAgreements: [], treasury: null, audit: [],
    adminWithdrawals: [], loaded: !API_URL, denied: false, failed: false });
  const { borrower, investor, admin } = opts;
  React.useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    void Promise.all([
      readCredit<CreditOverview>("/api/credit/overview"),
      borrower ? readCredit<CreditApplication[]>("/api/credit/applications") : Promise.resolve(null),
      borrower ? readCredit<CreditAgreement[]>("/api/credit/agreements") : Promise.resolve(null),
      investor ? readCredit<Statement>("/api/credit/statement") : Promise.resolve(null),
      investor ? readCredit<{ allocations: Allocation[] }>("/api/credit/pool/allocations") : Promise.resolve(null),
      admin ? readCredit<CreditApplication[]>("/api/credit/admin/applications") : Promise.resolve(null),
      admin ? readCredit<CreditAgreement[]>("/api/credit/admin/agreements") : Promise.resolve(null),
      admin ? readCredit<Pool>("/api/credit/admin/treasury") : Promise.resolve(null),
      admin ? readCredit<AuditRow[]>("/api/credit/admin/audit") : Promise.resolve(null),
      admin ? readCredit<Withdrawal[]>("/api/credit/admin/withdrawals") : Promise.resolve(null),
    ]).then(([overview, applications, agreements, statement, allocations, adminApps, adminAgreements, treasury, audit, adminWithdrawals]) => {
      if (cancelled) return;
      const required = [overview, applications, agreements, statement, allocations, adminApps, adminAgreements, treasury, audit, adminWithdrawals]
        .filter((result) => result !== null);
      setState({
        overview: overview.data,
        applications: applications?.data ?? [], agreements: agreements?.data ?? [], statement: statement?.data ?? null,
        allocations: allocations?.data?.allocations ?? [], adminApps: adminApps?.data ?? [], adminAgreements: adminAgreements?.data ?? [],
        treasury: treasury?.data ?? null, audit: audit?.data ?? [], adminWithdrawals: adminWithdrawals?.data ?? [],
        loaded: true, denied: required.some((result) => result.status === 403), failed: required.some((result) => result.data === null),
      });
    });
    return () => { cancelled = true; };
  }, [tick, borrower, investor, admin]);
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}
