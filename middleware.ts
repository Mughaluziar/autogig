import { NextRequest, NextResponse } from "next/server";
import { EDGE_HEADERS, clientIpFrom, decodePath, signEdge } from "@/lib/edge-sign.mjs";

// Signs every /api request on its way to the backend, so the API can tell it came through this site (and which visitor
// address Vercel saw) rather than straight to the public API address. EDGE_SHARED_SECRET is a server-only variable: it
// is read here, never put in a response, cookie or the browser bundle. With no secret (local dev, frontend-only demo) the
// request passes through to the plain rewrite in next.config.mjs. See backend/app/edge.py and docs/staging-verification.md.
export const config = { matcher: "/api/:path*" };

export async function middleware(req: NextRequest) {
  const secret = process.env.EDGE_SHARED_SECRET?.trim();
  const backend = (process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  if (!secret || !backend) return NextResponse.next();

  const headers = new Headers(req.headers);
  for (const name of EDGE_HEADERS) headers.delete(name); // never forward values a visitor sent
  const ip = clientIpFrom(req.headers);
  if (ip) {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID().replace(/-/g, ""); // single use: the API refuses a replay of the same signed request
    headers.set("x-edge-ts", ts);
    headers.set("x-edge-ip", ip);
    headers.set("x-edge-nonce", nonce);
    headers.set("x-edge-sig", await signEdge(secret, ts, req.method, decodePath(req.nextUrl.pathname), ip, nonce));
  }
  return NextResponse.rewrite(new URL(req.nextUrl.pathname + req.nextUrl.search, backend), { request: { headers } });
}
