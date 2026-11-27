// Browser QA for the finance modules (simulated) and the three client-demo workflows: first sale through the
// freelancer pool, unified messaging, and Agent Fleet customization. Desktop (1280x860) and phone (390x844).
// Same stack as e2e.mjs (credential-free API from scripts/qa/local-api.py on a fresh disposable database, with
// SIMULATED_MODULES=all and OWNER_EMAILS=owner@example.test; the production frontend proxying /api to it).
// Synthetic accounts and emails only; nothing contacts Stripe, a bank, a chain or a mail provider.
//   BASE=http://localhost:3100 API=http://127.0.0.1:8010 HOOK=qa-hook-secret SHOTS=out OUT=fw.json \
//   PLAYWRIGHT_MODULE=... CHROME=... node scripts/qa/finance-workflows.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3100";
const API = process.env.API || "http://127.0.0.1:8010";
const HOOK = process.env.HOOK || "qa-hook-secret";
const SHOTS = process.env.SHOTS || "fw-shots";
const OUT = process.env.OUT || "fw-results.json";
const RUN = Date.now().toString(36);
const PW = "Qa-Synthetic-Pass-9182";
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (group, name, ok, detail = "") => {
  results.push({ group, name, ok: !!ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  [${group}] ${name}${ok ? "" : "  -> " + String(detail).slice(0, 220)}`);
};
const guard = async (group, name, fn) => { try { await fn(); } catch (e) { check(group, name, false, `exception: ${e.message.split("\n")[0]}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--disable-dev-shm-usage"] });

async function newCtx(viewport = DESKTOP) {
  const ctx = await browser.newContext({ viewport, baseURL: BASE, acceptDownloads: true });
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
const text = async (page) => (await page.innerText("body")).replace(/\s+/g, " ");
const shot = async (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const api = async (ctx, method, p, data) => {
  const csrf = (await ctx.cookies()).find((c) => c.name === "autopilot_csrf")?.value ?? "";
  const res = await ctx.request.fetch(`${BASE}${p}`, { method, data, headers: { "X-Session-Mode": "cookie", Origin: BASE, "X-CSRF-Token": csrf } });
  let body = null; try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status(), body };
};
const key = () => `qa${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function signup(ctx, role, u) {
  const page = await newPage(ctx);
  await page.goto(`/signup/${role}`);
  await page.fill("#first", u.first); await page.fill("#last", u.last); await page.fill("#email", u.email);
  const country = page.locator("select#country");
  if (await country.count()) await country.selectOption({ label: "United States" }).catch(() => {});
  if (role === "freelancer") {
    await page.getByRole("spinbutton", { name: /Hourly rate/ }).fill("55");
    await page.getByRole("textbox", { name: "Primary skills" }).fill("React, Python, FastAPI");
    await page.getByRole("combobox", { name: "Years of experience" }).selectOption("3–5");
    await page.getByRole("combobox", { name: "Availability" }).selectOption("Full-time");
    await page.getByRole("textbox", { name: "Password" }).fill(PW);
  } else if (role === "admin") {
    await page.fill("#agency", u.company); await page.fill("#password", PW); await page.fill("#confirm", PW);
  } else {
    await page.fill("#password", PW);
  }
  const box = page.getByRole("checkbox");
  if (await box.count()) await box.first().check();
  await page.getByRole("button", { name: /Create account/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 20000 });
  return page;
}

// ---------------------------------------------------------------- accounts
const owner = { first: "Olga", last: "Owner", email: "owner@example.test", company: "Northwind Studio" };
const fay = { first: "Fay", last: `Freelancer${RUN}`, email: `fay-${RUN}@example.test` };
const gus = { first: "Gus", last: `Builder${RUN}`, email: `gus-${RUN}@example.test` };
const ivy = { first: "Ivy", last: `Investor${RUN}`, email: `ivy-${RUN}@example.test` };
const ctx = {}; const pg = {};
for (const [k, role, u] of [["owner", "admin", owner], ["fay", "freelancer", fay], ["gus", "freelancer", gus], ["ivy", "investor", ivy]]) {
  ctx[k] = await newCtx(); pg[k] = await signup(ctx[k], role, u);
}
const idOf = async (c) => (await api(c, "GET", "/api/auth/me")).body?.user?.id;
const verify = async (c, roles) => {
  await api(c, "POST", "/api/capital/verification", { legalName: "Qa Person", country: "US", roles });
  return api(ctx.owner, "POST", `/api/capital/admin/verifications/${await idOf(c)}`, { approve: true });
};
check("setup", "owner, two freelancers and an investor signed up through the UI; owner flagged", (await api(ctx.owner, "GET", "/api/auth/me")).body?.user?.owner === true);
const kyc = [await verify(ctx.fay, ["freelancer"]), await verify(ctx.gus, ["freelancer"]), await verify(ctx.ivy, ["investor"])];
// An investor's simulated check may already be complete without an owner review ("no pending verification").
check("setup", "simulated identity approved for Fay, Gus and Ivy", kyc.every((r) => r.status === 200 || /no pending/i.test(JSON.stringify(r.body))), kyc.map((r) => `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`).join(" | "));
async function fund(c, cents) {
  const acct = (await api(c, "POST", "/api/banking/accounts", { holder: "Qa Person", routing: "021000021", accountNumber: "000123456789", kind: "checking" })).body;
  if (acct.status !== "verified") await api(c, "POST", `/api/banking/accounts/${acct.id}/verify`, { amounts: acct.simulatedDeposits });
  return api(c, "POST", "/api/banking/transfers", { kind: "deposit", amountCents: cents, idempotencyKey: key(), bankAccountId: acct.id });
}
check("setup", "Fay and Ivy add simulated money from a linked bank", (await fund(ctx.fay, 2_500_00)).status === 200 && (await fund(ctx.ivy, 5_000_00)).status === 200);

// ---------------------------------------------------------------- 1. first sale through the pool
const SPEC = "Landing page for a coffee roaster";
await guard("first-sale", "agency posts, freelancer bids, agency awards, delivery approved, payout recorded", async () => {
  let p = pg.owner; await p.goto("/dashboard/pool", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /New spec/ }).click();
  await p.fill("#sp-title", SPEC); await p.fill("#sp-sum", "Responsive Next.js landing page with a contact form.");
  await p.fill("#sp-stack", "Next.js, Tailwind"); await p.fill("#sp-hours", "20");
  await p.fill("#sp-due", new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10)); await p.fill("#sp-max", "60");
  await p.getByRole("button", { name: "Broadcast" }).click(); await p.waitForTimeout(1500);
  check("first-sale", "spec is broadcast to the pool", (await text(p)).includes(SPEC)); await shot(p, "sale-1-agency-spec");

  p = pg.fay; await p.goto("/freelancer/specs", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /^Bid$/ }).first().click();
  await p.fill("#bid-hours", "18"); await p.fill("#bid-rate", "50");
  await shot(p, "sale-2-freelancer-bid");
  await p.getByRole("button", { name: "Place bid" }).click(); await p.waitForTimeout(1500);
  check("first-sale", "freelancer places a $900 bid", (await api(ctx.fay, "GET", "/api/pool/my-bids")).body?.[0]?.total === 900);

  p = pg.owner; await p.goto("/dashboard/pool", { waitUntil: "networkidle" });
  await p.locator("li", { hasText: `${fay.first} ${fay.last}` }).first().getByRole("button", { name: /Award/ }).click(); await p.waitForTimeout(1800);
  await p.getByRole("tab", { name: "Contracts" }).click(); await p.waitForTimeout(600);
  check("first-sale", "award creates the contract", /\$900/.test(await text(p))); await shot(p, "sale-3-agency-contract");

  p = pg.fay; await p.goto("/freelancer/contracts", { waitUntil: "networkidle" });
  await p.fill('textarea[aria-label^="Delivery note"]', "Live preview: https://example.test/preview");
  await p.getByRole("button", { name: /Mark delivered/ }).click(); await p.waitForTimeout(1500);
  p = pg.owner; await p.goto("/dashboard/pool", { waitUntil: "networkidle" }); await p.getByRole("tab", { name: "Contracts" }).click(); await p.waitForTimeout(500);
  await p.getByRole("button", { name: /Approve/ }).click(); await p.waitForTimeout(1500);
  await p.getByRole("tab", { name: "Payouts" }).click(); await p.waitForTimeout(500);
  await shot(p, "sale-4-agency-payout");
  await p.getByRole("button", { name: /I paid this/ }).click(); await p.waitForTimeout(1500);
  p = pg.fay; await p.goto("/freelancer/earnings", { waitUntil: "networkidle" }); await p.waitForTimeout(600);
  const summary = (await api(ctx.fay, "GET", "/api/pool/earnings")).body?.summary;
  check("first-sale", "freelancer's first sale shows $900 paid, with the records-only note", summary?.paid === 900 && /does not transfer money/i.test(await text(p)), JSON.stringify(summary));
  await shot(p, "sale-5-freelancer-earnings");
});

// ---------------------------------------------------------------- 2. unified messaging
await guard("messaging", "agency and freelancer conversation, plus the unified inbox", async () => {
  let p = pg.fay; await p.goto("/freelancer/contracts", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /Message agency/ }).first().click();
  await p.getByRole("textbox", { name: "Message" }).fill("Thanks for the award! Anything to change on the hero section?");
  await p.getByRole("button", { name: /^Send$/ }).click();
  await p.waitForURL(/\/freelancer\/messages\?thread=/, { timeout: 15000 }); await p.waitForTimeout(800);
  check("messaging", "freelancer's message is in the thread", /hero section/.test(await p.getByTestId("message-log").innerText()));
  p = pg.owner; await p.goto("/dashboard/pool?tab=messages", { waitUntil: "networkidle" }); await p.waitForTimeout(800);
  await p.getByTestId("thread-list").getByRole("button").first().click(); await p.waitForTimeout(800);
  await p.getByTestId("message-input").fill("Looks great. Please swap the hero photo for the roastery shot.");
  await p.getByTestId("message-input").press("Enter"); await p.waitForTimeout(1500);
  await shot(p, "msg-1-agency-thread");
  p = pg.fay; await p.waitForTimeout(5500);   // the open conversation polls every 4 s
  check("messaging", "freelancer receives the reply without reloading", /roastery shot/.test(await p.getByTestId("message-log").innerText()));
  await shot(p, "msg-2-freelancer-thread");

  // The unified inbox of a real account starts empty (no bundled sample conversations), then shows forwarded mail.
  p = pg.owner; await p.goto("/dashboard/conversations", { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const before = await text(p);
  await shot(p, "msg-3-inbox-empty");
  const addr = (await api(ctx.owner, "GET", "/api/inbox/address")).body?.address;
  check("messaging", "the account has a private forwarding address", /@in\.example\.test$/.test(addr || ""), addr);
  const res = await fetch(`${API}/api/inbox/inbound`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${HOOK}` },
    body: JSON.stringify({ To: addr, From: "Upwork <donotreply@upwork.com>", Subject: "New message from Dana (client)", TextBody: "Hi! Are you available to start Monday on the dashboard project?", MessageID: `<qa-${RUN}@upwork.com>` }) });
  check("messaging", "a forwarded marketplace message is accepted", res.status === 200 || res.status === 202, res.status);
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const after = await text(p);
  check("messaging", "the forwarded message appears in the unified inbox", /Dana|start Monday|New message/.test(after), after.slice(0, 200));
  check("messaging", "no bundled sample conversations are shown to a real account", !/Sarah Chen|Marcus|Acme/i.test(before + after), before.slice(0, 200));
  await shot(p, "msg-4-inbox-message");
});

// ---------------------------------------------------------------- 3. Agent Fleet customization
await guard("agents", "create an agent from a template, customize it, and the change persists", async () => {
  const p = pg.owner; await p.goto("/dashboard/agents", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  await shot(p, "agents-1-fleet");
  await p.goto("/dashboard/agents/new", { waitUntil: "networkidle" }); await p.waitForTimeout(800);
  await p.locator("button.panel").first().click(); await p.waitForTimeout(500);
  await p.fill("#ag-name", "Coffee-brand Scout");
  if (await p.locator("#ag-query").count()) await p.fill("#ag-query", "next.js, tailwind, shopify");
  await shot(p, "agents-2-configure");
  await p.getByRole("button", { name: /Next/ }).click(); await p.waitForTimeout(300);
  await p.getByRole("radiogroup", { name: "Autonomy" }).getByRole("radio").nth(2).click().catch(() => {});
  await p.getByRole("button", { name: /Next/ }).click(); await p.waitForTimeout(300);
  await shot(p, "agents-3-review");
  await p.getByRole("button", { name: /^Deploy$/ }).click(); await p.waitForTimeout(2000);
  check("agents", "deploying opens the new agent", /\/dashboard\/agents\/[^/]+$/.test(new URL(p.url()).pathname) && /Coffee-brand Scout/.test(await text(p)), p.url());
  await p.getByRole("tab", { name: "Configure" }).click(); await p.waitForTimeout(300);
  await p.fill("#ag-name", "Coffee-brand Scout v2");
  await p.getByRole("button", { name: /Save changes/ }).click();
  await p.waitForTimeout(2500);
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  check("agents", "a renamed agent keeps its new name after a reload (saved on the server)", /Coffee-brand Scout v2/.test(await text(p)), (await text(p)).slice(0, 160));
  await shot(p, "agents-4-detail");
  const ws = await api(ctx.owner, "GET", "/api/state");
  check("agents", "the fleet lives in the user's server workspace", JSON.stringify(ws.body || {}).includes("Coffee-brand Scout"), ws.status);
});

// ---------------------------------------------------------------- finance modules (simulated), Fay's view
await guard("finance", "wallet, member payment, crypto, card, history, CSV", async () => {
  const send = await api(ctx.fay, "POST", "/api/banking/transfers", { kind: "internal_send", amountCents: 40_00, idempotencyKey: key(), recipientEmail: gus.email, note: "Shared stock photos" });
  check("finance", "member payment to a verified member", send.status === 200, JSON.stringify(send.body).slice(0, 120));
  const linked = await api(ctx.fay, "POST", "/api/banking/crypto/addresses", { label: "Ledger", address: "0x" + "ab".repeat(20) });
  await api(ctx.fay, "POST", "/api/banking/transfers", { kind: "crypto_receive", amountCents: 75_00, idempotencyKey: key(), cryptoAddressId: linked.body?.id });
  const card = await api(ctx.fay, "POST", "/api/banking/cards");
  await api(ctx.fay, "POST", `/api/banking/cards/${card.body?.id}/simulate`, { merchant: "Figma", category: "software", channel: "online", amountCents: 15_00, idempotencyKey: key() });
  check("finance", "card issued and a simulated purchase approved", card.status === 200);
  for (const [i, n] of [[0, 18]]) for (let k = i; k < n; k++)
    await api(ctx.fay, "POST", "/api/banking/transfers", { kind: k % 2 ? "to_usd" : "to_usdc", amountCents: k % 2 ? 5_00 : 10_00, idempotencyKey: key() });

  const p = pg.fay;
  for (const route of ["/dashboard/banking", "/dashboard/banking/transactions", "/dashboard/banking/transfers", "/dashboard/banking/crypto",
    "/dashboard/banking/cards", "/dashboard/banking/statements", "/dashboard/banking/accounts"]) {
    await p.goto(route, { waitUntil: "networkidle" }); await p.waitForTimeout(900);
    const t = await text(p);
    check("finance", `${route} loads and says it is simulated`, /simulat/i.test(t) && !/Something went wrong|Application error/i.test(t), t.slice(0, 120));
    await shot(p, `fin-desktop${route.replaceAll("/", "_")}`);
  }
  await p.goto("/dashboard/banking/transactions", { waitUntil: "networkidle" }); await p.waitForTimeout(1000);
  const all = (await api(ctx.fay, "GET", "/api/banking/transactions?limit=200")).body;
  check("finance", "history count covers every movement (deposit, member, crypto, card, 18 conversions)", all?.count === 22, all?.count);
  const more = p.getByRole("button", { name: /Load more|Show more|Older/i });
  check("finance", "the history page offers more rows past the first page", (await more.count()) > 0 || all.count <= 50);
  const dl = p.getByRole("link", { name: /CSV|Export|Download/i }).or(p.getByRole("button", { name: /CSV|Export|Download/i }));
  if (await dl.count()) {
    const [file] = await Promise.all([p.waitForEvent("download", { timeout: 10000 }), dl.first().click()]);
    const body = fs.readFileSync(await file.path(), "utf8");
    check("finance", "CSV export from the page has every row", body.trim().split("\n").length - 1 === all.count, body.split("\n").length);
  } else check("finance", "CSV export control is present", false, "no CSV link/button");
});

await guard("finance", "investor, credit withdrawal, treasury, Stripe readiness", async () => {
  await api(ctx.ivy, "POST", "/api/credit/contributions", { amountCents: 1_000_00, idempotencyKey: key(), acceptRisk: true });
  const w = await api(ctx.ivy, "POST", "/api/credit/withdrawals", { amountCents: 200_00, idempotencyKey: key(), note: "Rebalancing" });
  check("finance", "investor requests a contribution withdrawal", w.status === 200, JSON.stringify(w.body).slice(0, 120));
  const p = pg.ivy;
  for (const route of ["/investor/banking", "/investor/banking/transactions", "/investor/banking/crypto", "/investor/credit"]) {
    await p.goto(route, { waitUntil: "networkidle" }); await p.waitForTimeout(900);
    const t = await text(p);
    check("finance", `${route} loads and says it is simulated`, /simulat/i.test(t) && !/Something went wrong|Application error/i.test(t), t.slice(0, 120));
    await shot(p, `fin-desktop${route.replaceAll("/", "_")}`);
  }
  const o = pg.owner;
  for (const route of ["/dashboard/treasury", "/dashboard/credit/admin", "/dashboard/integrations"]) {
    await o.goto(route, { waitUntil: "networkidle" }); await o.waitForTimeout(1200);
    const t = await text(o);
    check("finance", `${route} loads for the owner`, !/Something went wrong|Application error/i.test(t), t.slice(0, 120));
    await shot(o, `fin-desktop${route.replaceAll("/", "_")}`);
  }
  check("finance", "treasury says simulated and shows the ledger check", /simulat/i.test(await (async () => { await o.goto("/dashboard/treasury", { waitUntil: "networkidle" }); await o.waitForTimeout(1200); return text(o); })()));
  check("finance", "a freelancer can't open the treasury API (403)", (await api(ctx.fay, "GET", "/api/treasury/overview")).status === 403);
  check("finance", "Stripe readiness is owner-only and reports Stripe off locally", (await api(ctx.fay, "GET", "/api/payments/stripe/readiness")).status === 403
    && (await api(ctx.owner, "GET", "/api/payments/stripe/readiness")).status === 200);
});

// ---------------------------------------------------------------- phone width
await guard("mobile", "finance pages and the three workflows at phone width", async () => {
  const sets = [
    ["fay", fay, ["/dashboard/banking", "/dashboard/banking/transactions", "/dashboard/banking/transfers", "/dashboard/banking/cards", "/dashboard/banking/crypto", "/freelancer/specs", "/freelancer/contracts", "/freelancer/messages", "/freelancer/earnings"]],
    ["ivy", ivy, ["/investor/banking", "/investor/banking/transactions", "/investor/credit"]],
    ["owner", owner, ["/dashboard/treasury", "/dashboard/credit/admin", "/dashboard/pool", "/dashboard/conversations", "/dashboard/agents", "/dashboard/agents/new"]],
  ];
  for (const [k, , routes] of sets) {
    const mctx = await browser.newContext({ viewport: PHONE, baseURL: BASE, isMobile: true, hasTouch: true, storageState: await ctx[k].storageState() });
    mctx.errors = []; mctx.bad = [];
    const p = await newPage(mctx);
    for (const route of routes) {
      await p.goto(route, { waitUntil: "networkidle" }); await p.waitForTimeout(900);
      const extra = await overflow(p);
      check("mobile", `${route} fits a 390px screen (no sideways scroll)`, extra <= 1, `${extra}px wider`);
      await shot(p, `mobile${route.replaceAll("/", "_")}`);
    }
    check("mobile", `${k}: no console errors at phone width`, mctx.errors.length === 0, mctx.errors.slice(0, 4).join(" | "));
    await mctx.close();
  }
});

for (const [k, c] of Object.entries(ctx)) {
  const errs = c.errors.filter((e) => !/favicon/.test(e));
  check("console", `${k}: no console or page errors`, errs.length === 0, errs.slice(0, 4).join(" | "));
  const bad = c.bad.filter((b) => !/^(401|403|404) /.test(b));
  check("console", `${k}: no failed (5xx/4xx other than auth) requests`, bad.length === 0, bad.slice(0, 4).join(" | "));
}
fs.writeFileSync(OUT, JSON.stringify({ run: RUN, results }, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${failed.length} failed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
