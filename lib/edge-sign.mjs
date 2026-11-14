// Edge proof signing (see backend/app/edge.py). Pure functions on Web Crypto so the same code runs in the Next.js
// middleware (edge runtime) and in the Node tests. The secret never leaves the server side.

const enc = new TextEncoder();

/** hex HMAC-SHA256(secret, "ts\nMETHOD\npath\nip"); `path` is the percent-decoded URL path. */
export async function signEdge(secret, ts, method, path, ip) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}\n${method.toUpperCase()}\n${path}\n${ip}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const EDGE_HEADERS = ["x-edge-ts", "x-edge-ip", "x-edge-sig"];

/** The address Vercel's own edge saw. Vercel overwrites these headers (a visitor cannot choose them); confirm on staging. */
export function clientIpFrom(headers) {
  const first = (v) => (v || "").split(",")[0].trim();
  return first(headers.get("x-vercel-forwarded-for")) || first(headers.get("x-real-ip")) || first(headers.get("x-forwarded-for"));
}

export function decodePath(pathname) {
  try { return decodeURIComponent(pathname); } catch { return pathname; }
}
