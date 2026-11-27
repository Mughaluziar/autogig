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

/** Kinds a user starts. "internal_receive" is the recipient's copy of another member's internal_send. */
export type TransferKind = "deposit" | "withdraw" | "to_usdc" | "to_usd" | "crypto_send" | "crypto_receive" | "internal_send";
export type TransferRecordKind = TransferKind | "internal_receive";
export type Transfer = {
  id: string; kind: TransferRecordKind; amountCents: number; status: "completed" | "failed"; bankAccountId: string | null;
  bankLabel: string | null; address: string | null; network: string | null; reason?: string; createdAt: string;
  completedAt?: string; walletLabel?: string | null; counterpartyLabel?: string | null; note?: string | null;
};

/** One of the user's own wallets on Base, linked for USDC sends and receipts (public address only). */
export type CryptoAddress = {
  id: string; label: string; address: string; network: string; source: "manual" | "browser_wallet"; createdAt: string;
};

export type DebitCard = {
  id: string; last4: string; expMonth: number; expYear: number; expires: string; nameOnCard: string;
  status: "active" | "frozen" | "cancelled"; funding: "usd"; perTransactionLimitCents: number; dailyLimitCents: number;
  onlineEnabled: boolean; atmEnabled: boolean; spentTodayCents: number; createdAt: string;
};
export type CardChannel = "online" | "in_person" | "atm";
export type CardTransaction = {
  id: string; cardId: string; last4: string; merchant: string; category: string; channel: CardChannel; amountCents: number;
  status: "approved" | "declined" | "refunded"; declineReason?: string; declineText?: string; createdAt: string;
};
export type CardOverview = {
  settlement: string; card: DebitCard | null; transactions: CardTransaction[]; balances: Balances;
  limits: { minLimitCents: number; maxPerTransactionCents: number; maxDailyCents: number };
  categories: string[]; channels: CardChannel[];
};

export type TxnCategory = "bank" | "crypto" | "member" | "card" | "investing" | "other";
export type TxnRow = {
  seq: number; at: string; kind: string; category: TxnCategory; memo: string; usdCents: number; usdcCents: number;
  balanceUsdCents: number; balanceUsdcCents: number;
};
export type TxnPage = {
  settlement: string; rows: TxnRow[]; categories: TxnCategory[]; nextBefore: number | null; inCents: number; outCents: number;
  count: number;
};
export type TxnFilters = { currency?: "" | "usd" | "usdc"; direction?: "" | "in" | "out"; category?: "" | TxnCategory; from?: string; to?: string; q?: string };

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
  cryptoAddresses: CryptoAddress[]; card: DebitCard | null;
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

export const TRANSFER_LABEL: Record<TransferRecordKind, string> = {
  deposit: "Add money from bank",
  withdraw: "Withdraw to bank",
  to_usdc: "Convert USD → USDC",
  to_usd: "Convert USDC → USD",
  crypto_send: "Send USDC to a wallet",
  crypto_receive: "Receive USDC from your wallet",
  internal_send: "Pay an Autopilot member",
  internal_receive: "Received from a member",
};

/** Money comes in (green), goes out, or moves between your own balances. */
export const TRANSFER_DIRECTION: Record<TransferRecordKind, "in" | "out" | "move"> = {
  deposit: "in", crypto_receive: "in", internal_receive: "in",
  withdraw: "out", crypto_send: "out", internal_send: "out",
  to_usdc: "move", to_usd: "move",
};
/** Amounts in USDC rather than USD. */
export const USDC_KINDS: TransferRecordKind[] = ["to_usd", "crypto_send", "crypto_receive"];

export const CATEGORY_LABEL: Record<TxnCategory, string> = {
  bank: "Bank", crypto: "Crypto", member: "Members", card: "Card", investing: "Investing", other: "Other",
};

export const CHANNEL_LABEL: Record<CardChannel, string> = { online: "Online", in_person: "In person", atm: "ATM" };
export const CARD_CATEGORY_LABEL: Record<string, string> = {
  software: "Software", advertising: "Advertising", office: "Office", travel: "Travel", meals: "Meals", cash: "Cash", other: "Other",
};

export const isWalletAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value.trim());
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function txnQuery(f: TxnFilters, extra: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== undefined && v !== "") params.set(k, String(v));
  const q = params.toString();
  return q ? `?${q}` : "";
}

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
export const useCryptoAddresses = () => useApi<CryptoAddress[]>("/api/banking/crypto/addresses");
export const useCards = () => useApi<CardOverview>("/api/banking/cards");
export const useStatement = (month: string) => useApi<Statement>(`/api/banking/statements?month=${month}`);
export const useFinancingEstimate = () => useApi<FinancingEstimate>("/api/banking/financing/estimate");
export const useApplications = () => useApi<FinancingApplication[]>("/api/banking/financing");
