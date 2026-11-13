"use client";
/**
 * Token program: investor-pool shares as a permissioned ERC-3643 token.
 * Shapes mirror backend/app/routers/token.py. TEST NETWORKS ONLY until the
 * launch gate passes (docs/token-program.md). The browser wallet only signs a
 * link message here; it never sends a transaction from this app.
 */
import * as React from "react";
import { API_URL, apiGet } from "@/lib/api";

export type ChainInfo = { chainId: number; name: string; mainnet: boolean; explorer: string | null };
export type Addresses = { token: string | null; identityRegistry: string | null; idFactory: string | null; safe: string | null; usdc: string | null };

export type WalletStatus = "linked" | "identity_pending" | "registration_pending" | "registered";
export type TokenWallet = { id: string; address: string; status: WalletStatus; linkedAt: string; identity: string | null; registeredAt?: string };

export type SubscriptionStatus = "awaiting_payment" | "minting" | "minted" | "unlocked" | "cancelled" | "expired";
export type Subscription = {
  id: string; status: SubscriptionStatus; wallet: string; amountCents: number; usdcUnits: number; payTo: string; usdc: string;
  chainId: number; expiresAt: string; shareUnits: number | null; payment: { tx: string; block: number } | null;
  lockupUntil: string | null; mintedAt?: string; createdAt: string;
};

export type TokenMe = {
  enabled: boolean; missingConfig: string[]; chain: ChainInfo; addresses: Addresses; settlement: string; lockupDays: number;
  reasons: string[]; pausedReason: string | null; wallet: TokenWallet | null; subscriptions: Subscription[];
  holding: { tokens: number; pendingTokens: number; valueCents: number; onchainTokens: number | null; reconciledAt: string | null };
};

export type GateItem = { key: string; label: string; description: string; done: boolean; evidence: string; recordedBy: string | null; recordedAt: string | null };
export type Proposal = {
  id: string; kind: "create_identity" | "register_identity" | "mint" | "unfreeze"; status: string; title: string; chainId: number;
  safe: string; transactions: { to: string; data: string; description: string }[]; createdAt: string;
};
export type TokenAlert = { id: string; kind: string; detail: string; createdAt: string };
export type Reconcile = {
  ok: boolean; at: string; block: number; onchainSupply: number; ledgerSupply: number; unreconciled: number; safeUsdcUnits: number;
  mismatches: { address: string; ledger: number; onchain: number }[];
};
export type TokenAdmin = {
  enabled: boolean; missingConfig: string[]; chain: ChainInfo; addresses: Addresses; lockupDays: number; confirmations: number;
  gate: { items: GateItem[]; passed: boolean; mainnetEnabled: boolean }; reconcile: Reconcile | null;
  cursor: { block: number; at: string } | null; pausedReason: string | null; proposals: Proposal[]; alerts: TokenAlert[];
  subscriptions: (Subscription & { userId?: string })[]; wallets: TokenWallet[];
};

export type Transparency = {
  enabled: boolean; chain: ChainInfo; addresses: Addresses; settlement: string;
  pool: {
    navCents: number; cashCents: number; outstandingCents: number; reserveCents: number; realisedYieldCents: number;
    writtenOffCents: number; sharePriceCents: number; totalShares: number; protectionFundCents: number;
    protectionPaidCents: number; advances: Record<string, number>; defaultRate: number;
  };
  feeSplit: { investorShareBps: number; protectionShareBps: number; platformShareBps: number };
  token: { onchainSupply: number | null; ledgerSupply: number | null; reconciled: boolean | null; reconciledAt: string | null;
    block: number | null; safeUsdcCents: number | null };
  launchGate: { passed: boolean; done: number; total: number; items: { label: string; done: boolean }[] };
};

export const TOKEN_DECIMALS = 6;
export const formatTokens = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 6 });
export const formatUsdc = (units: number) => (units / 10 ** 6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
export const shortAddress = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
export const explorerLink = (chain: ChainInfo, kind: "address" | "tx", value: string) =>
  chain.explorer ? `${chain.explorer}/${kind}/${value}` : null;

export const SUBSCRIPTION_LABELS: Record<SubscriptionStatus, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "default" }> = {
  awaiting_payment: { label: "Waiting for payment", variant: "warning" },
  minting: { label: "Paid · minting", variant: "default" },
  minted: { label: "Minted · locked", variant: "success" },
  unlocked: { label: "Unlocked", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
  expired: { label: "Expired", variant: "secondary" },
};

export const WALLET_LABELS: Record<WalletStatus, string> = {
  linked: "Linked · finish investor verification",
  identity_pending: "Waiting for the treasury to create your on-chain identity",
  registration_pending: "Waiting for the treasury to register your identity",
  registered: "Registered",
};

/** Loads /api/token/me and refreshes on demand. */
export function useTokenMe() {
  const [tick, setTick] = React.useState(0);
  const [data, setData] = React.useState<TokenMe | null>(null);
  const [loaded, setLoaded] = React.useState(!API_URL);
  React.useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    void apiGet<TokenMe>("/api/token/me").then((d) => {
      if (cancelled) return;
      setData(d);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [tick]);
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  return { data, loaded, refresh };
}

// --------------------------------------------------------------------------- //
// Browser wallet (EIP-1193), used only to read the account and sign a message.
// --------------------------------------------------------------------------- //
type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

export function browserWallet(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { ethereum?: Eip1193 }).ethereum) ?? null;
}

export async function requestAccount(): Promise<string> {
  const wallet = browserWallet();
  if (!wallet) throw new Error("No browser wallet found. Install one (for example MetaMask or Coinbase Wallet) and reload.");
  const accounts = (await wallet.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) throw new Error("The wallet didn't share an account.");
  return accounts[0];
}

/** personal_sign of a UTF-8 message (hex-encoded, as wallets expect). */
export async function signMessage(address: string, message: string): Promise<string> {
  const wallet = browserWallet();
  if (!wallet) throw new Error("No browser wallet found.");
  const hex = "0x" + Array.from(new TextEncoder().encode(message)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return (await wallet.request({ method: "personal_sign", params: [hex, address] })) as string;
}
