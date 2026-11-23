"use client";
import * as React from "react";
import { API_URL, apiCall, apiFetch } from "@/lib/api";

/** What the pool endpoints return (backend/app/routers/pool.py). Money is in dollars. */
export type PoolBid = { id: string; specId: string; spec: string; hours: number; rate: number; total: number; note: string; status: string; submitted?: string; freelancerId?: string; freelancerName?: string };
export type PoolSpec = { id: string; title: string; summary: string; stack: string[]; estHours: number; deadline: string; maxRate: number | null; status: string; bidsIn: number; myBid?: PoolBid; bids?: PoolBid[] };
export type PoolMilestone = { id: string; title: string; amount: number; status: string; deliveryNote: string; rejectionNote: string };
export type PoolContract = { id: string; specId: string; title: string; hours: number; rate: number; value: number; status: string; milestonesDone: number; milestonesTotal: number; freelancerId?: string; freelancerName: string; milestones: PoolMilestone[] };
export type PoolEarning = { id: string; contract: string; milestone: string; amount: number; status: string; approvedAt?: string; paidAt?: string; freelancerName?: string };

export type BidCredits = {
  enabled: boolean; plan: string; unlimited: boolean; left: number; rules: string;
  used: { specId: string; spec: string; credit: "spent" | "plan" | "refunded"; status: string; at?: string }[];
};

export type PoolState<T> = { data: T | null; loading: boolean; error: string; reload: () => void };

/**
 * GET a pool endpoint. With a backend, `data` is real data or `null` plus an error: never mock
 * rows. Without a backend (the frontend-only demo) it returns `demo`.
 */
export function usePool<T>(path: string, demo: T | null = null): PoolState<T> {
  const [data, setData] = React.useState<T | null>(API_URL ? null : demo);
  const [loading, setLoading] = React.useState(Boolean(API_URL));
  const [error, setError] = React.useState("");
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!API_URL) return;
    let alive = true;
    setLoading(true);
    apiFetch(path)
      .then(async (res) => {
        if (!alive) return;
        if (res.ok) { setData((await res.json()) as T); setError(""); }
        else setError(res.status === 403 ? "Your account type can't open this page." : "Couldn't load this. Try again.");
      })
      .catch(() => alive && setError("Can't reach the server. Try again in a moment."))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [path, tick]);
  return { data, loading, error, reload: React.useCallback(() => setTick((t) => t + 1), []) };
}

/** POST/DELETE an action; resolves to an error message, or "" on success. */
export async function poolAction(path: string, body?: unknown, method: "POST" | "DELETE" = "POST"): Promise<{ error: string; data: any }> {
  const res = await apiCall<any>(path, body, method);
  if (!res) return { error: "Can't reach the server. Nothing was changed.", data: null };
  if (res.status >= 400) {
    const detail = res.data?.detail;
    return { error: typeof detail === "string" ? detail : Array.isArray(detail) ? "Check the highlighted fields." : "Something went wrong.", data: null };
  }
  return { error: "", data: res.data };
}
