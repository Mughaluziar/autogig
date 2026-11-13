"use client";
/**
 * Banking: Autopilot balances, linked bank accounts, transfers, statements and
 * business-financing applications. Shapes mirror backend/app/routers/banking.py.
 * SIMULATED SETTLEMENT: no bank or chain is contacted.
 */
import { useApi, type Balances } from "@/lib/marketplace";
import type { TrackRecord } from "@/lib/marketplace";

export type BankAccount = {
  id: string; holder: string; nickname: string; last4: string; routingLast4: string; kind: "checking" | "savings";
  status: "pending" | "verified"; attempts: number; createdAt: string; verifiedAt?: string; simulatedDeposits?: number[];
};

export type TransferKind = "deposit" | "withdraw" | "to_usdc" | "to_usd" | "crypto_send";
export type Transfer = {
  id: string; kind: TransferKind; amountCents: number; status: "completed" | "failed"; bankAccountId: string | null;
  bankLabel: string | null; address: string | null; network: string | null; reason?: string; createdAt: string;
  completedAt?: string;
};

export type FinancingProduct = "line_of_credit" | "term_loan" | "revenue_based";
export type FinancingApplication = {
  id: string; amountCents: number; product: FinancingProduct; purpose: string; businessType: "freelancer" | "agency";
  yearsInBusiness: string; teamSize: number; monthlyRevenueCents: number; verifiedTrailingYearCents: number;
  estimate: { lowCents: number; highCents: number } | null; grade: string;
  status: "submitted" | "in_review" | "referred" | "declined" | "withdrawn"; reviewNote?: string;
  history: { status: string; at: string; note?: string }[]; createdAt: string;
};

export type BankingOverview = {
  settlement: string; balances: Balances; pool: { valueCents: number; shares: number };
  marketplace: { investedCents: number; distributedCents: number; outstandingCents: number; escrowCents: number; positions: number; defaultedCents: number };
  accounts: BankAccount[]; transfers: Transfer[]; applications: FinancingApplication[]; kycStatus: string;
  limits: { minTransferCents: number; maxTransferCents: number; dailyDepositCents: number; network: string };
};

export type Statement = {
  month: string; settlement: string; openingCents: { usd: number; usdc: number }; closingCents: { usd: number; usdc: number };
  inCents: number; outCents: number;
  rows: { seq: number; at: string; kind: string; memo: string; usdCents: number; usdcCents: number }[];
};

export type FinancingEstimate = {
  trackRecord: TrackRecord; verifiedTrailingYearCents: number; estimate: { lowCents: number; highCents: number } | null;
  reasons: string[]; minCents: number; maxCents: number; products: FinancingProduct[];
};

export const TRANSFER_LABEL: Record<TransferKind, string> = {
  deposit: "Add money from bank",
  withdraw: "Withdraw to bank",
  to_usdc: "Convert USD → USDC",
  to_usd: "Convert USDC → USD",
  crypto_send: "Send USDC to a wallet",
};

export const PRODUCT_LABEL: Record<FinancingProduct, { label: string; hint: string }> = {
  line_of_credit: { label: "Line of credit", hint: "Draw what you need, pay interest only on what you use." },
  term_loan: { label: "Term loan", hint: "One lump sum, fixed monthly payments." },
  revenue_based: { label: "Revenue-based", hint: "Repay as a share of revenue; slower months cost less." },
};

export const APPLICATION_STATUS: Record<FinancingApplication["status"], { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "default" }> = {
  submitted: { label: "Submitted", variant: "default" },
  in_review: { label: "In review", variant: "warning" },
  referred: { label: "Referred to partner", variant: "success" },
  declined: { label: "Not approved", variant: "destructive" },
  withdrawn: { label: "Withdrawn", variant: "secondary" },
};

/** ABA routing-number checksum (same rule as the server). */
export function validRouting(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split("").map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

export const thisMonth = () => new Date().toISOString().slice(0, 7);

export function statementCsv(s: Statement): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [["Date", "Description", "USD", "USDC"].join(",")];
  for (const r of s.rows) lines.push([r.at, esc(r.memo), (r.usdCents / 100).toFixed(2), (r.usdcCents / 100).toFixed(2)].join(","));
  lines.push(["", "Closing balance", (s.closingCents.usd / 100).toFixed(2), (s.closingCents.usdc / 100).toFixed(2)].join(","));
  return lines.join("\n");
}

export const useBankingOverview = () => useApi<BankingOverview>("/api/banking/overview");
export const useStatement = (month: string) => useApi<Statement>(`/api/banking/statements?month=${month}`);
export const useFinancingEstimate = () => useApi<FinancingEstimate>("/api/banking/financing/estimate");
export const useApplications = () => useApi<FinancingApplication[]>("/api/banking/financing");
