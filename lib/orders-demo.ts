/**
 * Sample data for the frontend-only demo (no NEXT_PUBLIC_API_URL). Real
 * accounts never see it: with a backend, /dashboard/orders reads only the API.
 */
import type { CapabilityReport, Order, OrderAccount, OrderEvent, OrdersResponse, VerificationStatus } from "@/lib/orders";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export const DEMO_ACCOUNTS: OrderAccount[] = [
  { id: "acc-uw-1", platform: "Upwork", label: "Upwork · studio", handle: "studio", externalAccountId: "uw-1", connection: "email", status: "active", inboundAddress: null, lastSyncAt: hoursAgo(0.2), lastSyncStatus: "ok", lastSyncError: null, consecutiveFailures: 0, nextSyncAt: hoursAgo(-0.1), createdAt: hoursAgo(400) },
  { id: "acc-uw-2", platform: "Upwork", label: "Upwork · personal", handle: "dev", externalAccountId: "uw-2", connection: "email", status: "active", inboundAddress: null, lastSyncAt: hoursAgo(3), lastSyncStatus: "error", lastSyncError: "Upwork API returned 503", consecutiveFailures: 2, nextSyncAt: hoursAgo(-0.5), createdAt: hoursAgo(200) },
  { id: "acc-fv-1", platform: "Fiverr", label: "Fiverr · design gigs", handle: "", externalAccountId: null, connection: "email", status: "active", inboundAddress: "o-sample@in.example.com", lastSyncAt: null, lastSyncStatus: null, lastSyncError: null, consecutiveFailures: 0, nextSyncAt: null, createdAt: hoursAgo(300) },
];

const base = (o: Partial<Order> & Pick<Order, "id" | "platform" | "accountId" | "accountLabel">): Order => ({
  externalOrderId: null, kind: "order", title: null, clientName: null, clientId: null, amount: null, currency: "USD", pricing: "fixed",
  status: "active", statusSource: "api_sync", url: null, milestones: [], orderCreatedAt: hoursAgo(24), detectedAt: hoursAgo(24), arrivedAt: null,
  updatedAt: hoursAgo(1), lastSyncedAt: null, detectedVia: ["api_sync"], dataExpired: false,
  verification: { status: "pending", reason: "", attempts: 0, lastAttemptAt: null, nextAttemptAt: null, verifiedAt: null, evidence: null, dismissed: false },
  ...o,
});

export const DEMO_ORDERS: Order[] = [
  base({ id: "ord-1", platform: "Upwork", accountId: "acc-uw-1", accountLabel: "Upwork · studio", externalOrderId: "38104455", kind: "contract", title: "React dashboard for logistics SaaS", clientName: "Northwind Ops", amount: 4200, status: "active", orderCreatedAt: hoursAgo(30), lastSyncedAt: hoursAgo(0.2), detectedVia: ["email", "api_sync"],
    milestones: [{ externalId: "m1", title: "Design system", amount: 1200, currency: "USD", status: "approved", createdAt: hoursAgo(30) }, { externalId: "m2", title: "Dashboard build", amount: 3000, currency: "USD", status: "active", createdAt: hoursAgo(30) }],
    verification: { status: "verified", reason: "Confirmed by the Upwork API for this account.", attempts: 1, lastAttemptAt: hoursAgo(29), nextAttemptAt: null, verifiedAt: hoursAgo(29), evidence: { method: "platform_api" }, dismissed: false } }),
  base({ id: "ord-2", platform: "Upwork", accountId: "acc-uw-2", accountLabel: "Upwork · personal", externalOrderId: "38109912", kind: "contract", title: "FastAPI integration work (hourly)", clientName: "Lumen Health", amount: 65, status: "offer", orderCreatedAt: hoursAgo(5), detectedVia: ["email"], statusSource: "email",
    verification: { status: "pending", reason: "Upwork check failed; retrying automatically.", attempts: 2, lastAttemptAt: hoursAgo(1), nextAttemptAt: hoursAgo(-0.2), verifiedAt: null, evidence: null, dismissed: false } }),
  base({ id: "ord-3", platform: "Fiverr", accountId: "acc-fv-1", accountLabel: "Fiverr · design gigs", externalOrderId: "FO8C21D4A9E1", title: "You've received an order from mira_k", clientName: "mira_k", amount: 180, status: "active", detectedVia: ["email"], statusSource: "email", orderCreatedAt: hoursAgo(12),
    verification: { status: "unverifiable", reason: "Fiverr offers no permitted way to verify orders. Confirm it on Fiverr.", attempts: 0, lastAttemptAt: null, nextAttemptAt: null, verifiedAt: null, evidence: null, dismissed: false } }),
  base({ id: "ord-4", platform: "Upwork", accountId: "acc-uw-1", accountLabel: "Upwork · studio", externalOrderId: "38000001", kind: "contract", title: "Your contract has started: Data migration", amount: 900, status: "active", detectedVia: ["email"], statusSource: "email", orderCreatedAt: hoursAgo(50),
    verification: { status: "rejected", reason: "Upwork has no order 38000001 on this account.", attempts: 1, lastAttemptAt: hoursAgo(49), nextAttemptAt: null, verifiedAt: null, evidence: null, dismissed: false } }),
  base({ id: "ord-5", platform: "Upwork", accountId: "acc-uw-1", accountLabel: "Upwork · studio", externalOrderId: "37990120", kind: "contract", title: "Landing page refresh", clientName: "Kite & Co", amount: 1500, status: "completed", orderCreatedAt: hoursAgo(300), lastSyncedAt: hoursAgo(0.2),
    verification: { status: "verified", reason: "Confirmed by the Upwork API for this account.", attempts: 1, lastAttemptAt: hoursAgo(299), nextAttemptAt: null, verifiedAt: hoursAgo(299), evidence: { method: "platform_api" }, dismissed: false } }),
];

export const DEMO_EVENTS: OrderEvent[] = [
  { id: "e1", type: "sync_failed", message: "Upwork API returned 503", status: "error", orderId: null, accountId: "acc-uw-2", platform: "Upwork", data: {}, time: hoursAgo(3) },
  { id: "e2", type: "verification_rejected", message: "Upwork has no such order for this account", status: "error", orderId: "ord-4", accountId: "acc-uw-1", platform: "Upwork", data: {}, time: hoursAgo(49) },
  { id: "e3", type: "verified", message: "Confirmed by the Upwork API for this account.", status: "success", orderId: "ord-1", accountId: "acc-uw-1", platform: "Upwork", data: {}, time: hoursAgo(29) },
  { id: "e4", type: "order_detected", message: "Detected via email", status: "info", orderId: "ord-3", accountId: "acc-fv-1", platform: "Fiverr", data: {}, time: hoursAgo(12) },
];

export const DEMO_CAPABILITIES: CapabilityReport = {
  platforms: [
    { platform: "Upwork", key: "upwork", detection: ["email"], verification: "none", statusSync: false, apiEnabled: false, canConnectApi: false, integrationId: null, connection: "email", emailReady: false, limitations: ["Sample data — connect the backend to see this environment's real limits."], emailDomains: ["upwork.com"], emailParserValidated: false, maxCacheHours: null },
    { platform: "Freelancer.com", key: "freelancer", detection: ["api_poll", "email"], verification: "api", statusSync: true, apiEnabled: false, canConnectApi: false, integrationId: null, connection: "platform_token", emailReady: false, limitations: [], emailDomains: ["freelancer.com"], emailParserValidated: false, maxCacheHours: null },
    { platform: "Fiverr", key: "fiverr", detection: ["email"], verification: "none", statusSync: false, apiEnabled: false, canConnectApi: false, integrationId: null, connection: "email", emailReady: false, limitations: ["Fiverr has no seller order API; orders can only be detected from forwarded emails and can't be verified."], emailDomains: ["fiverr.com"], emailParserValidated: false, maxCacheHours: null },
  ],
  unsupported: [],
  scheduler: false,
  inboundEmail: false,
};

export type OrderFilters = {
  q: string; platform: string; account: string; status: string; verification: string; from: string; to: string;
};

export function filterDemoOrders(f: OrderFilters): OrdersResponse {
  const q = f.q.trim().toLowerCase();
  const orders = DEMO_ORDERS.filter((o) => {
    const day = (o.orderCreatedAt ?? o.detectedAt).slice(0, 10);
    return (!f.platform || o.platform === f.platform)
      && (!f.account || o.accountId === f.account)
      && (!f.status || o.status === f.status)
      && (!f.verification || o.verification.status === f.verification)
      && (!f.from || day >= f.from)
      && (!f.to || day <= f.to)
      && (!q || [o.externalOrderId, o.title, o.clientName].some((v) => (v ?? "").toLowerCase().includes(q)));
  });
  const byVerification = { verified: 0, pending: 0, failed: 0, rejected: 0, unverifiable: 0 } as Record<VerificationStatus, number>;
  const verifiedValue: Record<string, number> = {};
  for (const o of orders) {
    byVerification[o.verification.status] += 1;
    if (o.verification.status === "verified" && o.amount != null) {
      verifiedValue[o.currency ?? "USD"] = (verifiedValue[o.currency ?? "USD"] ?? 0) + o.amount;
    }
  }
  return { orders, summary: { total: orders.length, byVerification, verifiedValue } };
}
