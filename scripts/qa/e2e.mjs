// Browser end-to-end QA: auth/session security, Upwork assistant, freelancer pool, roles, responsive.
// Needs: a running API with a real MongoDB, the production frontend proxying /api to it, and
//   npm i --no-save playwright  (+ a Chromium: set CHROME=/path/to/chrome if it isn't Playwright's own).
// Synthetic accounts and emails only. Usage:
//   BASE=http://localhost:3100 API=http://localhost:8010 HOOK=<inbound secret> OUT=qa.json node scripts/qa/e2e.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3100";
const API = process.env.API || "http://localhost:8010";
const HOOK = process.env.HOOK || "qa-hook-secret";
const OUT = process.env.OUT || "qa-results.json";
const SHOTS = process.env.SHOTS || ".";
const RUN = Date.now().toString(36);
const PW = "Qa-Synthetic-Pass-9182";
const results = [];
const log = [];
const check = (group, name, ok, detail = "") => {
  results.push({ group, name, ok: !!ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  [${group}] ${name}${ok ? "" : "  -> " + String(detail).slice(0, 200)}`);
};
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--disable-dev-shm-usage"] });

// ---------------------------------------------------------------- helpers
async function newCtx(viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"], baseURL: BASE });
  ctx.errors = []; ctx.bad = [];
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") ctx.errors.push(`${new URL(page.url() || BASE).pathname}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => ctx.errors.push(`pageerror ${e.message.slice(0, 160)}`));
  page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) ctx.bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  return page;
}
const unique = (p) => `${p}-${RUN}@example.test`;
async function pickCountry(page) {
  const sel = page.locator("select#country");
  if (await sel.count()) await sel.selectOption({ label: "United States" }).catch(() => {});
}
async function signupUI(ctx, role, u) {
  const page = await newPage(ctx);
  await page.goto(`/signup/${role}`);
  await page.fill("#first", u.first); await page.fill("#last", u.last); await page.fill("#email", u.email);
  await pickCountry(page);
  if (role === "freelancer") {
    await page.getByRole("spinbutton", { name: /Hourly rate/ }).fill("55");
    await page.getByRole("textbox", { name: "Primary skills" }).fill("React, Python, FastAPI");
    await page.getByRole("combobox", { name: "Years of experience" }).selectOption("3–5");
    await page.getByRole("combobox", { name: "Availability" }).selectOption("Full-time");
    await page.getByRole("textbox", { name: "Password" }).fill(PW);
  } else if (role === "admin") {
    await page.fill("#agency", u.company || "QA Agency");
    await page.fill("#password", PW); await page.fill("#confirm", PW);
  } else {
    await page.fill("#password", PW);
  }
  const box = page.getByRole("checkbox");
  if (await box.count()) await box.first().check();
  await page.getByRole("button", { name: /Create account/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 20000 });
  return page;
}
async function loginUI(ctx, roleLabel, email, password = PW) {
  const page = await newPage(ctx);
  await page.goto("/login");
  await page.getByRole("button", { name: roleLabel }).first().click();
  await page.fill("#email", email); await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
  return page;
}
async function logoutUI(page, name) {
  await page.getByText(name, { exact: false }).first().click();
  await page.getByText("Log out").click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
}
const api = async (ctx, method, path, data, extra = {}) => {
  const res = await ctx.request.fetch(`${BASE}${path}`, { method, data, headers: { "X-Session-Mode": "cookie", Origin: BASE, ...(extra.csrf === false ? {} : { "X-CSRF-Token": (await ctx.cookies()).find((c) => c.name === "autopilot_csrf")?.value ?? "" }), ...(extra.headers ?? {}) } });
  let body = null; try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status(), body };
};
const rawApi = async (method, path, data, headers = {}) => {
  // Public inbound webhooks come directly from the provider. Browser endpoints use the signed frontend proxy.
  const origin = path === "/api/inbox/inbound" ? API : BASE;
  const res = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: data ? JSON.stringify(data) : undefined });
  let body = null; try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
};
if (process.env.EXPECT_EDGE_PROOF === "true") {
  const direct = await fetch(`${API}/api/legal/versions`);
  const proxy = await fetch(`${BASE}/api/legal/versions`);
  check("auth", "unsigned API access is refused while the signed frontend proxy works",
    direct.status === 403 && proxy.status === 200, `${direct.status}/${proxy.status}`);
}
const text = async (page) => (await page.innerText("body")).replace(/\s+/g, " ");
const guard = async (group, name, fn) => { try { await fn(); } catch (e) { check(group, name, false, `exception: ${e.message.split("\n")[0]}`); } };

const DIGEST = `<html><body><p>Jobs matching your saved search</p><table>
<tr><td><a href="https://www.upwork.com/jobs/React-dashboard-developer_~01a1b2c3d4e5f6a7b8?source=alert">React dashboard developer</a></td></tr>
<tr><td>Hourly: $40.00 - $70.00</td></tr><tr><td>Posted: 12 minutes ago</td></tr>
<tr><td>We need an experienced React engineer to build an analytics dashboard with charts and auth. More</td></tr>
<tr><td>Skills: React, TypeScript, Chart.js</td></tr>
<tr><td><a href="https://www.upwork.com/jobs/~01a1b2c3d4e5f6a7b8">View job</a></td></tr>
<tr><td><a href="https://www.upwork.com/nx/find-work/best-matches/details/~02ffeeddccbbaa9988">Python data pipeline &amp; API</a></td></tr>
<tr><td>Fixed-price: $1,500</td></tr><tr><td>Build a small ETL pipeline and a FastAPI service.</td></tr>
<tr><td>Skills: Python, FastAPI, PostgreSQL</td></tr>
<tr><td><a href="https://www.upwork.com/jobs/~02ffeeddccbbaa9988">View job</a></td></tr></table>
<p>Upwork, Inc. unsubscribe</p></body></html>`;

// ====================================================================== TEST 1 — AUTHENTICATION
const ann = { first: "Ann", last: `Dev${RUN}`, email: unique("ann") };
const annName = `${ann.first} ${ann.last}`;
let annCtx, annPage;
await guard("auth", "setup", async () => {
  annCtx = await newCtx();
  annPage = await signupUI(annCtx, "freelancer", ann);
  check("auth", "registration through the UI lands in the freelancer portal", /\/freelancer/.test(annPage.url()), annPage.url());
  await annPage.waitForTimeout(1200);
  check("auth", "portal shows the signed-in user's name", (await text(annPage)).includes(annName), (await text(annPage)).slice(0, 120));

  const stored = await annPage.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const jwtLike = JSON.stringify(stored).match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  check("auth", "no JWT/session token anywhere in localStorage or sessionStorage", !jwtLike, Object.keys(stored.local).join(","));
  check("auth", "no localStorage key named like a token", !Object.keys(stored.local).some((k) => /token|auth-token|jwt/i.test(k)), Object.keys(stored.local).join(","));

  const cookies = await annCtx.cookies();
  const session = cookies.find((c) => c.name === "autopilot_session"), csrf = cookies.find((c) => c.name === "autopilot_csrf");
  check("auth", "session cookie is HttpOnly, SameSite=Lax, Path=/", session?.httpOnly && session.sameSite === "Lax" && session.path === "/", JSON.stringify(session && { h: session.httpOnly, s: session.sameSite, p: session.path }));
  check("auth", "session cookie has an expiry (not a forever cookie)", session && session.expires > Date.now() / 1000 && session.expires < Date.now() / 1000 + 3 * 3600, session?.expires);
  check("auth", "CSRF cookie is readable by the page, session cookie is not", csrf && !csrf.httpOnly && !(await annPage.evaluate(() => document.cookie)).includes("autopilot_session"));
  check("auth", "(local http) Secure flag is off; production sets it (unit-tested)", session && session.secure === false, `secure=${session?.secure}`);

  await annPage.reload(); await annPage.waitForTimeout(1500);
  check("auth", "refresh keeps the session (still in the portal, name shown)", /\/freelancer/.test(annPage.url()) && (await text(annPage)).includes(annName), annPage.url());

  for (const path of ["/freelancer/specs", "/freelancer/bids", "/freelancer/contracts", "/freelancer/earnings", "/freelancer/profile", "/dashboard/gigs"]) {
    await annPage.goto(path); await annPage.waitForTimeout(900);
    check("auth", `protected page ${path} opens while signed in`, new URL(annPage.url()).pathname === path, annPage.url());
  }
});

await guard("auth", "email-first signup UI", async () => {
  const ctx = await newCtx();
  const page = await newPage(ctx);
  let firstRequest;
  let redeemed;
  await page.route("**/api/auth/signup", async (route) => {
    const posted = route.request().postDataJSON();
    if (posted.signupProof) {
      redeemed = posted.signupProof;
      return route.continue();
    }
    firstRequest = posted;
    return route.fulfill({ json: { verificationPending: true } });
  });
  const email = unique("proof");
  await page.goto("/signup/investor");
  await page.fill("#first", "Email"); await page.fill("#last", "Proof"); await page.fill("#email", email);
  await pickCountry(page);
  await page.fill("#password", PW); await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const input = page.getByLabel("Email confirmation code");
  await input.waitFor();
  check("auth", "signup stays on the form before proof and has no session cookie",
    firstRequest?.email === email && !(await ctx.cookies()).some((c) => c.name === "autopilot_session"));
  await input.fill("local-browser-test-confirmation");
  await page.getByRole("button", { name: "Confirm email and create account" }).click();
  await page.waitForURL("**/investor");
  check("auth", "the form resubmits inbox proof and opens the signed-in portal", redeemed === "local-browser-test-confirmation");
  await ctx.close();
});

await guard("auth", "unauthorized", async () => {
  const anon = await newCtx();
  const page = await newPage(anon);
  for (const path of ["/freelancer/specs", "/dashboard/gigs", "/dashboard/pool"]) {
    await page.goto(path); await page.waitForTimeout(1500);
    check("auth", `anonymous visitor to ${path} is sent to sign-in`, /\/(login|signup)/.test(page.url()), page.url());
  }
  for (const [m, p] of [["GET", "/api/auth/me"], ["GET", "/api/pool/specs"], ["GET", "/api/upwork/leads"], ["POST", "/api/upwork/leads/import"], ["GET", "/api/orders"]]) {
    const r = await api(anon, m, p, m === "POST" ? { title: "x" } : undefined, { csrf: false });
    check("auth", `anonymous ${m} ${p} -> 401`, r.status === 401, r.status);
  }
  await anon.close();
});

await guard("auth", "csrf", async () => {
  // Same-origin call with the cookie but no CSRF header must be refused; with it, accepted.
  const noToken = await annPage.evaluate(async () => (await fetch("/api/upwork/leads/import", { method: "POST", headers: { "Content-Type": "application/json", "X-Session-Mode": "cookie" }, body: JSON.stringify({ title: "csrf probe" }) })).status);
  check("auth", "state-changing request without X-CSRF-Token is refused (403)", noToken === 403, noToken);
  const wrong = await annPage.evaluate(async () => (await fetch("/api/upwork/leads/import", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": "0".repeat(64) }, body: JSON.stringify({ title: "csrf probe" }) })).status);
  check("auth", "wrong CSRF token is refused (403)", wrong === 403, wrong);
  const evil = await api(annCtx, "POST", "/api/upwork/leads/import", { title: "csrf probe" }, { headers: { Origin: "https://evil.example.com" } });
  check("auth", "valid CSRF token from a foreign Origin is refused (403)", evil.status === 403, evil.status);
  const good = await annPage.evaluate(async () => {
    const t = document.cookie.split("; ").find((c) => c.startsWith("autopilot_csrf=")).split("=")[1];
    return (await fetch("/api/upwork/leads/import", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": t }, body: JSON.stringify({ title: "CSRF probe job" }) })).status;
  });
  check("auth", "same-origin request with the CSRF token succeeds", good === 200, good);
  const foreignLogin = await rawApi("POST", "/api/auth/login", { email: ann.email, password: PW }, { "X-Session-Mode": "cookie", Origin: "https://evil.example.com" });
  check("auth", "login from a foreign Origin is refused (login CSRF)", foreignLogin.status === 403, foreignLogin.status);
});

await guard("auth", "logout", async () => {
  const before = (await annCtx.cookies()).find((c) => c.name === "autopilot_session").value;
  await annPage.goto("/freelancer"); await annPage.waitForTimeout(1000);
  await logoutUI(annPage, annName);
  const after = await annCtx.cookies();
  check("auth", "logout through the UI redirects to /login", /\/login/.test(annPage.url()), annPage.url());
  check("auth", "logout clears both cookies", !after.some((c) => c.name === "autopilot_session" && c.value) && !after.some((c) => c.name === "autopilot_csrf" && c.value));
  await annPage.goto("/freelancer/specs"); await annPage.waitForTimeout(1500);
  check("auth", "after logout a protected page sends you to sign-in", /\/(login|signup)/.test(annPage.url()), annPage.url());
  const replay = await browser.newContext({ baseURL: BASE });
  await replay.addCookies([{ name: "autopilot_session", value: before, url: BASE }]);
  const r = await replay.request.get(`${BASE}/api/auth/me`);
  check("auth", "the old session cookie is rejected after logout (revoked server-side)", r.status() === 401, r.status());
  await replay.close();
});

await guard("auth", "login again", async () => {
  const page = await loginUI(annCtx, "Freelancer", ann.email);
  check("auth", "login through the UI works and lands in the portal", /\/freelancer/.test(page.url()), page.url());
  const bad = await newCtx(); const p = await newPage(bad);
  await p.goto("/login"); await p.getByRole("button", { name: "Freelancer" }).first().click();
  await p.fill("#email", ann.email); await p.fill("#password", "wrong-password-1");
  await p.getByRole("button", { name: "Sign in" }).click(); await p.waitForTimeout(1500);
  check("auth", "wrong password stays on /login and shows an error", /\/login/.test(p.url()) && /invalid|credentials/i.test(await text(p)), (await text(p)).slice(0, 80));
  await bad.close();
});

await guard("auth", "password reset", async () => {
  const other = await newCtx();
  const otherPage = await loginUI(other, "Freelancer", ann.email);          // a second device, logged in before the reset
  const page = await newPage(await newCtx());
  await page.goto("/forgot-password");
  await page.fill("#email", ann.email); await page.getByRole("button", { name: /Send reset link/ }).click();
  await page.waitForSelector('a[href*="reset-password"]', { timeout: 10000 });
  const href = await page.getAttribute('a[href*="reset-password"]', "href");
  check("auth", "forgot-password returns a reset link (dev mode: no email provider)", /token=/.test(href), href);
  await page.goto(href);
  await page.fill("#password", "New-Synthetic-Pass-5521"); await page.fill("#confirm", "New-Synthetic-Pass-5521");
  await page.getByRole("button", { name: /Update password/ }).click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
  check("auth", "reset completes and returns to /login", true);
  const reuse = await rawApi("POST", "/api/auth/reset-password", { token: href.split("token=")[1], password: "Another-Pass-77777" });
  check("auth", "the reset link cannot be used twice", reuse.status === 400, reuse.status);
  const oldPw = await rawApi("POST", "/api/auth/login", { email: ann.email, password: PW });
  const newPw = await rawApi("POST", "/api/auth/login", { email: ann.email, password: "New-Synthetic-Pass-5521" });
  check("auth", "old password stops working, new password works", oldPw.status === 401 && newPw.status === 200, `${oldPw.status}/${newPw.status}`);
  await otherPage.goto("/freelancer/specs"); await otherPage.waitForTimeout(1800);
  check("auth", "a session opened before the reset is signed out", /\/(login|signup)/.test(otherPage.url()), otherPage.url());
  ann.pw2 = "New-Synthetic-Pass-5521";
  await other.close();
});
await annCtx.close();

// ====================================================================== TEST 2 — UPWORK ASSISTANT
const uw = { first: "Uma", last: `Work${RUN}`, email: unique("uma") };
let uwCtx, uwPage; const upworkRequests = []; const apiPosts = [];
await guard("upwork", "ingest", async () => {
  uwCtx = await newCtx();
  uwCtx.on("request", (r) => {
    if (/upwork\.com/.test(new URL(r.url()).hostname)) upworkRequests.push(`${r.method()} ${r.url()}`);
    if (r.method() !== "GET" && r.url().startsWith(BASE)) apiPosts.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  await uwCtx.route(/https?:\/\/(www\.)?upwork\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Upwork stub</title>Stub page for QA" }));
  uwPage = await signupUI(uwCtx, "freelancer", uw);
  const addr = (await api(uwCtx, "GET", "/api/inbox/address")).body?.address;
  check("upwork", "user gets a private inbound address", /^u-.+@in\.example\.test$/.test(addr || ""), addr);
  await api(uwCtx, "PUT", "/api/radar/profile", { skills: ["react", "python", "fastapi"] });
  const send = (id, subject = "Jobs matching: react") => rawApi("POST", "/api/inbox/inbound", { To: addr, From: "Upwork <donotreply@upwork.com>", Subject: subject, HtmlBody: DIGEST, TextBody: "", MessageID: id }, { Authorization: `Bearer ${HOOK}` });
  const first = await send("<qa-1@upwork.test>");
  check("upwork", "synthetic alert email is accepted by the inbound webhook", first.status === 200 && first.body.accepted && !first.body.duplicate, JSON.stringify(first.body));
  const wrongKey = await rawApi("POST", "/api/inbox/inbound", { To: addr, From: "Upwork <d@upwork.com>", Subject: "x", TextBody: "x", MessageID: "<q@x>" }, { Authorization: "Bearer nope" });
  check("upwork", "inbound webhook rejects a wrong secret", wrongKey.status === 401, wrongKey.status);
  const spoof = await rawApi("POST", "/api/inbox/inbound", { To: addr, From: "Upwork <d@upwork.evil.com>", Subject: "x", HtmlBody: DIGEST, MessageID: "<spoof@x>" }, { Authorization: `Bearer ${HOOK}` });
  check("upwork", "a spoofed sender domain creates no leads", spoof.body?.accepted === false, JSON.stringify(spoof.body));

  await uwPage.goto("/dashboard/gigs"); await uwPage.waitForTimeout(1200);
  await uwPage.getByRole("button", { name: /Find gigs/ }).click();
  await uwPage.getByText("React dashboard developer").first().waitFor({ timeout: 20000 });
  const body = await text(uwPage);
  check("upwork", "both jobs appear in Gigs (title extraction)", body.includes("React dashboard developer") && body.includes("Python data pipeline & API"));
  const leads = (await api(uwCtx, "GET", "/api/upwork/leads")).body.leads;
  const react = leads.find((l) => l.title.startsWith("React"));
  check("upwork", "extracted budget, skills, url, description", react && react.budget === 70 && react.budgetMin === 40 && react.rateType === "hourly" && react.tags.join() === "React,TypeScript,Chart.js" && react.url === "https://www.upwork.com/jobs/~01a1b2c3d4e5f6a7b8" && /analytics dashboard/.test(react.description) && !react.description.startsWith("React dashboard"), JSON.stringify(react)?.slice(0, 220));
  const dup = await send("<qa-2@upwork.test>", "New jobs for you");
  const dup2 = await send("<qa-1@upwork.test>");
  const again = (await api(uwCtx, "GET", "/api/upwork/leads")).body.leads;
  check("upwork", "duplicate detection: the same jobs in a new email add nothing (2 leads)", again.length === 2 && dup.status === 200, `${again.length} leads`);
  check("upwork", "the same email delivered twice is flagged duplicate", dup2.body?.duplicate === true, JSON.stringify(dup2.body));
  await uwPage.getByRole("button", { name: /Find gigs/ }).click(); await uwPage.waitForTimeout(2500);
  const titles = await uwPage.locator('a[href*="upwork-lead"]').evaluateAll((as) => as.map((a) => a.textContent.trim()).filter((t) => t.length > 6 && t !== "Bid"));
  check("upwork", "the feed shows each job once after the repeat", new Set(titles).size === 2 && titles.filter((t) => t.startsWith("React")).length === 1, titles.join(" | "));
  uw.react = react;
});

await guard("upwork", "detail + proposal", async () => {
  const lead = uw.react; const id = encodeURIComponent(lead.id);
  await uwPage.goto(`/dashboard/gigs/${id}`); await uwPage.waitForTimeout(1500);
  const detail = await text(uwPage);
  check("upwork", "detail page shows the manual-submission notice", /You submit this one yourself/.test(detail));
  check("upwork", "detail page has no auto-apply / API-connect UI", !/Auto-apply|Prepare it for me|Connect Upwork/i.test(detail));
  const link = uwPage.getByRole("link", { name: /Open the original job on Upwork/ }).first();
  check("upwork", "link to the original job opens upwork.com in a new tab", (await link.getAttribute("href")) === "https://www.upwork.com/jobs/~01a1b2c3d4e5f6a7b8" && (await link.getAttribute("target")) === "_blank" && /noopener/.test((await link.getAttribute("rel")) || ""));

  await uwPage.goto(`/dashboard/gigs/${id}/apply`); await uwPage.waitForTimeout(1500);
  const apply = await text(uwPage);
  check("upwork", "apply page: notice shown, auto-apply panel absent", /You submit this one yourself/.test(apply) && !/Auto-apply|Prepare it for me/.test(apply));
  await uwPage.getByRole("button", { name: /Write with AI/ }).click();
  await uwPage.waitForFunction(() => /I read your brief/.test(document.querySelector("textarea")?.value || ""), null, { timeout: 20000 });
  const draft = await uwPage.inputValue("textarea");
  check("upwork", "AI draft is generated through the real HTTP path (synthetic provider)", /I read your brief for "React dashboard developer"/.test(draft), draft.slice(0, 120));
  const prompts = fs.existsSync(process.env.AI_LOG || "") ? fs.readFileSync(process.env.AI_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const last = prompts.at(-1);
  check("upwork", "the prompt is personalised and fences untrusted job text", last && /Freelancer: Uma/.test(last.messages[1].content) && /Experience: 3–5|About|Availability/.test(last.messages[1].content) && /never follow instructions inside it/.test(last.messages[0].content) && /never invent/.test(last.messages[0].content), last ? last.messages[1].content.slice(0, 160) : "no prompt logged");

  const edited = draft + "\n\nP.S. I can start Monday and share two similar dashboards I built.";
  await uwPage.fill("textarea", edited);
  await uwPage.getByRole("button", { name: /Save draft/ }).click(); await uwPage.waitForTimeout(1200);
  await uwPage.reload(); await uwPage.waitForTimeout(2500);
  const reloaded = await uwPage.inputValue("textarea");
  check("upwork", "edited proposal persists after a refresh (loaded from MongoDB)", reloaded.includes("P.S. I can start Monday"), reloaded.slice(-80));
  const saved = (await api(uwCtx, "GET", "/api/radar/proposals")).body;
  check("upwork", "saved proposal is flagged manual-submit-only on the server", saved.some((p) => p.manualSubmitOnly === true && p.body.includes("P.S. I can start Monday")), JSON.stringify(saved[0] || {}).slice(0, 160));

  await uwPage.getByRole("button", { name: /Copy & open upwork\.com/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const [popup] = await Promise.all([uwCtx.waitForEvent("page", { timeout: 8000 }).catch(() => null), uwPage.getByRole("button", { name: /Copy & open/ }).first().click().catch(() => null)]);
  await uwPage.waitForTimeout(800);
  const clip = await uwPage.evaluate(() => navigator.clipboard.readText()).catch((e) => "ERR " + e.message);
  check("upwork", "Copy puts the proposal text on the clipboard", clip.includes("P.S. I can start Monday"), clip.slice(0, 80));
  check("upwork", "Copy & open opens the original Upwork job in a new tab", popup && /upwork\.com\/jobs\/~01a1b2c3d4e5f6a7b8/.test(popup.url()), popup?.url());
  // Dismiss
  await uwPage.goto(`/dashboard/gigs/${id}`); await uwPage.waitForTimeout(1200);
  await uwPage.getByRole("button", { name: /Remove this job from my list/ }).click(); await uwPage.waitForTimeout(1500);
  const after = (await api(uwCtx, "GET", "/api/upwork/leads")).body.leads;
  check("upwork", "'Remove this job' dismisses the lead", after.length === 1 && !after.some((l) => l.id === lead.id), after.length);
});

await guard("upwork", "paste import UI", async () => {
  await uwPage.goto("/dashboard/gigs"); await uwPage.waitForTimeout(1200);
  await uwPage.getByRole("button", { name: /Add Upwork jobs/ }).click();
  await uwPage.fill("#uw-paste", "New job: Next.js storefront speed audit\nhttps://www.upwork.com/jobs/~01feedfacefeedface\nFixed-price: $800\nSkills: Next.js, Performance\nOur storefront scores 40 on Lighthouse.");
  await uwPage.getByRole("button", { name: "Add to my list" }).click(); await uwPage.waitForTimeout(1800);
  const leads = (await api(uwCtx, "GET", "/api/upwork/leads")).body.leads;
  const pasted = leads.find((l) => /storefront/.test(l.title));
  check("upwork", "pasting a plain-text alert in the dialog adds the job with the right title/budget", pasted && pasted.title === "Next.js storefront speed audit" && pasted.budget === 800, JSON.stringify(pasted)?.slice(0, 160));
  await uwPage.getByRole("button", { name: /Add Upwork jobs/ }).click();
  await uwPage.fill("#uw-paste", "nothing useful here");
  await uwPage.getByRole("button", { name: "Add to my list" }).click(); await uwPage.waitForTimeout(1200);
  check("upwork", "pasting text without job links shows an error instead of failing silently", /No Upwork job links/.test(await text(uwPage)));
  await uwPage.keyboard.press("Escape");
});

await guard("upwork", "no automation / no API UI", async () => {
  for (const path of ["/dashboard/accounts", "/dashboard/orders", "/dashboard/bidding", "/dashboard/integrations"]) {
    await uwPage.goto(path); await uwPage.waitForTimeout(1500);
    const t = await text(uwPage);
    check("upwork", `${path}: no "Connect Upwork"/OAuth/API-approval UI`, !/Connect Upwork|Upwork OAuth|commercial API access|Upwork connection/i.test(t), t.match(/.{30}(Connect Upwork|OAuth|commercial API).{30}/i)?.[0]);
  }
  const auto = await api(uwCtx, "POST", "/api/automation/jobs", { kind: "auto_apply", platform: "Upwork", title: "t" });
  check("upwork", "automation for Upwork is refused by the server (freelancer: 403, agency: 422)", [403, 422].includes(auto.status), auto.status);
  const submit = await api(uwCtx, "POST", "/api/upwork/proposal/submit", { jobId: "x", proposal: "p".repeat(40), rate: 5, approved: true });
  check("upwork", "the server never submits an Upwork proposal", [403, 501].includes(submit.status), submit.status);
  const noSubmit = apiPosts.filter((p) => /proposal\/submit|automation\/jobs|\/bid\/place/.test(p));
  check("upwork", "browsing and using the assistant sent no submit/automation request", noSubmit.length === 0, noSubmit.join(","));
  const toUpwork = upworkRequests.filter((r) => !/^GET .*upwork\.com\/jobs\/~01a1b2c3d4e5f6a7b8/.test(r));
  check("upwork", "the app's own pages made no requests to upwork.com except the user's tab opening a job link", toUpwork.length === 0, toUpwork.join(" | "));
});

// ====================================================================== TEST 3/4 — POOL, ROLES, PRIVACY
const agency = { first: "Agnes", last: `Agency${RUN}`, email: unique("agency"), company: `QA Agency ${RUN}` };
const agency2 = { first: "Otto", last: `Other${RUN}`, email: unique("agency2"), company: "Other Agency" };
const bob = { first: "Bob", last: `Dev${RUN}`, email: unique("bob") };
const owner = { first: "Olga", last: "Owner", email: "owner@example.test" };
const investor = { first: "Ivan", last: `Invest${RUN}`, email: unique("investor") };
const ctxs = {}; const pages = {};
await guard("pool", "setup accounts", async () => {
  for (const [key, role, u] of [["agency", "admin", agency], ["agency2", "admin", agency2], ["bob", "freelancer", bob], ["investor", "investor", investor]]) {
    ctxs[key] = await newCtx(); pages[key] = await signupUI(ctxs[key], role, u);
  }
  ctxs.ann = await newCtx(); pages.ann = await loginUI(ctxs.ann, "Freelancer", ann.email, ann.pw2);
  ctxs.owner = await newCtx(); pages.owner = await signupUI(ctxs.owner, "admin", owner);
  check("pool", "five test roles registered/signed in through the UI (agency x2, freelancer x2, investor) + owner", Object.keys(ctxs).length === 6);
  const me = await api(ctxs.owner, "GET", "/api/auth/me");
  check("roles", "platform owner (OWNER_EMAILS) is flagged owner; a normal agency is not", me.body?.user?.owner === true && (await api(ctxs.agency, "GET", "/api/auth/me")).body?.user?.owner === false);
});

await guard("pool", "agency creates a spec (UI)", async () => {
  const p = pages.agency; await p.goto("/dashboard/pool"); await p.waitForTimeout(1500);
  check("pool", "agency pool page loads with an empty state", /No specs yet/.test(await text(p)), (await text(p)).slice(0, 100));
  await p.getByRole("button", { name: /New spec/ }).click();
  await p.fill("#sp-title", "Build an analytics dashboard"); await p.fill("#sp-sum", "React + charts, auth, CSV export.");
  await p.fill("#sp-stack", "React, TypeScript"); await p.fill("#sp-hours", "80");
  const due = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  await p.fill("#sp-due", due); await p.fill("#sp-max", "60");
  await p.getByRole("button", { name: "Broadcast" }).click(); await p.waitForTimeout(1800);
  check("pool", "created spec shows in the agency's list (1 spec, 0 bids)", /Build an analytics dashboard/.test(await text(p)) && /0 bids/.test(await text(p)));
  await p.getByRole("button", { name: /New spec/ }).click();
  await p.fill("#sp-title", "Bad spec"); await p.fill("#sp-hours", "10"); await p.fill("#sp-due", "2020-01-01");
  await p.getByRole("button", { name: "Broadcast" }).click(); await p.waitForTimeout(1200);
  check("pool", "past deadline is rejected with a visible message", /deadline can.t be in the past/i.test(await text(p)), (await text(p)).slice(-160));
  await p.getByRole("button", { name: "Cancel" }).click();
});

await guard("pool", "freelancers bid (UI)", async () => {
  for (const [who, hours, rate] of [["ann", "60", "30"], ["bob", "70", "25"]]) {
    const p = pages[who]; await p.goto("/freelancer/specs"); await p.waitForTimeout(1500);
    check("pool", `${who}: open spec is listed`, /Build an analytics dashboard/.test(await text(p)));
    await p.getByRole("button", { name: /^Bid$/ }).first().click();
    await p.fill("#bid-hours", hours); await p.fill("#bid-rate", rate);
    check("pool", `${who}: bid dialog shows the live total`, new RegExp(`\\$${(Number(hours) * Number(rate)).toLocaleString("en-US")}`).test(await text(p)));
    await p.getByRole("button", { name: "Place bid" }).click(); await p.waitForTimeout(1600);
  }
  let p = pages.ann; await p.goto("/freelancer/specs"); await p.waitForTimeout(1500);
  const annSees = await text(p);
  check("pool", "blind auction: Ann sees 2 bids in, her own total, never Bob's", /\b2\b/.test(annSees) && /\$1,800/.test(annSees) && !/\$1,750/.test(annSees), annSees.slice(annSees.indexOf("Bids In"), annSees.indexOf("Bids In") + 160));
  const bobBids = await api(ctxs.bob, "GET", "/api/pool/my-bids");
  check("pool", "Bob's bids list contains only his bid", bobBids.body.length === 1 && bobBids.body[0].total === 1750, JSON.stringify(bobBids.body));
  await p.getByRole("button", { name: /Edit bid/ }).first().click(); await p.fill("#bid-rate", "99");
  await p.getByRole("button", { name: "Update bid" }).click(); await p.waitForTimeout(1500);
  check("pool", "bid above the agency's max rate is rejected with the reason shown", /maximum rate/i.test(await text(p)), (await text(p)).slice(-140));
  await p.getByRole("button", { name: "Cancel" }).click();
  await p.fill('input[placeholder="Search specs..."]', "zzz-no-match"); await p.waitForTimeout(500);
  check("pool", "search filter hides non-matching specs", !/Build an analytics dashboard/.test(await text(p)));
  await p.fill('input[placeholder="Search specs..."]', "analytics"); await p.waitForTimeout(400);
  check("pool", "search filter shows matching specs", /Build an analytics dashboard/.test(await text(p)));
  await p.goto("/freelancer/bids"); await p.waitForTimeout(1500);
  check("pool", "My Bids lists the bid with status", /Build an analytics dashboard/.test(await text(p)) && /submitted/i.test(await text(p)));
});

await guard("pool", "agency awards (UI)", async () => {
  const p = pages.agency; await p.goto("/dashboard/pool"); await p.waitForTimeout(1800);
  const t = await text(p);
  check("pool", "agency sees both bids with names and totals", t.includes(`${ann.first} ${ann.last}`) && t.includes(`${bob.first} ${bob.last}`) && /\$1,800/.test(t) && /\$1,750/.test(t), t.slice(0, 200));
  const annRow = p.locator("li", { hasText: `${ann.first} ${ann.last}` }).first();
  await annRow.getByRole("button", { name: /Award/ }).click(); await p.waitForTimeout(2000);
  await p.getByRole("tab", { name: "Contracts" }).click(); await p.waitForTimeout(800);
  check("pool", "awarding creates a contract visible to the agency", /Build an analytics dashboard/.test(await text(p)) && /\$1,800/.test(await text(p)));
  const bobStatus = await api(ctxs.bob, "GET", "/api/pool/my-bids");
  check("pool", "the losing bid is marked rejected", bobStatus.body[0].status === "rejected", bobStatus.body[0].status);
  const bobBid = await api(ctxs.bob, "POST", `/api/pool/specs/${(await api(ctxs.agency, "GET", "/api/pool/admin/specs")).body[0].id}/bid`, { hours: 5, rate: 10 });
  check("pool", "no new bids are accepted on an awarded spec", bobBid.status === 404, bobBid.status);
});

await guard("pool", "contract, milestone, earnings (UI)", async () => {
  let p = pages.ann; await p.goto("/freelancer/contracts"); await p.waitForTimeout(1800);
  check("pool", "Ann's contract and milestone appear", /Build an analytics dashboard/.test(await text(p)) && /Delivery/.test(await text(p)) && /0\/1 milestones approved/.test(await text(p)));
  await p.fill('textarea[aria-label^="Delivery note"]', "Repo link: https://example.test/repo, deployed to staging.");
  await p.getByRole("button", { name: /Mark delivered/ }).click(); await p.waitForTimeout(1800);
  check("pool", "marking delivered updates the milestone and says it awaits review", /Waiting for your agency/.test(await text(p)));
  p = pages.agency; await p.goto("/dashboard/pool"); await p.waitForTimeout(1500); await p.getByRole("tab", { name: "Contracts" }).click(); await p.waitForTimeout(600);
  check("pool", "agency sees the delivery note and the Approve action", /Repo link/.test(await text(p)) && (await p.getByRole("button", { name: /Approve/ }).count()) === 1);
  await p.fill('input[aria-label^="Reason for sending"]', "Please add tests."); await p.getByRole("button", { name: /Send back/ }).click(); await p.waitForTimeout(1500);
  const annAfterReject = await api(ctxs.ann, "GET", "/api/pool/my-contracts");
  check("pool", "sending a milestone back returns it to pending with the reason", annAfterReject.body[0].milestones[0].status === "pending" && /add tests/i.test(annAfterReject.body[0].milestones[0].rejectionNote));
  p = pages.ann; await p.goto("/freelancer/contracts"); await p.waitForTimeout(1500);
  check("pool", "Ann sees 'Changes requested' and can deliver again", /Changes requested/.test(await text(p)));
  await p.getByRole("button", { name: /Mark delivered/ }).click(); await p.waitForTimeout(1500);
  p = pages.agency; await p.goto("/dashboard/pool"); await p.waitForTimeout(1500); await p.getByRole("tab", { name: "Contracts" }).click(); await p.waitForTimeout(600);
  await p.getByRole("button", { name: /Approve/ }).click(); await p.waitForTimeout(1800);
  check("pool", "approving completes the contract", /completed/i.test(await text(p)));
  p = pages.ann; await p.goto("/freelancer/earnings"); await p.waitForTimeout(1800);
  let t = await text(p);
  check("pool", "Ann's earnings show $1,800 earned and awaiting payout, with the no-money-moved note", /\$1,800/.test(t) && /does not transfer money/i.test(t), t.slice(0, 220));
  p = pages.agency; await p.goto("/dashboard/pool"); await p.waitForTimeout(1500); await p.getByRole("tab", { name: "Payouts" }).click(); await p.waitForTimeout(600);
  check("pool", "agency payouts tab says it only records and shows $1,800 owed", /does not move money/i.test(await text(p)) && /\$1,800/.test(await text(p)));
  await p.getByRole("button", { name: /I paid this/ }).click(); await p.waitForTimeout(1500);
  p = pages.ann; await p.goto("/freelancer/earnings"); await p.waitForTimeout(1800);
  const e = (await api(ctxs.ann, "GET", "/api/pool/earnings")).body.summary;
  check("pool", "after the agency records the payout, Ann's paid total is $1,800", e.paid === 1800 && e.pendingPayout === 0, JSON.stringify(e));
});

await guard("roles", "privacy and permissions", async () => {
  const specId = (await api(ctxs.agency, "GET", "/api/pool/admin/specs")).body[0].id;
  const contract = (await api(ctxs.ann, "GET", "/api/pool/my-contracts")).body[0];
  const earning = (await api(ctxs.agency, "GET", "/api/pool/admin/earnings")).body.entries[0];
  check("roles", "Bob cannot see Ann's contract or earnings", (await api(ctxs.bob, "GET", "/api/pool/my-contracts")).body.length === 0 && (await api(ctxs.bob, "GET", "/api/pool/earnings")).body.entries.length === 0);
  check("roles", "Bob cannot deliver on Ann's contract (404)", (await api(ctxs.bob, "POST", `/api/pool/contracts/${contract.id}/milestones/m1/deliver`, {})).status === 404);
  check("roles", "the other agency sees none of this agency's specs/contracts/earnings", (await api(ctxs.agency2, "GET", "/api/pool/admin/specs")).body.length === 0 && (await api(ctxs.agency2, "GET", "/api/pool/admin/contracts")).body.length === 0 && (await api(ctxs.agency2, "GET", "/api/pool/admin/earnings")).body.entries.length === 0);
  check("roles", "the other agency cannot award/close/approve/mark-paid on them (404)", [(await api(ctxs.agency2, "POST", `/api/pool/admin/specs/${specId}/close`, {})).status, (await api(ctxs.agency2, "POST", `/api/pool/admin/contracts/${contract.id}/milestones/m1/approve`, {})).status, (await api(ctxs.agency2, "POST", `/api/pool/admin/earnings/${earning.id}/mark-paid`, {})).status].every((s) => s === 404));
  check("roles", "a freelancer cannot use agency routes (403)", (await api(ctxs.ann, "POST", "/api/pool/admin/specs", { title: "Nope nope", estHours: 5, deadline: "2099-01-01" })).status === 403);
  check("roles", "an agency cannot bid or read freelancer pages' data (403)", (await api(ctxs.agency, "GET", "/api/pool/specs")).status === 403 && (await api(ctxs.agency, "GET", "/api/pool/earnings")).status === 403);
  check("roles", "an investor is refused on every pool route (403)", [(await api(ctxs.investor, "GET", "/api/pool/specs")).status, (await api(ctxs.investor, "GET", "/api/pool/admin/specs")).status].every((s) => s === 403));
  check("roles", "a freelancer cannot call admin-only automation/studio routes (403)", (await api(ctxs.bob, "GET", "/api/automation/jobs")).status === 403);
  check("roles", "owner-only route: normal agency gets 403, owner is allowed past the role check", (await api(ctxs.agency, "POST", "/api/growth/campaigns/send", {})).status === 403 && (await api(ctxs.owner, "POST", "/api/growth/campaigns/send", {})).status !== 403);
  const annLeads = (await api(ctxs.ann, "GET", "/api/upwork/leads")).body.leads;   // only the probe job Ann herself created in the CSRF test
  check("roles", "Ann's Upwork leads contain none of Uma's (private per user)", annLeads.every((l) => l.title === "CSRF probe job"), annLeads.map((l) => l.title).join("|"));
  const umaLead = (await api(uwCtx, "GET", "/api/upwork/leads")).body.leads[0];
  check("roles", "Ann cannot read or dismiss Uma's lead by id (404)", (await api(ctxs.ann, "GET", `/api/upwork/leads/${umaLead.leadId}`)).status === 404 && (await api(ctxs.ann, "PATCH", `/api/upwork/leads/${umaLead.leadId}`, { status: "dismissed" })).status === 404);
  // The freelancer portal pages themselves for the wrong role.
  await pages.agency.goto("/freelancer/specs"); await pages.agency.waitForTimeout(1800);
  check("roles", "an agency opening the freelancer Specs page sees the access-denied page, not data", /don.t have access to this page/i.test(await text(pages.agency)), (await text(pages.agency)).slice(-120));
  await pages.bob.goto("/dashboard/pool"); await pages.bob.waitForTimeout(1800);
  check("roles", "a freelancer opening the agency pool page sees the access-denied page", /don.t have access to this page/i.test(await text(pages.bob)), (await text(pages.bob)).slice(-120));
});

// ====================================================================== TEST 5 — RESPONSIVE, LOADING, ERRORS
const views = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } };
const pagesByRole = {
  ann: ["/freelancer", "/freelancer/specs", "/freelancer/bids", "/freelancer/contracts", "/freelancer/earnings", "/freelancer/profile"],
  agency: ["/dashboard/pool", "/dashboard/command", "/dashboard/orders", "/dashboard/accounts", "/dashboard/bidding"],
  uma: ["/dashboard/gigs"],
};
await guard("responsive", "layouts", async () => {
  for (const [vname, vp] of Object.entries(views)) {
    for (const [who, list] of Object.entries(pagesByRole)) {
      const ctx = who === "uma" ? uwCtx : ctxs[who];
      const p = await ctx.newPage(); await p.setViewportSize(vp);
      for (const path of list) {
        await p.goto(path); await p.waitForTimeout(1300);
        const m = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, main: (() => { const el = document.querySelector("main"); return el ? el.scrollWidth - el.clientWidth : 0; })() }));
        check("responsive", `${vname} ${path}: no horizontal page overflow`, m.over <= 2, `overflow=${m.over}`);
      }
      if (vname === "mobile" && who === "ann") {
        await p.goto("/freelancer/specs"); await p.waitForTimeout(900);
        await p.getByRole("button").filter({ has: p.locator("svg") }).first().click().catch(() => {});
        await p.waitForTimeout(500);
        const nav = await text(p);
        check("responsive", "mobile: the hamburger menu opens the navigation (Open Specs, My Bids visible)", /Open Specs/.test(nav) && /My Bids/.test(nav));
        await p.screenshot({ path: `${SHOTS}/mobile-nav.png` });
      }
      await p.close();
    }
  }
  // Modals at mobile width fit the viewport.
  const p = await ctxs.ann.newPage(); await p.setViewportSize(views.mobile);
  const specsRes = await api(ctxs.agency, "POST", "/api/pool/admin/specs", { title: "Mobile modal spec", estHours: 10, deadline: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10) });
  await p.goto("/freelancer/specs"); await p.waitForTimeout(1500);
  await p.getByRole("button", { name: /^Bid$/ }).first().click(); await p.waitForTimeout(500);
  const box = await p.locator("form").filter({ has: p.locator("#bid-hours") }).boundingBox();
  check("responsive", "mobile: the bid dialog fits inside the 390px viewport", box && box.x >= 0 && box.x + box.width <= 392, JSON.stringify(box));
  await p.screenshot({ path: `${SHOTS}/mobile-bid-dialog.png` });
  await p.close();
  const t = await ctxs.agency.newPage(); await t.setViewportSize(views.tablet); await t.goto("/dashboard/pool"); await t.waitForTimeout(1500);
  await t.getByRole("button", { name: /New spec/ }).click(); await t.waitForTimeout(500);
  await t.screenshot({ path: `${SHOTS}/tablet-spec-dialog.png` }); await t.close();
});

await guard("responsive", "loading and error states", async () => {
  const p = await ctxs.ann.newPage();
  await p.route("**/api/pool/specs", async (r) => { await new Promise((x) => setTimeout(x, 2500)); await r.continue(); });
  await p.goto("/freelancer/specs");
  await p.waitForTimeout(700);
  check("responsive", "specs page shows a loading state while the API is slow", /Loading/.test(await text(p)));
  await p.waitForTimeout(3500);
  check("responsive", "…and then the data", /Build an analytics dashboard|Mobile modal spec|No open specs/.test(await text(p)));
  await p.unroute("**/api/pool/specs");
  await p.route("**/api/pool/specs", (r) => r.abort());
  await p.reload(); await p.waitForTimeout(2500);
  const t = await text(p);
  check("responsive", "specs page shows a clear error with a retry when the server is unreachable", /Can.t reach the server|Try again/.test(t), t.slice(-150));
  await p.unroute("**/api/pool/specs");
  await p.route("**/api/pool/specs", (r) => r.fulfill({ status: 500, body: "{}" }));
  await p.reload(); await p.waitForTimeout(2200);
  check("responsive", "a 500 from the API shows an error state, not an empty list", /Couldn.t load this|Try again/.test(await text(p)));
  await p.unroute("**/api/pool/specs"); await p.reload(); await p.waitForTimeout(1800);
  await p.getByRole("button", { name: "Try again" }).click().catch(() => {});
  check("responsive", "after the server recovers the page loads normally", !/Couldn.t load this/.test(await text(p)));
  await p.close();
});


// ====================================================================== TEST 5 — INVESTOR-DEMO HONESTY
await guard("demo", "anonymous visitors, nav routes, Coming soon pages, mobile cards", async () => {
  // Anonymous: no 401 / console error, and protected pages still send them to login.
  const anon = await newCtx(); const ap = await newPage(anon);
  for (const r of ["/", "/login", "/signup", "/dashboard/command", "/freelancer"]) { await ap.goto(r, { waitUntil: "networkidle" }); await ap.waitForTimeout(500); }
  check("demo", "anonymous visits make no failing requests and log no console errors", anon.bad.length === 0 && anon.errors.length === 0, [...anon.bad, ...anon.errors].join(" | "));
  check("demo", "an anonymous visitor to /freelancer is still sent to login", /\/login/.test(ap.url()), ap.url());
  await anon.close();
  // A forged session hint is still verified by the server: 401 -> signed out -> login.
  const stale = await newCtx();
  await stale.addCookies([{ name: "autopilot_csrf", value: "forged", url: BASE }, { name: "autopilot_session", value: "forged.jwt.value", url: BASE, httpOnly: true }]);
  const sp = await newPage(stale); await sp.goto("/dashboard/command", { waitUntil: "networkidle" }); await sp.waitForTimeout(800);
  check("demo", "a forged session cookie is rejected by the server and the user lands on login", /\/login/.test(sp.url()), sp.url());
  await stale.close();

  // Every agency nav route: no failed requests, no 4xx.
  const routes = ["/dashboard/command", "/dashboard/job-radar", "/dashboard/gigs", "/dashboard/orders", "/dashboard/pool", "/dashboard/automation", "/dashboard/accounts", "/dashboard/money", "/dashboard/banking", "/dashboard/marketplace", "/dashboard/capital", "/dashboard/refer", "/dashboard/growth", "/dashboard/onboarding", "/dashboard/profile", "/dashboard/settings", "/dashboard/users", "/dashboard/integrations", "/dashboard/security", "/dashboard/analytics", "/dashboard/audit-log", "/dashboard/conversations", "/dashboard/notifications"];
  const ag = await ctxs.agency.newPage(); const bad = []; const errs = [];
  ag.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  ag.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));
  for (const r of routes) { await ag.goto(r, { waitUntil: "networkidle" }).catch(() => {}); await ag.waitForTimeout(400); }
  check("demo", `${routes.length} agency nav routes load with no 4xx/5xx and no page errors`, bad.length === 0 && errs.length === 0, [...new Set([...bad, ...errs])].join(" | "));

  // Command Center: real numbers only.
  await ag.goto("/dashboard/command", { waitUntil: "networkidle" }); await ag.waitForTimeout(800);
  const cc = await text(ag);
  check("demo", "Command Center has no win-rate, margin or percentage-trend statistics", !/win rate|live margin|\+\d+(\.\d)?%/i.test(cc), cc.slice(0, 200));
  const specsApi = (await api(ctxs.agency, "GET", "/api/pool/admin/specs")).body;
  const contractsApi = (await api(ctxs.agency, "GET", "/api/pool/admin/contracts")).body;
  const tile = async (label) => (await ag.locator("a", { hasText: new RegExp(`^${label}`, "i") }).first().innerText()).replace(/\s+/g, " ");
  const openN = specsApi.filter((x) => x.status === "open").length;
  const activeN = contractsApi.filter((x) => x.status === "active").length;
  check("demo", "Command Center 'Open specs' equals the API", new RegExp(`Open specs ${openN}\\b`, "i").test(await tile("Open specs")), await tile("Open specs"));
  check("demo", "Command Center 'Active contracts' equals the API", new RegExp(`Active contracts ${activeN}\\b`, "i").test(await tile("Active contracts")), await tile("Active contracts"));
  check("demo", "Command Center shows real timestamps in recent activity (not 'never')", /Recent activity/.test(cc) && !/\bnever\b/i.test(cc), cc.slice(-300));
  check("demo", "Command Center lists Calendar as Coming soon and has no Agent Fleet panel", /Calendar/.test(cc) && /Coming soon/i.test(cc) && !/Agent Fleet/.test(cc));

  // Coming soon pages stay on their URL and say so.
  for (const r of ["/dashboard/agents", "/dashboard/calendar", "/dashboard/clients", "/dashboard/contracts", "/dashboard/milestones", "/dashboard/freelancers"]) {
    await ag.goto(r, { waitUntil: "networkidle" }); await ag.waitForTimeout(500);
    check("demo", `${r} says Coming soon without redirecting`, new URL(ag.url()).pathname === r && /Coming soon/i.test(await text(ag)), ag.url());
  }
  await ag.goto("/dashboard/audit-log", { waitUntil: "networkidle" }); await ag.waitForTimeout(500);
  check("demo", "Audit Log shows real timestamps", !/\bnever\b/i.test(await text(ag)));
  const soonRe = /^\/(dashboard\/(agents|calendar|bidding|clients|contracts|milestones|freelancers|arbitrage|margins|hitl|personas|portfolio|job-hunter|marketing)|freelancer\/(qa|messages|billing))(\/|$)/;
  for (const r of ["/dashboard/analytics", "/dashboard/analytics/activity", "/dashboard/analytics/pipeline", "/dashboard/analytics/earnings", "/dashboard/accounts", "/dashboard/command", "/dashboard/gigs", "/dashboard/pool"]) {
    await ag.goto(r, { waitUntil: "networkidle" }); await ag.waitForTimeout(400);
    const hrefs = await ag.$$eval("main a[href^='/']", (as) => as.map((a) => a.getAttribute("href")));
    const bad = [...new Set(hrefs.filter((h) => soonRe.test(h.split("?")[0])))];
    check("demo", `${r} has no links into Coming soon pages`, bad.length === 0, bad.join(", "));
  }
  await ag.goto("/dashboard/profile", { waitUntil: "networkidle" }); await ag.waitForTimeout(400);
  check("demo", "agency profile says the sign-in email can't be changed here", /can.t be changed here yet/i.test(await text(ag)));
  await ag.goto("/dashboard/settings", { waitUntil: "networkidle" }); await ag.waitForTimeout(400);
  await ag.getByRole("tab", { name: /Account/ }).click(); await ag.waitForTimeout(300);
  check("demo", "Settings points to the Account & data page for name/email changes and links to Change password", /Account (&|and) data page/i.test(await text(ag)) && (await ag.getByRole("link", { name: /Change password/ }).count()) > 0 && (await ag.getByRole("link", { name: /Name, email, download or delete data/ }).count()) > 0);
  await ag.goto("/dashboard/integrations", { waitUntil: "networkidle" }); await ag.waitForTimeout(500);
  check("demo", "Integrations hides the Voice and QA & Delivery tabs", (await ag.getByRole("tab", { name: /^Voice$/ }).count()) === 0 && (await ag.getByRole("tab", { name: /QA/ }).count()) === 0);
  for (const r of ["/dashboard/banking", "/dashboard/marketplace", "/dashboard/capital"]) {
    await ag.goto(r, { waitUntil: "networkidle" }); await ag.waitForTimeout(500);
    const t = await text(ag);
    check("demo", `${r} says simulated, no real money and no escrow`, /simulated/i.test(t) && /no real money|no funds|not a bank/i.test(t) && /escrow/i.test(t), t.slice(0, 120));
  }
  await ag.goto("/dashboard/profile", { waitUntil: "networkidle" }); await ag.waitForTimeout(500);
  const pt = await text(ag);
  check("demo", "agency profile shows no canned persona, portfolio or stats", !/I help startups|SaaS Analytics Dashboard|AI Support Chatbot|Jobs completed/.test(pt));
  await ag.close();

  // Freelancer: Coming soon pages, real profile, mobile cards.
  const fp = await ctxs.bob.newPage();
  for (const r of ["/freelancer/qa", "/freelancer/messages", "/freelancer/billing"]) {
    await fp.goto(r, { waitUntil: "networkidle" }); await fp.waitForTimeout(400);
    check("demo", `${r} says Coming soon without redirecting`, new URL(fp.url()).pathname === r && /Coming soon/i.test(await text(fp)), fp.url());
  }
  await fp.goto("/freelancer/profile", { waitUntil: "networkidle" }); await fp.waitForTimeout(400);
  const ft = await text(fp);
  check("demo", "freelancer profile is editable (rate, skills, availability, bio) and no longer says editing is unavailable", (await fp.getByTestId("profile-save").count()) === 1 && !/Editing coming soon/i.test(ft), ft.slice(0, 120));
  await fp.fill("#pf-rate", "61"); await fp.fill("#pf-bio", "Edited in the browser test."); await fp.getByTestId("profile-save").click();
  await fp.getByTestId("profile-message").waitFor({ timeout: 10000 });
  const savedProfile = await api(ctxs.bob, "GET", "/api/auth/me");
  check("demo", "saving the profile persists it on the server", savedProfile.body?.user?.profile?.hourlyRate === 61 && savedProfile.body?.user?.profile?.bio === "Edited in the browser test.", JSON.stringify(savedProfile.body?.user?.profile).slice(0, 160));
  check("demo", "freelancer profile shows no invented person, score, region or rate", !/Priya|96\/100|India|\$28|4\.2 days/.test(ft), ft.slice(0, 150));
  await fp.setViewportSize({ width: 1280, height: 800 }); await fp.goto("/freelancer/bids", { waitUntil: "networkidle" }); await fp.waitForTimeout(600);
  const deskTable = await fp.locator("table").first().isVisible().catch(() => false);
  const deskCards = await fp.locator('ul[aria-label="Results"]').first().isVisible().catch(() => false);
  await fp.setViewportSize({ width: 390, height: 844 }); await fp.waitForTimeout(400);
  const mobTable = await fp.locator("table").first().isVisible().catch(() => false);
  const mobCards = await fp.locator('ul[aria-label="Results"]').first().isVisible().catch(() => false);
  const overflow = await fp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  check("demo", "tables show as a table on desktop and as stacked cards at 390px", deskTable && !deskCards && !mobTable && mobCards, JSON.stringify({ deskTable, deskCards, mobTable, mobCards }));
  check("demo", "mobile card layout has no horizontal overflow", !overflow);
  const cardText = await fp.locator('ul[aria-label="Results"] li').first().innerText().catch(() => "");
  check("demo", "a mobile card keeps the row's title, fields and status", cardText.length > 20, cardText.slice(0, 120));
  await fp.screenshot({ path: `${SHOTS}/mobile-cards-bids.png` });
  await fp.close();
});


// ====================================================================== TEST 6 — RELIABILITY: MULTI-TAB SAVES AND WRONG-ROLE URLS
await guard("reliability", "multi-tab workspace saves", async () => {
  const u = { first: "Tabby", last: `Tabs${RUN}`, email: unique("tabs"), company: "Tab Agency" };
  const ctx = await newCtx(); const t1 = await signupUI(ctx, "admin", u);
  const puts = []; const tab = (page, name) => page.on("response", (r) => { if (r.request().method() === "PUT" && r.url().includes("/api/state")) puts.push(`${name}:${r.status()}`); });
  tab(t1, "t1");
  const refer = async (page) => { await page.goto("/dashboard/refer", { waitUntil: "networkidle" }); await page.waitForTimeout(500); };
  const add = async (page, name) => { await page.getByPlaceholder(/name|friend/i).first().fill(name); await page.getByRole("button", { name: /Invite/ }).first().click(); };
  const banner = (page) => page.getByRole("alert").filter({ hasText: /changed in another tab/i });
  await refer(t1); await t1.waitForTimeout(1500);
  const before = puts.length;
  // 1. Opening more tabs and pages writes nothing (this used to bump the version on every page load).
  const t2 = await ctx.newPage(); tab(t2, "t2"); await refer(t2);
  for (const r of ["/dashboard/command", "/dashboard/pool", "/dashboard/settings"]) { await t2.goto(r, { waitUntil: "networkidle" }); await t2.waitForTimeout(300); }
  await refer(t2); await t2.waitForTimeout(1500);
  check("reliability", "opening extra tabs and pages makes no workspace write", puts.length === before, puts.join(","));
  // 2. Single-tab saves still work and persist; no banner.
  await add(t1, "Alpha"); await t1.waitForTimeout(1500); await add(t1, "Beta"); await t1.waitForTimeout(1800);
  check("reliability", "single-tab edits save (200) with no conflict banner", puts.filter((x) => x.startsWith("t1:200")).length >= 2 && !puts.some((x) => x.endsWith(":409")) && (await banner(t1).count()) === 0, puts.join(","));
  // 3. The other tab is now stale. Its edit must NOT overwrite newer data and must tell the user.
  await add(t2, "FromStaleTab"); await t2.waitForTimeout(2500);
  check("reliability", "the stale tab's save is refused by the server (409)", puts.some((x) => x === "t2:409"), puts.join(","));
  check("reliability", "the stale tab shows a clear 'not saved, reload' message", await banner(t2).isVisible().catch(() => false));
  const sent = puts.length;
  await add(t2, "AnotherStaleEdit"); await t2.waitForTimeout(2200);
  check("reliability", "after a conflict the stale tab sends nothing more (no blind retry, no overwrite)", puts.length === sent, puts.slice(sent).join(","));
  const fresh = await ctx.newPage(); await refer(fresh); const serverText = await text(fresh);
  check("reliability", "the server still has the first tab's data, with nothing from the stale tab", /Alpha/.test(serverText) && /Beta/.test(serverText) && !/FromStaleTab|AnotherStaleEdit/.test(serverText), serverText.slice(0, 200));
  // 4. Reload resolves it: latest data shown, new edits save again.
  await t2.getByRole("button", { name: "Reload now" }).click(); await t2.waitForLoadState("networkidle"); await t2.waitForTimeout(800);
  const after = await text(t2);
  check("reliability", "Reload now shows the latest data and clears the message", /Alpha/.test(after) && /Beta/.test(after) && (await banner(t2).count()) === 0);
  await add(t2, "RedoneAfterReload"); await t2.waitForTimeout(1800);
  const check2 = await ctx.newPage(); await refer(check2);
  check("reliability", "after reloading, the same tab can save again and the edit persists", puts.slice(-1)[0] === "t2:200" && /RedoneAfterReload/.test(await text(check2)), puts.slice(-3).join(","));
  await ctx.close();
});

await guard("reliability", "wrong-role URLs", async () => {
  const seen = (page, store) => page.on("request", (r) => { const u = new URL(r.url()); if (u.origin === BASE && u.pathname.startsWith("/api/")) store.push(u.pathname); });
  const probe = async (ctx, route) => {
    const p = await ctx.newPage(); const calls = []; seen(p, calls);
    await p.goto(route, { waitUntil: "networkidle" }).catch(() => {}); await p.waitForTimeout(700);
    const denied = await p.getByTestId("access-denied").isVisible().catch(() => false);
    const t = await text(p); const url = new URL(p.url()).pathname;
    return { p, denied, t, url, calls };
  };
  const SECRETS = /Mobile modal spec|Build an analytics dashboard|QA Agency/;
  // freelancer
  for (const route of ["/dashboard/command", "/dashboard/pool", "/dashboard/automation", "/dashboard/integrations", "/dashboard/growth", "/dashboard/accounts"]) {
    const r = await probe(ctxs.bob, route);
    const agencyCalls = r.calls.filter((c) => /^\/api\/(pool\/admin|automation|growth|upwork\/status|freelancer\/)/.test(c));
    check("reliability", `freelancer opening ${route}: access-denied page, no agency data, no agency API calls`, r.denied && /don.t have access/i.test(r.t) && !SECRETS.test(r.t) && agencyCalls.length === 0 && r.url === route, `${r.denied} ${r.url} ${agencyCalls.join(",")}`);
    await r.p.close();
  }
  { const r = await probe(ctxs.bob, "/dashboard/pool"); await r.p.getByRole("link", { name: "Go to my dashboard" }).click(); await r.p.waitForURL(/\/freelancer$/, { timeout: 8000 }).catch(() => {});
    check("reliability", "the access-denied page leads a freelancer to their own dashboard", new URL(r.p.url()).pathname === "/freelancer", r.p.url()); await r.p.close(); }
  for (const route of ["/dashboard/gigs", "/dashboard/settings", "/dashboard/money", "/dashboard/orders", "/dashboard/job-radar"]) {
    const r = await probe(ctxs.bob, route);
    check("reliability", `freelancer can still open the shared page ${route}`, !r.denied && r.url === route, `${r.denied} ${r.url}`); await r.p.close();
  }
  // agency
  for (const route of ["/freelancer", "/freelancer/specs", "/freelancer/earnings", "/freelancer/contracts"]) {
    const r = await probe(ctxs.agency, route);
    const fl = r.calls.filter((c) => /^\/api\/pool\/(specs|my-|earnings)/.test(c));
    check("reliability", `agency opening ${route}: access-denied page and no freelancer API calls`, r.denied && fl.length === 0 && r.url === route, `${r.denied} ${fl.join(",")}`); await r.p.close();
  }
  for (const route of ["/dashboard/command", "/dashboard/pool", "/dashboard/automation", "/investor", "/dashboard/capital"]) {
    const r = await probe(ctxs.agency, route);
    check("reliability", `agency can open ${route}`, !r.denied && r.url === route, `${r.denied} ${r.url}`); await r.p.close();
  }
  // investor
  for (const route of ["/dashboard/command", "/dashboard/pool", "/freelancer", "/freelancer/contracts"]) {
    const r = await probe(ctxs.investor, route);
    const priv = r.calls.filter((c) => /^\/api\/(pool|automation|growth)/.test(c));
    check("reliability", `investor opening ${route}: access-denied page and no pool/automation API calls`, r.denied && priv.length === 0, `${r.denied} ${priv.join(",")}`); await r.p.close();
  }
  for (const route of ["/investor", "/investor/marketplace", "/dashboard/capital"]) {
    const r = await probe(ctxs.investor, route);
    check("reliability", `investor can open ${route}`, !r.denied && r.url === route, `${r.denied} ${r.url}`); await r.p.close();
  }
  // platform owner: everything
  for (const route of ["/dashboard/command", "/dashboard/pool", "/freelancer", "/investor"]) {
    const r = await probe(ctxs.owner, route);
    check("reliability", `platform owner can open ${route}`, !r.denied && r.url === route, `${r.denied} ${r.url}`); await r.p.close();
  }
  // anonymous visitors still go to login, not to an access-denied page
  const anon = await newCtx(); const ap = await newPage(anon);
  await ap.goto("/dashboard/pool", { waitUntil: "networkidle" }); await ap.waitForTimeout(600);
  check("reliability", "an anonymous visitor to an agency URL is sent to login", /\/login/.test(ap.url()) && !(await ap.getByTestId("access-denied").count()), ap.url());
  await anon.close();
});


// ====================================================================== TEST 7 — PRODUCTION-READINESS HARDENING
await guard("hardening", "legal draft notices, disabled image optimizer, security headers", async () => {
  const anon = await newCtx(); const p = await newPage(anon);
  for (const path of ["/legal/terms", "/legal/privacy", "/legal/ai-disclosure"]) {
    await p.goto(path, { waitUntil: "networkidle" });
    const t = await text(p);
    check("hardening", `${path} carries the 'draft, not reviewed by a lawyer' notice and no placeholder text`, (await p.getByTestId("legal-draft-notice").isVisible()) && /not yet been reviewed by a lawyer/i.test(t) && !/placeholder/i.test(t), t.slice(0, 160));
  }
  await p.goto("/legal/terms", { waitUntil: "networkidle" });
  const terms = await text(p);
  check("hardening", "the Terms still state plainly that Autopilot is not an escrow agent and simulated figures are not real money", /not a bank, a trustee\s+or an escrow agent/i.test(terms) && /simulated are illustrations only/i.test(terms), terms.slice(300, 420));
  const img = await anon.request.fetch(`${BASE}/_next/image?url=${encodeURIComponent("https://images.unsplash.com/x.jpg")}&w=64&q=75`);
  check("hardening", "the Next.js image optimizer endpoint is disabled (404)", img.status() === 404, img.status());
  const page = await anon.request.fetch(`${BASE}/login`);
  const h = (n) => page.headers()[n] || "";
  check("hardening", "HSTS, CSP frame-ancestors none, nosniff and no X-Powered-By on pages", /max-age=\d{8,}/.test(h("strict-transport-security")) && /frame-ancestors 'none'/.test(h("content-security-policy")) && h("x-content-type-options") === "nosniff" && !h("x-powered-by"));
  await anon.close();
});

// ====================================================================== TEST 8 — DATA RIGHTS, TERMS, RESTRICTED MODULES
const dana = { first: "Dana", last: `Data${RUN}`, email: unique("dana") };
let danaCtx;
await guard("datarights", "terms recorded at signup; export download; deletion scheduled, locked, cancelled", async () => {
  danaCtx = await newCtx();
  const page = await signupUI(danaCtx, "freelancer", dana);
  await page.waitForTimeout(1000);
  const terms = await api(danaCtx, "GET", "/api/me/terms");
  check("datarights", "signing up through the UI recorded the Terms/Privacy acceptance on the server (version, time, method)",
    terms.status === 200 && terms.body.history.length === 1 && terms.body.history[0].method === "signup" && /^draft-/.test(terms.body.history[0].terms) && !terms.body.needsAcceptance, JSON.stringify(terms.body).slice(0, 200));

  // Export: needs the password, downloads a JSON file with only this account's data, no secrets.
  await page.goto("/freelancer/your-data", { waitUntil: "networkidle" });
  check("datarights", "the Your data page shows the export and delete sections", (await page.getByTestId("export-button").count()) === 1 && (await page.getByTestId("deletion-preview").count()) === 1, (await text(page)).slice(0, 100));
  check("datarights", "export is disabled until the password is typed", await page.getByTestId("export-button").isDisabled());
  await page.fill("#export-pw", PW);
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByTestId("export-button").click()]);
  const filePath = await download.path();
  const exported = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(exported);
  check("datarights", "the export is a JSON file for this account, with no password hash or token", data.format === "autopilot-export-1" && data.account.email === dana.email.toLowerCase() && !/password_hash|\$argon2|key_hash|token_hash/.test(exported), Object.keys(data.records).join(","));
  check("datarights", "the export contains none of another test user's email", !exported.includes(ann.email) && !exported.includes(agency?.email ?? "@@none@@"));
  const wrong = await api(danaCtx, "POST", "/api/me/export", { password: "not-the-password" });
  check("datarights", "export with a wrong password is refused (403)", wrong.status === 403, wrong.status);

  // Deletion: preview, typed confirmation, scheduled, locked, cancel.
  await page.getByTestId("deletion-preview").click();
  await page.getByTestId("deletion-plan").waitFor({ timeout: 15000 });
  const plan = await text(page);
  check("datarights", "the deletion preview lists what is deleted", /Deleted/.test(plan) && /Your account: 1/.test(plan), plan.slice(0, 300));
  check("datarights", "the delete button stays disabled until the exact phrase and password are entered", await page.getByTestId("deletion-submit").isDisabled());
  await page.fill("#del-pw", PW); await page.fill("#del-confirm", "delete my account");
  check("datarights", "a wrong-case confirmation phrase does not enable it", await page.getByTestId("deletion-submit").isDisabled());
  await page.fill("#del-confirm", "DELETE MY ACCOUNT");
  await page.getByTestId("deletion-submit").click();
  await page.getByTestId("deletion-scheduled").waitFor({ timeout: 15000 });
  check("datarights", "scheduling shows the date and that the user is signed out", /scheduled/i.test(await text(page)) && /signed out/.test(await text(page)));
  const afterSession = await api(danaCtx, "GET", "/api/auth/me");
  check("datarights", "the old session no longer works (401)", afterSession.status === 401, afterSession.status);

  // Sign in during the grace period: only the cancel screen is available.
  const again = await newCtx(); const p2 = await loginUI(again, "Freelancer", dana.email);
  await p2.getByTestId("deletion-pending").waitFor({ timeout: 20000 });
  check("datarights", "signing in during the grace period shows the 'scheduled for deletion' screen instead of the app", (await p2.getByTestId("deletion-pending").count()) === 1 && !(await text(p2)).includes("Open Specs"), (await text(p2)).slice(0, 150));
  const locked = await api(again, "GET", "/api/settings");
  check("datarights", "the locked account is refused by the API (403)", locked.status === 403, locked.status);
  await p2.getByRole("button", { name: "Cancel deletion" }).click();
  await p2.waitForTimeout(1500);
  const restored = await api(again, "GET", "/api/me/deletion");
  check("datarights", "cancelling restores the account", restored.status === 200 && restored.body.status === "none", JSON.stringify(restored.body));
  await p2.reload({ waitUntil: "networkidle" });
  check("datarights", "after cancelling the normal app is back", !(await p2.getByTestId("deletion-pending").count()), (await text(p2)).slice(0, 100));
  await again.close();
});

await guard("datarights", "Terms gate and restricted simulated modules (server flags simulated through /auth/me)", async () => {
  const ctx = await newCtx(); const pg = await loginUI(ctx, "Freelancer", dana.email);
  await pg.waitForTimeout(800);
  // Pretend the server says the Terms changed and that this account has no simulated-module access.
  let termsChanged = true;
  await ctx.route("**/api/auth/me", async (route) => {
    const res = await route.fetch(); const body = await res.json();
    body.user = { ...body.user, needsTermsAcceptance: termsChanged, modules: { simulated: false } };
    await route.fulfill({ response: res, json: body });
  });
  await pg.goto("/freelancer", { waitUntil: "networkidle" });
  await pg.getByTestId("terms-gate").waitFor({ timeout: 15000 });
  check("datarights", "when the Terms changed the app is replaced by the accept screen", (await pg.getByTestId("terms-gate").count()) === 1 && /draft-/.test(await text(pg)), (await text(pg)).slice(0, 150));
  check("datarights", "the accept button is disabled until the box is ticked", await pg.getByRole("button", { name: "Accept and continue" }).isDisabled());
  await pg.getByRole("checkbox").check();
  await pg.getByRole("button", { name: "Accept and continue" }).click();
  await pg.waitForTimeout(1500);
  const hist = await api(ctx, "GET", "/api/me/terms");
  termsChanged = false;                                 // the server would now report the Terms as accepted
  check("datarights", "accepting adds a second server-side record (reaccept) and keeps the first", hist.body.history.length === 2 && hist.body.history[0].method === "reaccept" && hist.body.history[1].method === "signup", JSON.stringify(hist.body.history));
  check("datarights", "after accepting the app is shown", !(await pg.getByTestId("terms-gate").count()));
  await pg.goto("/investor/marketplace", { waitUntil: "networkidle" }).catch(() => {});
  await pg.waitForTimeout(800);
  const restricted = (await pg.getByTestId("simulated-restricted").count()) === 1 || (await pg.getByTestId("access-denied").count()) === 1;
  check("datarights", "a simulated module URL shows an explanation, not the module, when the account has no access", restricted, (await text(pg)).slice(0, 150));
  await ctx.close();
});
await danaCtx?.close();

// ====================================================================== TEST 9 — PROFILE, EMAIL CHANGE, AI DISCLOSURE, SIMULATED BANNER
const eli = { first: "Eli", last: `Edit${RUN}`, email: unique("eli") };
const eliNew = unique("eli-new");
await guard("profile", "name correction and a verified email change through the UI", async () => {
  const ctx = await newCtx();
  const page = await signupUI(ctx, "freelancer", eli);
  const second = await newCtx(); await loginUI(second, "Freelancer", eli.email);           // another device, signed in
  await page.goto("/freelancer/your-data", { waitUntil: "networkidle" });
  await page.fill("#profile-name", "Eliza Corrected"); await page.getByTestId("name-save").click();
  await page.getByTestId("name-message").waitFor({ timeout: 10000 });
  const me1 = await api(ctx, "GET", "/api/auth/me");
  check("profile", "the corrected name is saved and shown", me1.body?.user?.name === "Eliza Corrected" && /updated/i.test(await page.getByTestId("name-message").innerText()), JSON.stringify(me1.body?.user?.name));

  await page.fill("#new-email", eliNew); await page.fill("#email-pw", PW); await page.getByTestId("email-request").click();
  await page.getByTestId("email-devcode").waitFor({ timeout: 15000 });
  const still = await api(ctx, "GET", "/api/auth/me");
  check("profile", "asking for a new address does not change the account until the code is entered", still.body?.user?.email === eli.email.toLowerCase(), JSON.stringify(still.body?.user?.email));
  await page.fill("#email-code", "000000"); await page.getByTestId("email-confirm").click();
  await page.waitForTimeout(1200);
  check("profile", "a wrong code is refused with a message", /isn.t right/i.test(await page.getByTestId("email-message").innerText()), await page.getByTestId("email-message").innerText());
  const code = (await page.getByTestId("email-devcode").innerText()).match(/\d{6}/)?.[0];
  await page.fill("#email-code", code); await page.getByTestId("email-confirm").click();
  await page.waitForFunction(() => /Email changed/.test(document.querySelector("[data-testid=email-message]")?.textContent || ""), null, { timeout: 15000 });
  const me2 = await api(ctx, "GET", "/api/auth/me");
  check("profile", "after the code the account uses the new address and this browser stays signed in", me2.body?.user?.email === eliNew.toLowerCase(), JSON.stringify(me2.body?.user?.email));
  const other = await api(second, "GET", "/api/auth/me");
  check("profile", "the other device was signed out by the change (401)", other.status === 401, other.status);
  const oldLogin = await rawApi("POST", "/api/auth/login", { email: eli.email, password: PW });
  const newLogin = await rawApi("POST", "/api/auth/login", { email: eliNew, password: PW });
  check("profile", "the old address no longer signs in; the new one does", oldLogin.status === 401 && newLogin.status === 200, `${oldLogin.status}/${newLogin.status}`);
  await ctx.close(); await second.close();
});

await guard("disclosure", "AI disclosure wording: editable, cannot be made untrue; simulated banner on demo modules", async () => {
  const pg = await newPage(ctxs.agency);
  await pg.goto("/dashboard/settings", { waitUntil: "networkidle" });
  await pg.waitForSelector("#ai-disclosure", { timeout: 15000 });
  await pg.fill("#ai-disclosure", "Written by me personally"); await pg.getByTestId("disclosure-save").click();
  await pg.waitForTimeout(1200);
  check("disclosure", "a wording that does not mention AI is refused", /must say/i.test(await text(pg)), (await text(pg)).slice(0, 100));
  await pg.fill("#ai-disclosure", "Drafted with AI help and reviewed by our team."); await pg.getByTestId("disclosure-save").click();
  await pg.waitForTimeout(1200);
  const st = await api(ctxs.agency, "GET", "/api/settings");
  check("disclosure", "a wording that says AI was used is saved", st.body?.aiDisclosure === "Drafted with AI help and reviewed by our team.", JSON.stringify(st.body?.aiDisclosure));
  const off = await api(ctxs.agency, "PATCH", "/api/settings", { aiDisclosure: "" });
  check("disclosure", "the disclosure cannot be switched off (empty is refused, 422)", off.status === 422, off.status);
  await pg.close();
  const ip = await newPage(ctxs.investor);
  await ip.goto("/investor/marketplace", { waitUntil: "networkidle" }); await ip.waitForTimeout(800);
  const banner = await ip.getByTestId("simulated-banner").innerText().catch(() => "");
  check("disclosure", "simulated modules show the 'not a financial service, no escrow, no real money' banner", /Simulated demonstration/.test(banner) && /no real money moves/.test(banner), banner.slice(0, 120));
  await ip.close();
});

// ====================================================================== AUTOGIG CREDIT PROTOTYPE (simulated)
await guard("credit", "contribution, application, offer, acceptance, repayment, treasury (UI end to end)", async () => {
  const idOf = async (ctx) => (await api(ctx, "GET", "/api/auth/me")).body?.user?.id;
  const verify = async (ctx, roles) => {
    await api(ctx, "POST", "/api/capital/verification", { legalName: "Qa Person", country: "US", roles });
    return api(ctxs.owner, "POST", `/api/capital/admin/verifications/${await idOf(ctx)}`, { approve: true });
  };
  check("credit", "(setup) the freelancer's simulated identity is approved by the owner", (await verify(ctxs.ann, ["freelancer"])).status === 200);

  // investor: wallet discovery with two announced wallets, then a demo contribution
  const ip = await newPage(ctxs.investor);
  await ip.addInitScript(() => {
    window.__walletCalls = [];
    const mk = (uuid, name, address) => ({ info: { uuid, name, icon: "data:image/svg+xml;base64,PHN2Zy8+", rdns: "test." + uuid }, provider: { request: async ({ method }) => { window.__walletCalls.push(method); return method === "eth_requestAccounts" ? [address] : method === "eth_chainId" ? "0x2105" : null; } } });
    const wallets = [mk("w-1", "Alpha Wallet", "0x1111111111111111111111111111111111111111"), mk("w-2", "Beta Wallet", "0x2222222222222222222222222222222222222222")];
    window.addEventListener("eip6963:requestProvider", () => wallets.forEach((w) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze(w) }))));
  });
  await ip.goto("/investor/credit", { waitUntil: "networkidle" }); await ip.waitForTimeout(1200);
  const body0 = await text(ip);
  check("credit", "investor page states it is a simulation and that the AutoGig token is not issued", /AutoGig credit is a simulation/.test(body0) && /not issued/i.test(body0), body0.slice(0, 160));
  check("credit", "both announced wallets are offered (EIP-6963), read-only", (await ip.locator("#wallet-pick option").allInnerTexts()).join(",") === "Alpha Wallet,Beta Wallet");
  await ip.selectOption("#wallet-pick", "w-2"); await ip.getByRole("button", { name: /Connect Beta Wallet/ }).click(); await ip.waitForTimeout(500);
  const addr = await ip.getByTestId("wallet-address").innerText().catch(() => "");
  check("credit", "connecting shows the shortened address and the network name", /0x2222…2222/.test(addr) && /Base/.test(addr), addr);
  const calls = await ip.evaluate(() => window.__walletCalls);
  check("credit", "the wallet was only ever asked for accounts and chain id: no signature, transaction, key or seed request", calls.length > 0 && calls.every((m) => m === "eth_requestAccounts" || m === "eth_chainId"), JSON.stringify(calls));
  check("credit", "the page has no input that asks for a seed phrase or private key", (await ip.locator("input,textarea").evaluateAll((els) => els.map((e) => (e.name + e.id + (e.placeholder || "")).toLowerCase()))).every((t) => !/seed|mnemonic|private|recovery/.test(t)));
  await ip.screenshot({ path: `${SHOTS}/credit-investor-desktop.png`, fullPage: true });
  check("credit", "every figure card on the investor page carries a 'Demo' tag", (await ip.getByText("Demo", { exact: true }).count()) >= 6, String(await ip.getByText("Demo", { exact: true }).count()));
  await ip.fill("#contrib-amount", "5"); await ip.waitForTimeout(200);
  check("credit", "an amount below the minimum shows an error and keeps the button disabled", (await text(ip)).includes("Enter an amount between") && await ip.getByRole("button", { name: "Record contribution" }).isDisabled());
  await ip.fill("#contrib-amount", "2,000.00");
  check("credit", "the contribution button stays disabled until the risk statement is ticked", await ip.getByRole("button", { name: "Record contribution" }).isDisabled());
  await ip.getByRole("checkbox").first().click(); await ip.getByRole("button", { name: "Record contribution" }).click(); await ip.waitForTimeout(1500);
  const afterC = await text(ip);
  check("credit", "the demo contribution appears in the pool, the history and the simulated statement", /\$2,000\.00/.test(afterC) && /Demo contribution/.test(afterC) && /Simulated net result/.test(afterC), afterC.slice(0, 200));
  await ip.close();

  // freelancer: unverified account sees why it cannot apply; verified one applies through the form
  const bobPage = await newPage(ctxs.bob);
  await bobPage.goto("/freelancer/credit", { waitUntil: "networkidle" }); await bobPage.waitForTimeout(1000);
  check("credit", "an unverified freelancer is told verification is needed and gets no application form", /Identity verification/.test(await text(bobPage)) && !(await bobPage.locator("#credit-title").count()), (await text(bobPage)).slice(0, 160));
  await bobPage.close();
  const ap = await newPage(ctxs.ann);
  await ap.goto("/freelancer/credit", { waitUntil: "networkidle" }); await ap.waitForTimeout(1000);
  await ap.fill("#credit-title", "Website for a local bakery");
  await ap.fill("#credit-desc", "Fixed-price site with ordering. I need licences and stock photos before the client pays.");
  await ap.fill("#credit-amount", "12"); await ap.waitForTimeout(200);
  check("credit", "an out-of-range amount is flagged and blocks sending", (await text(ap)).includes("Enter an amount between") && await ap.getByRole("button", { name: "Send application" }).isDisabled());
  await ap.fill("#credit-amount", "1000");
  await ap.setInputFiles("#credit-files", [{ name: "page.html", mimeType: "text/html", buffer: Buffer.from("<script>alert(1)</script>") }]); await ap.waitForTimeout(200);
  check("credit", "an HTML file is refused in the browser before sending", (await text(ap)).includes("use a PDF, PNG or JPEG") && await ap.getByRole("button", { name: "Send application" }).isDisabled());
  await ap.setInputFiles("#credit-files", [{ name: "brief.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF") }]); await ap.waitForTimeout(200);
  check("credit", "a PDF is listed with a remove button and enables sending", (await text(ap)).includes("brief.pdf") && await ap.getByRole("button", { name: "Remove brief.pdf" }).count() === 1 && !(await ap.getByRole("button", { name: "Send application" }).isDisabled()));
  await ap.screenshot({ path: `${SHOTS}/credit-apply-desktop.png`, fullPage: true });
  await ap.getByRole("button", { name: "Send application" }).click(); await ap.waitForTimeout(1500);
  check("credit", "the application is listed as 'In review' with its file attached", /Website for a local bakery/.test(await text(ap)) && /In review/.test(await text(ap)) && /1 file attached/.test(await text(ap)), (await text(ap)).slice(0, 200));

  // owner: review and offer
  const supporting = ap.getByLabel("Add supporting file");
  await supporting.setInputFiles({ name: "retry-proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic") });
  await ap.getByRole("link", { name: "retry-proof.pdf" }).waitFor();
  await ap.getByRole("button", { name: "Remove retry-proof.pdf" }).click();
  await ap.getByRole("link", { name: "retry-proof.pdf" }).waitFor({ state: "detached" });
  check("credit", "an applicant can retry and remove a supporting document while the application is in review", true);

  const op = await newPage(ctxs.owner);
  await op.goto("/dashboard/credit/admin", { waitUntil: "networkidle" }); await op.waitForTimeout(1200);
  check("credit", "the treasury shows the contribution and a balanced ledger check", /\$2,000\.00/.test(await text(op)) && /Balanced/.test(await text(op)), (await text(op)).slice(0, 200));
  await op.getByRole("button", { name: "Review" }).first().click(); await op.waitForTimeout(500);
  check("credit", "the review dialog shows the application text, the private document and the applicant's verification", /ordering/.test(await text(op)) && /brief\.pdf \(PDF/.test(await text(op)) && /Verification: verified/.test(await text(op)));
  await op.screenshot({ path: `${SHOTS}/credit-review-desktop.png` });
  const docHref = await op.getByRole("link", { name: "Download" }).first().getAttribute("href");
  const dl = await ctxs.owner.request.get(`${BASE}${docHref}`);
  check("credit", "the owner downloads the file as an attachment with the right type; an anonymous request is refused", dl.status() === 200 && /attachment/.test(dl.headers()["content-disposition"] ?? "") && dl.headers()["content-type"] === "application/pdf" && (await rawApi("GET", docHref.replace(/^.*?\/api/, "/api"))).status === 401, `${dl.status()} ${dl.headers()["content-disposition"]}`);
  check("credit", "another freelancer cannot download it", (await ctxs.bob.request.get(`${BASE}${docHref}`)).status() === 404);
  await op.fill("#rv-amount", "1000"); await op.fill("#rv-fee", "10");
  await op.getByRole("button", { name: "Send offer" }).click(); await op.waitForTimeout(1500);
  check("credit", "the offer is sent and the $1,000 is shown as committed", /Offer ready/.test(await text(op)) && /\$1,000\.00 committed/.test(await text(op)), (await text(op)).slice(0, 220));

  // freelancer: accept, repay, schedule
  await ap.reload({ waitUntil: "networkidle" }); await ap.waitForTimeout(1000);
  await ap.getByRole("button", { name: "View offer" }).click(); await ap.waitForTimeout(400);
  const offerText = await text(ap);
  check("credit", "the offer states a flat fee, the total to repay and that nothing is really lent", /Flat fee \(10%\)/.test(offerText) && /\$1,100\.00/.test(offerText) && /nothing is lent/.test(offerText));
  check("credit", "accepting is disabled until the terms checkbox is ticked", await ap.getByRole("button", { name: "Accept offer" }).isDisabled());
  await ap.getByRole("checkbox").last().click(); await ap.getByRole("button", { name: "Accept offer" }).click(); await ap.waitForTimeout(1500);
  check("credit", "the agreement shows a 3-line repayment schedule that adds up to $1,100.00", (await ap.locator("table tbody tr").count()) === 3 && /still owed \$1,100\.00/.test(await text(ap)), (await text(ap)).slice(0, 200));
  await ap.getByRole("button", { name: "Record repayment" }).first().click(); await ap.waitForTimeout(300);
  await ap.fill("#credit-repay", "400"); await ap.getByRole("button", { name: "Record repayment" }).last().click(); await ap.waitForTimeout(1500);
  check("credit", "a partial repayment lowers what is still owed to $700.00", /still owed \$700\.00/.test(await text(ap)), (await text(ap)).slice(0, 200));
  await ap.screenshot({ path: `${SHOTS}/credit-borrower-desktop.png`, fullPage: true });
  await ap.close();

  // isolation: another freelancer cannot see or repay it; the investor cannot use the owner area
  const aid = (await api(ctxs.ann, "GET", "/api/credit/agreements")).body?.[0]?.id;
  check("credit", "another freelancer sees no agreement and cannot repay it", (await api(ctxs.bob, "GET", "/api/credit/agreements")).body?.length === 0 && (await api(ctxs.bob, "POST", `/api/credit/agreements/${aid}/repay`, { amountCents: 100, idempotencyKey: "abcdefgh12345" })).status === 404);
  check("credit", "the owner-only treasury API refuses the investor and the freelancer", (await api(ctxs.investor, "GET", "/api/credit/admin/treasury")).status === 403 && (await api(ctxs.ann, "GET", "/api/credit/admin/audit")).status === 403);
  const t = (await api(ctxs.owner, "GET", "/api/credit/admin/treasury")).body;
  check("credit", "treasury arithmetic: cash $1,400 = 2,000 - 1,000 + 400; the $400 repaid fee-first (3,334 + 3,332 fees, 33,334 principal) leaves $666.66 outstanding; ledger check true", t?.cashCents === 140000 && t?.feesCents === 6666 && t?.outstandingCents === 66666 && t?.ledgerCheck === true, JSON.stringify(t));
  // responsive: no horizontal scroll on a phone
  const mctx = await newCtx({ width: 390, height: 780 });
  await mctx.addCookies(await ctxs.investor.cookies());
  const mp = await newPage(mctx); await mp.goto(`${BASE}/investor/credit`, { waitUntil: "networkidle" }); await mp.waitForTimeout(1200);
  await mp.screenshot({ path: `${SHOTS}/credit-investor-mobile.png`, fullPage: true });
  const mp2 = await newPage(await (async () => { const c = await newCtx({ width: 390, height: 780 }); await c.addCookies(await ctxs.ann.cookies()); return c; })());
  await mp2.goto(`${BASE}/freelancer/credit`, { waitUntil: "networkidle" }); await mp2.waitForTimeout(1000);
  await mp2.screenshot({ path: `${SHOTS}/credit-borrower-mobile.png`, fullPage: true });
  check("credit", "the freelancer credit page has no horizontal page scroll on a 390px phone", await mp2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await mp2.evaluate(() => document.documentElement.scrollWidth));
  const mop = await newPage(await (async () => { const c = await newCtx({ width: 390, height: 780 }); await c.addCookies(await ctxs.owner.cookies()); return c; })());
  await mop.goto(`${BASE}/dashboard/credit/admin`, { waitUntil: "networkidle" }); await mop.waitForTimeout(1200);
  await mop.screenshot({ path: `${SHOTS}/credit-admin-mobile.png`, fullPage: true });
  check("credit", "the owner treasury page has no horizontal page scroll on a 390px phone", await mop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await mop.evaluate(() => document.documentElement.scrollWidth));
  const lp = await newPage(await newCtx());
  await lp.goto("/", { waitUntil: "networkidle" }); await lp.waitForTimeout(800);
  const landing = await text(lp);
  check("credit", "the public landing page no longer promises payment ('You still get paid') or says orders are 'insured'", !/You still get paid|Insure every|insured for up to/i.test(landing) && /Simulated/.test(landing), landing.match(/You still get paid|Insure every|insured for up to/i)?.[0] ?? "");
  const tablet = await newCtx({ width: 768, height: 1024 });
  await tablet.addCookies(await ctxs.investor.cookies());
  const tabletPage = await newPage(tablet);
  await tabletPage.route("**/api/credit/statement", (route) => route.fulfill({ status: 503, json: {} }));
  await tabletPage.goto("/investor/credit");
  await tabletPage.getByRole("alert").filter({ hasText: "Credit data could not be loaded" }).waitFor();
  await tabletPage.unroute("**/api/credit/statement");
  await tabletPage.getByRole("button", { name: "Retry" }).click();
  await tabletPage.getByRole("heading", { name: "Simulated statement" }).waitFor();
  check("credit", "tablet view recovers from a partial API outage and fits the viewport",
    await tabletPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await tablet.close();
  check("credit", "the investor page has no horizontal page scroll on a 390px phone", await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await mp.evaluate(() => document.documentElement.scrollWidth));
  await mctx.close();
});

// ---------------------------------------------------------------- console / network summary
const summary = {};
for (const [k, c] of Object.entries({ ann: ctxs.ann, agency: ctxs.agency, bob: ctxs.bob, uma: uwCtx, owner: ctxs.owner, investor: ctxs.investor, agency2: ctxs.agency2 })) {
  if (c) summary[k] = { consoleErrors: [...new Set(c.errors)].slice(0, 12), badResponses: [...new Set(c.bad)].slice(0, 20) };
}
fs.writeFileSync(OUT, JSON.stringify({ run: RUN, results, summary, upworkRequests }, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${failed.length} failed`);
await browser.close();
process.exitCode = failed.length ? 1 : 0;
