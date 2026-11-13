"use client";
import * as React from "react";
import { API_URL, apiFetch } from "@/lib/api";
import { DEMO_MODE } from "@/lib/auth";

/** True when pages backed only by the server (team, API keys) can work:
 *  a backend is configured and this isn't the frontend-only demo. */
export const SERVER_FEATURES = !DEMO_MODE && !!API_URL;

export type ApiState<T> = {
  data: T | null;
  loading: boolean;
  /** Message to show when the last load failed. */
  error: string | null;
  reload: () => void;
};

/** The server's `detail` message, or a fallback. */
export function detailOf(data: unknown, fallback = "Something went wrong. Please try again."): string {
  const d = (data as { detail?: unknown } | null)?.detail;
  return typeof d === "string" && d ? d : fallback;
}

/** GET a server resource; keeps the previous data while reloading. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(Boolean(path && SERVER_FEATURES));
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!path || !SERVER_FEATURES) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch(path)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok) {
          setData(body as T);
          setError(null);
        } else {
          setError(detailOf(body, `Couldn't load this (${res.status}).`));
        }
      })
      .catch(() => {
        if (!cancelled) setError("Can't reach the server. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  const reload = React.useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}

/** POST/PATCH/DELETE returning {ok, status, data}; never throws. */
export async function send<T = any>(
  path: string,
  method: "POST" | "PATCH" | "DELETE" | "PUT",
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T | null }> {
  if (!SERVER_FEATURES) return { ok: false, status: 0, data: null };
  try {
    const res = await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { detail: "Can't reach the server. Check your connection and try again." } as T };
  }
}
