"use client";
import { apiCall } from "@/lib/api";

/**
 * Upwork, connected directly over OAuth 2.0 (backend/app/routers/upwork_connect.py).
 *
 * startUpworkConnect() sends the browser to Upwork. Upwork returns it to the
 * backend, which stores the tokens and redirects to `returnTo` with
 * ?upwork=connected&connectionId=… or ?upwork=error&reason=…;
 * takeUpworkReturn() reads (and clears) that result.
 */

export type UpworkConnection = {
  id: string;
  handle: string;
  name: string;
  status: "active" | "needs_reauth";
  connectedAt: string | null;
  lastRefreshedAt: string | null;
};

export type UpworkConnections = { canConnect: boolean; reason: string | null; connections: UpworkConnection[] };

export type UpworkReturnPath = "/dashboard/orders" | "/dashboard/accounts";

const PENDING_KEY = "autopilot-upwork-pending";

const REASONS: Record<string, string> = {
  denied: "You declined access on Upwork, so nothing was connected.",
  expired: "The sign-in took too long or was already used. Start again.",
  rejected: "Upwork didn't accept the sign-in. Start again.",
  unreachable: "Upwork couldn't be reached. Try again in a moment.",
  not_enabled: "Upwork connections aren't switched on for this app.",
  too_many: "You've reached the limit of connected Upwork accounts.",
  upwork_error: "Upwork reported an error. Try again.",
};

/** Send the browser to Upwork. `pending` is handed back after the redirect. Returns an error message, or never returns. */
export async function startUpworkConnect(returnTo: UpworkReturnPath, pending?: Record<string, string>): Promise<string> {
  const res = await apiCall<{ authorizeUrl?: string; detail?: string }>("/api/upwork/oauth/start", { returnTo });
  if (!res) return "Can't reach the server.";
  // https only, except a local mock during development.
  const url = res.data.authorizeUrl ?? "";
  if (res.status >= 400 || !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(url)) return res.data.detail ?? "Couldn't start the Upwork sign-in.";
  try {
    if (pending) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch { /* storage blocked: the connection still lands on the Accounts page */ }
  window.location.assign(url);
  return await new Promise<string>(() => {}); // the page is leaving
}

export type UpworkReturn =
  | { ok: true; connectionId: string; pending: Record<string, string> | null }
  | { ok: false; message: string };

/** The result of a just-finished Upwork sign-in, if this page load is one. Clears it from the URL. */
export function takeUpworkReturn(): UpworkReturn | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const outcome = url.searchParams.get("upwork");
  if (!outcome) return null;
  const connectionId = url.searchParams.get("connectionId") ?? "";
  const reason = url.searchParams.get("reason") ?? "";
  for (const k of ["upwork", "connectionId", "reason"]) url.searchParams.delete(k);
  window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  let pending: Record<string, string> | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
    sessionStorage.removeItem(PENDING_KEY);
  } catch { /* storage blocked or corrupt */ }
  if (outcome === "connected" && /^uwc_[a-f0-9]{32}$/.test(connectionId)) return { ok: true, connectionId, pending };
  return { ok: false, message: REASONS[reason] ?? REASONS.upwork_error };
}
