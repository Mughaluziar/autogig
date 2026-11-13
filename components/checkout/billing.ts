"use client";
import * as React from "react";
import { API_URL, apiCall, apiGet } from "@/lib/api";
import { DEMO_MODE } from "@/lib/auth";

export type PlanId = "free" | "plus" | "pro";
export type PackId = "bids" | "profiles";
export type Plan = { id: PlanId; name: string; price: number; audience: string; features: string[]; highlight?: boolean; interval?: string };
export type Pack = { id: PackId; label: string; price: number; credits: number };
export type Subscription = {
  plan: PlanId | null; status: string | null; trialEnd: string | null; currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean; canManage: boolean;
};
export type BillingConfig = {
  live: boolean; cryptoLive: boolean; simulated: boolean; trialDays: number; trialAvailable: boolean;
  plan: string; plans: Plan[]; packs: Pack[]; subscription: Subscription | null;
};

/** Same catalog the server serves (backend/app/seed.py SUBSCRIPTION_PLANS);
 *  used by the frontend-only demo and while the server answers. */
export const PLANS: Plan[] = [
  { id: "free", name: "Basic", price: 0, audience: "Try the platform", features: ["10 job bids included", "2 platform profile slots", "Job Radar scans", "Community support"] },
  { id: "plus", name: "Plus", price: 9, audience: "Freelancers getting started", features: ["50 job bids / month", "5 platform profiles", "AI Gig Builder", "Agency outreach tools", "Email support"] },
  { id: "pro", name: "Pro", price: 19, audience: "Serious freelancers & agencies", features: ["Unlimited bids & profiles", "Priority job matching", "Full outreach + campaign suite", "Pay links & invoice reminders", "Priority support"], highlight: true },
];
export const PACKS: Pack[] = [
  { id: "bids", label: "10 Job Bids", price: 9.9, credits: 10 },
  { id: "profiles", label: "1 Platform Profile", price: 5.99, credits: 1 },
];
export const TRIAL_DAYS = 3;

const FALLBACK: BillingConfig = {
  live: false, cryptoLive: false, simulated: DEMO_MODE, trialDays: TRIAL_DAYS, trialAvailable: true,
  plan: "free", plans: PLANS, packs: PACKS, subscription: null,
};

/** What checkout can offer right now. `config` is null until the server answers. */
export function useBillingConfig(enabled = true) {
  const [config, setConfig] = React.useState<BillingConfig | null>(DEMO_MODE || !API_URL ? FALLBACK : null);
  const [failed, setFailed] = React.useState(false);
  const load = React.useCallback(async () => {
    if (DEMO_MODE || !API_URL || !enabled) return;
    const data = await apiGet<BillingConfig>("/api/billing/checkout-config");
    if (data) { setConfig(data); setFailed(false); } else setFailed(true);
  }, [enabled]);
  React.useEffect(() => { void load(); }, [load]);
  return { config, failed, reload: load };
}

/** Start Stripe Checkout. Resolves to an error message, or navigates away. */
export async function startCheckout(body: { plan?: PlanId; pack?: PackId; method?: "card" | "crypto" }): Promise<string | null> {
  const res = await apiCall<{ url?: string; detail?: unknown }>("/api/billing/checkout", body);
  if (!res) return "Couldn't reach the server. Check your connection and try again. Nothing was charged.";
  const url = res.data?.url;
  if (res.status === 200 && typeof url === "string" && url.startsWith("https://")) {
    window.location.assign(url);
    return null;
  }
  const detail = res.data?.detail;
  return typeof detail === "string" ? detail : "Checkout couldn't start. Nothing was charged.";
}

export async function openBillingPortal(): Promise<string | null> {
  const res = await apiCall<{ url?: string; detail?: unknown }>("/api/billing/portal", {});
  const url = res?.data?.url;
  if (res?.status === 200 && typeof url === "string" && url.startsWith("https://")) {
    window.location.assign(url);
    return null;
  }
  return typeof res?.data?.detail === "string" ? (res.data.detail as string) : "The billing page couldn't be opened.";
}

export const planName = (id: string) => PLANS.find((p) => p.id === id)?.name ?? "Basic";
export const PENDING_PLAN_KEY = "autopilot-pending-plan";
