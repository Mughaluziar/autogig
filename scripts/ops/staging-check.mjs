#!/usr/bin/env node
// Staging / production smoke check for a deployed frontend + API. Read-only except where stated.
//
//   node scripts/ops/staging-check.mjs --web https://staging.example.com [--api https://api.example.com] \
//        [--rate-limit-test] [--origin https://staging.example.com]
//   STAGING_EMAIL / STAGING_PASSWORD (env, never argv) enable the sign-in cookie checks with a TEST account.
//
// What it checks: security headers, the /api proxy, health, CORS and Origin rejection, anonymous 401s,
// session cookie flags (HttpOnly, Secure, SameSite), no token in the sign-in body, CSRF enforcement, logout
// revocation, and (opt-in) that a forged X-Forwarded-For cannot dodge the per-IP credential limit.
// --rate-limit-test sends ~25 failed sign-ins for a made-up address, so it briefly rate-limits YOUR address.
// It prints no secrets and never uses real customer data. Exit code 1 if any check fails.
const args = process.argv.slice(2);
const opt = (name, def = "") => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def; };
const flag = (name) => args.includes(name);
const WEB = opt("--web").replace(/\/+$/, "");
const API = (opt("--api") || "").replace(/\/+$/, "");
const ORIGIN = (opt("--origin") || WEB).replace(/\/+$/, "");
if (!WEB) { console.error("usage: staging-check.mjs --web <frontend url> [--api <backend url>] [--origin <frontend origin>] [--rate-limit-test]"); process.exit(2); }
const EMAIL = process.env.STAGING_EMAIL || "", PASSWORD = process.env.STAGING_PASSWORD || "";
const results = [];
const apiBase = API || WEB;     // with no --api, everything goes through the frontend's /api proxy
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + String(detail).slice(0, 220)}`); };
const skip = (name, why) => console.log(`SKIP  ${name}  (${why})`);
const get = async (url, init = {}) => { try { return await fetch(url, { redirect: "manual", ...init }); } catch (e) { return { status: 0, headers: new Headers(), text: async () => "", json: async () => ({}), error: e.message }; } };

// ---- frontend: security headers and the proxy
const page = await get(`${WEB}/login`);
const h = (name) => page.headers.get(name) || "";
check("frontend /login answers 200", page.status === 200, page.status);
check("HSTS is set (max-age >= 1 year)", /max-age=(\d+)/.test(h("strict-transport-security")) && Number(/max-age=(\d+)/.exec(h("strict-transport-security"))[1]) >= 31536000, h("strict-transport-security"));
check("CSP present, frame-ancestors 'none', no wildcard script/connect sources", /frame-ancestors 'none'/.test(h("content-security-policy")) && !/(script|connect)-src[^;]*\*(?!\.)/.test(h("content-security-policy").replace(/https:\/\/\*\.[a-z.]+/g, "")), h("content-security-policy").slice(0, 120));
check("X-Frame-Options DENY, nosniff, Referrer-Policy set", h("x-frame-options") === "DENY" && h("x-content-type-options") === "nosniff" && !!h("referrer-policy"));
check("no X-Powered-By header", !h("x-powered-by"));
const me = await get(`${WEB}/api/auth/me`);
check("the /api proxy reaches the backend (anonymous /api/auth/me -> 401, JSON)", me.status === 401, me.status);
const state = await get(`${WEB}/api/state`);
check("anonymous protected endpoint is refused (401)", state.status === 401, state.status);
if (API) { const hl = await get(`${API}/health`); const j = await (hl.json?.() ?? {}).catch(() => ({})); check("API /health is ok and the database is connected", hl.status === 200 && j.status === "ok" && j.database === "ok", JSON.stringify(j)); check("API reports environment=production", j.environment === "production", j.environment); }
else skip("API /health", "no --api given");

// ---- CORS and Origin
const evil = "https://evil.example.org";
const pre = await get(`${apiBase}/api/auth/login`, { method: "OPTIONS", headers: { Origin: evil, "Access-Control-Request-Method": "POST" } });
check("CORS: a foreign origin is not allowed", (pre.headers.get("access-control-allow-origin") || "") !== evil && (pre.headers.get("access-control-allow-origin") || "") !== "*", pre.headers.get("access-control-allow-origin"));
const preOk = await get(`${apiBase}/api/auth/login`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" } });
check("CORS: the real frontend origin is allowed, with credentials", preOk.headers.get("access-control-allow-origin") === ORIGIN && preOk.headers.get("access-control-allow-credentials") === "true", `${preOk.headers.get("access-control-allow-origin")} / ${preOk.headers.get("access-control-allow-credentials")}`);
const foreignLogin = await get(`${apiBase}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: evil, "X-Session-Mode": "cookie" }, body: JSON.stringify({ email: "nobody@example.test", password: "x" }) });
check("a sign-in POST from a foreign Origin is refused (403)", foreignLogin.status === 403, foreignLogin.status);

// ---- sign-in cookies (test account only)
if (EMAIL && PASSWORD) {
  const login = await get(`${apiBase}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Session-Mode": "cookie" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const body = await login.json().catch(() => ({}));
  const cookies = (login.headers.getSetCookie?.() ?? []).map((c) => c);
  const session = cookies.find((c) => c.startsWith("autopilot_session=")) || "";
  const csrf = cookies.find((c) => c.startsWith("autopilot_csrf=")) || "";
  check("test account signs in (200)", login.status === 200, login.status);
  check("session cookie: HttpOnly, Secure, SameSite=Lax, Path=/", /HttpOnly/i.test(session) && /;\s*Secure/i.test(session) && /SameSite=Lax/i.test(session) && /Path=\//i.test(session), session.replace(/=[^;]+/, "=<hidden>"));
  check("CSRF cookie is readable by the page (not HttpOnly) and Secure", !!csrf && !/HttpOnly/i.test(csrf) && /;\s*Secure/i.test(csrf));
  check("the sign-in response body carries no token", !("token" in body) && !JSON.stringify(body).includes(session.split("=")[1]?.split(";")[0] || "@@none@@"));
  const jar = cookies.map((c) => c.split(";")[0]).join("; ");
  const csrfValue = decodeURIComponent((csrf.split("=")[1] || "").split(";")[0]);
  const meAuth = await get(`${apiBase}/api/auth/me`, { headers: { Cookie: jar } });
  check("the session cookie authenticates /api/auth/me", meAuth.status === 200, meAuth.status);
  const noCsrf = await get(`${apiBase}/api/auth/logout`, { method: "POST", headers: { Cookie: jar, Origin: ORIGIN, "X-Session-Mode": "cookie", "Content-Type": "application/json" }, body: "{}" });
  check("an unsafe request without the CSRF header is refused (403)", noCsrf.status === 403, noCsrf.status);
  const out = await get(`${apiBase}/api/auth/logout`, { method: "POST", headers: { Cookie: jar, Origin: ORIGIN, "X-CSRF-Token": csrfValue, "X-Session-Mode": "cookie", "Content-Type": "application/json" }, body: "{}" });
  check("logout works with the CSRF header", out.status === 200, out.status);
  const replay = await get(`${apiBase}/api/auth/me`, { headers: { Cookie: jar } });
  check("the logged-out session cookie is rejected when replayed (401)", replay.status === 401, replay.status);
} else skip("sign-in cookie checks", "set STAGING_EMAIL and STAGING_PASSWORD (a TEST account) to enable");

// ---- forged X-Forwarded-For must not dodge the per-IP credential limit (runs LAST: it uses up this client's own credential budget for a minute)
// Sends 24 failed sign-ins for made-up addresses, each with a different forged X-Forwarded-For. The per-IP
// credential limit is 20 per minute and the checks above used a few of them, so a correctly configured TRUSTED_PROXY_HOPS gives
// several 429s (at least 2 are required); none
// means the forged header was believed (hops too high for the real proxy chain), which is unsafe.
if (flag("--rate-limit-test")) {
  let limited = 0;
  const run = Math.random().toString(36).slice(2, 8);      // fresh made-up addresses every run: the per-EMAIL lockout persists in the database
  for (let i = 0; i < 24; i++) {
    const r = await get(`${apiBase}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Session-Mode": "cookie", "X-Forwarded-For": `10.${i}.${i}.${i}` }, body: JSON.stringify({ email: `nobody-${run}-${i}@example.test`, password: "x" }) });
    if (r.status === 429) limited++;
  }
  check("rotating a forged X-Forwarded-For does not avoid the credential rate limit", limited >= 2, `429 count = ${limited} of 24; fewer than 2 means TRUSTED_PROXY_HOPS is higher than the real number of proxies (forged header believed)`);
} else skip("forged X-Forwarded-For test", "opt in with --rate-limit-test (briefly rate-limits your address)");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; ${failed.length} failed` : ""}`);
process.exit(failed.length ? 1 : 0);
