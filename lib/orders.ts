/**
 * Unified orders — types and display helpers for /dashboard/orders.
 * Shapes mirror backend/app/routers/orders.py.
 */

export type VerificationStatus = "verified" | "pending" | "failed" | "rejected" | "unverifiable";
export type OrderStatus =
  | "offer" | "active" | "paused" | "delivered" | "completed"
  | "cancelled" | "refunded" | "disputed" | "unknown";

export type OrderMilestone = {
  externalId: string;
  title: string;
  amount: number | null;
  currency: string | null;
  status: string;
  createdAt: string | null;
};

export type Order = {
  id: string;
  platform: string;
  accountId: string | null;
  accountLabel: string;
  externalOrderId: string | null;
  kind: string;
  title: string | null;
  clientName: string | null;
  clientId: string | null;
  amount: number | null;
  currency: string | null;
  /** "fixed" or "hourly"; for hourly work `amount` is a rate. */
  pricing: "fixed" | "hourly" | null;
  status: OrderStatus;
  statusSource: string;
  url: string | null;
  milestones: OrderMilestone[];
  orderCreatedAt: string | null;
  detectedAt: string;
  /** When the order arrived as live work; opens its protection window. Null for backfilled orders and open offers. */
  arrivedAt: string | null;
  updatedAt: string;
  lastSyncedAt: string | null;
  detectedVia: string[];
  dataExpired: boolean;
  verification: {
    status: VerificationStatus;
    reason: string;
    attempts: number;
    lastAttemptAt: string | null;
    nextAttemptAt: string | null;
    verifiedAt: string | null;
    evidence: Record<string, unknown> | null;
    dismissed: boolean;
  };
};

export type OrderEvent = {
  id: string;
  type: string;
  message: string;
  status: "info" | "success" | "warning" | "error";
  orderId: string | null;
  accountId: string | null;
  platform: string | null;
  data: Record<string, unknown>;
  time: string;
};

export type OrderAccount = {
  id: string;
  platform: string;
  label: string;
  handle: string;
  externalAccountId: string | null;
  connection: "nango" | "platform_token" | "email";
  status: "active" | "needs_reauth" | "disabled";
  inboundAddress: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: "ok" | "error" | null;
  lastSyncError: string | null;
  consecutiveFailures: number;
  nextSyncAt: string | null;
  createdAt: string;
};

export type PlatformCapability = {
  platform: string;
  key: string;
  detection: ("api_poll" | "webhook" | "email")[];
  verification: "api" | "none";
  statusSync: boolean;
  apiEnabled: boolean;
  canConnectApi: boolean;
  integrationId: string | null;
  connection: "nango" | "platform_token" | "email";
  emailReady: boolean;
  limitations: string[];
  emailDomains: string[];
  emailParserValidated: boolean;
  maxCacheHours: number | null;
};

export type CapabilityReport = {
  platforms: PlatformCapability[];
  unsupported: { platform: string; reason: string }[];
  scheduler: boolean;
  inboundEmail: boolean;
};

export type OrdersResponse = {
  orders: Order[];
  summary: {
    total: number;
    byVerification: Record<VerificationStatus, number>;
    verifiedValue: Record<string, number>;
  };
};

export const VERIFICATION_META: Record<
  VerificationStatus,
  { label: string; variant: "success" | "warning" | "destructive" | "secondary"; help: string }
> = {
  verified: { label: "Verified", variant: "success", help: "Confirmed by the platform's API for this account." },
  pending: { label: "Pending", variant: "warning", help: "Detected, not yet confirmed by the platform." },
  failed: { label: "Failed", variant: "destructive", help: "The check could not complete. Retry or reconnect the account." },
  rejected: { label: "Rejected", variant: "destructive", help: "The platform contradicted it, or you dismissed it." },
  unverifiable: { label: "Unverifiable", variant: "secondary", help: "The platform offers no way to verify orders. Confirm it on the platform." },
};

export const ORDER_STATUSES: OrderStatus[] = [
  "offer", "active", "paused", "delivered", "completed", "cancelled", "refunded", "disputed", "unknown",
];

export const DETECTION_LABELS: Record<string, string> = {
  api_poll: "API sync",
  api_sync: "API sync",
  webhook: "Webhook",
  email: "Email",
};

export function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toFixed(2)}`.trim();
  }
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
