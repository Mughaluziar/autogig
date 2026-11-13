/**
 * `?next=` handling for the sign-in and signup pages: where to send someone
 * after they sign in, sign up or confirm their email (e.g.
 * /signup?next=/checkout?plan=pro).
 *
 * Only same-origin relative paths are accepted: a single leading "/", no "//"
 * or "/\" (protocol-relative), no backslashes, schemes, whitespace or control
 * characters. Anything else is dropped, so it can't become an open redirect.
 */
export const NEXT_KEY = "autopilot-next";

const ALLOWED = /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#[\]]*$/;

export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > 300) return "";
  let value = raw.trim();
  // Decode once so an encoded "//" or "\" can't slip through.
  try {
    value = decodeURIComponent(value);
  } catch {
    return "";
  }
  if (!ALLOWED.test(value) || value.includes("\\") || /^\/[^/?#]*:/.test(value)) return "";
  return value;
}

/** The `next` of the current page's URL (browser only). */
export function nextFromLocation(): string {
  if (typeof window === "undefined") return "";
  return safeNext(new URLSearchParams(window.location.search).get("next"));
}

/** `path` with `?next=` (or `&next=`) appended when there is one. */
export function withNext(path: string, next: string): string {
  const safe = safeNext(next);
  if (!safe) return path;
  return `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(safe)}`;
}

/** Remember `next` across a page that may reload (e.g. /verify-email). */
export function rememberNext(next: string) {
  try {
    if (safeNext(next)) sessionStorage.setItem(NEXT_KEY, safeNext(next));
    else sessionStorage.removeItem(NEXT_KEY);
  } catch { /* storage blocked */ }
}

export function recalledNext(): string {
  try {
    return safeNext(sessionStorage.getItem(NEXT_KEY));
  } catch {
    return "";
  }
}

export function forgetNext() {
  try {
    sessionStorage.removeItem(NEXT_KEY);
  } catch { /* storage blocked */ }
}
