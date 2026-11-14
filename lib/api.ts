/**
 * API client for the Autopilot backend (FastAPI).
 *
 * Connection model:
 *  - Set NEXT_PUBLIC_API_URL (e.g. http://localhost:8000) to connect the
 *    frontend to the running backend.
 *  - Unset, the app runs as a frontend-only demo on built-in mock data.
 *  - Set, real accounts never see mock data: a failed request leaves the
 *    page empty and the dashboard shows a "can't reach the server" banner
 *    (every request reports its outcome as an "api:status" event).
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

// Long enough for a free-plan backend to wake from sleep (about a minute on
// Render), short enough that a dead connection can't hang the UI forever.
const TIMEOUT_MS = 75_000;

/** fetch() with a hard timeout; an existing `signal` in `init` takes priority. */
export async function fetchWithTimeout(input: string, init: RequestInit = {}, ms = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: init.signal ?? ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sessions live in an HttpOnly cookie that JavaScript cannot read: nothing about
 * the session is stored in localStorage. The browser only talks to this site's
 * own origin; next.config.mjs proxies /api/* to the backend, so the cookie is
 * first-party. Unsafe requests echo the readable CSRF cookie in X-CSRF-Token.
 */
let signedIn = false;
/** AuthProvider tells us when a session exists, so a 401 can be told apart from "never signed in". */
export function markSession(active: boolean) {
  signedIn = active;
}

/**
 * True when the browser holds the readable CSRF cookie, which the server sets and clears together
 * with the HttpOnly session cookie. It is only a hint used to skip a request that cannot succeed
 * for a visitor who never signed in: it proves nothing, and the server still verifies the session
 * on every request. With no hint the visitor is treated as signed out; a stale hint just gets the
 * normal 401 and is cleared.
 */
export function hasSessionHint(): boolean {
  return readCookie("autopilot_csrf") !== "";
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}

/** URL for a backend path: relative in the browser (same origin, via the proxy), absolute on the server. */
export function apiUrl(path: string): string {
  return typeof window === "undefined" ? `${API_URL}${path}` : path;
}

/**
 * fetch() against the backend. A 401 while a session is active means it expired or
 * was revoked: AuthProvider listens for "auth:expired" and signs the user out.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const csrf = method === "GET" || method === "HEAD" ? "" : readCookie("autopilot_csrf");
  let res: Response;
  try {
    res = await fetchWithTimeout(apiUrl(path), {
      credentials: "same-origin",
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Session-Mode": "cookie",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    reportServer(false);
    throw err;
  }
  reportServer(res.status < 500);
  if (res.status === 401 && signedIn && typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth:expired"));
  }
  return res;
}

function reportServer(ok: boolean) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("api:status", { detail: { ok } }));
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Server-side entity fetch (for server components). Falls back to mock. */
export async function getEntity<T>(key: string, fallback: T): Promise<T> {
  if (!API_URL) return fallback;
  try {
    return await request<T>(`/api/${key}`, { cache: "no-store" });
  } catch {
    return fallback;
  }
}

/**
 * POST (or PATCH) that distinguishes results: null = backend unreachable/unset
 * (frontend-only demo); otherwise {status, data} — so callers can react to
 * 401/409 etc. and show the server's `detail` message.
 */
export async function apiCall<T = unknown>(
  path: string,
  body?: unknown,
  method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST"
): Promise<{ status: number; data: T } | null> {
  if (!API_URL) return null;
  try {
    const res = await apiFetch(path, { method, body: JSON.stringify(body ?? {}) });
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, data };
  } catch {
    return null;
  }
}

/** Client-side GET. Returns null when the backend is unset/unreachable. */
export async function apiGet<T = unknown>(path: string): Promise<T | null> {
  if (!API_URL) return null;
  try {
    const res = await apiFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Fire-and-forget POST for action buttons. Never throws — UI stays mock-driven. */
export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T | null> {
  if (!API_URL) return null;
  try {
    return await request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  } catch {
    return null;
  }
}

export async function apiPatch<T = unknown>(path: string, body: unknown): Promise<T | null> {
  if (!API_URL) return null;
  try {
    return await request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  } catch {
    return null;
  }
}
