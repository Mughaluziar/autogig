// Seeds safe, synthetic accounts and data for the three client recordings (docs/client-demo-recordings.md):
//   1. First sale through the freelancer pool  2. Unified messaging  3. Agent Fleet customization
// Run it ONLY against the local credential-free stack (scripts/qa/local-api.py on a disposable loopback MongoDB):
// it refuses any other API. Every name, email and message is invented; *.example.test addresses can't receive mail.
// Nothing here touches money: the finance modules stay simulated and aren't part of these recordings.
//   BASE=http://localhost:3100 API=http://127.0.0.1:8010 HOOK=qa-hook-secret \
//   PLAYWRIGHT_MODULE=... CHROME=... node scripts/qa/demo-seed.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const BASE = process.env.BASE || "http://localhost:3100";
const API = process.env.API || "http://127.0.0.1:8010";
const HOOK = process.env.HOOK || "qa-hook-secret";
const PW = process.env.DEMO_PASSWORD || "Demo-Synthetic-Pass-2026";
for (const url of [BASE, API]) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url)) throw new Error(`Refusing to seed a non-local server: ${url}`);
}
const health = await (await fetch(`${API}/health`)).json();
if (health.environment !== "test") throw new Error("Refusing to seed: the API is not the local test runner.");

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--disable-dev-shm-usage"] });
const accounts = {
  agency: { role: "admin", first: "Hana", last: "Park", email: "hana.agency@demo.example.test", company: "Harbor Digital" },
  maya: { role: "freelancer", first: "Maya", last: "Lopez", email: "maya.freelancer@demo.example.test" },
  leo: { role: "freelancer", first: "Leo", last: "Chen", email: "leo.freelancer@demo.example.test" },
};

async function signup(u) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(`/signup/${u.role}`);
  await page.fill("#first", u.first); await page.fill("#last", u.last); await page.fill("#email", u.email);
  const country = page.locator("select#country");
  if (await country.count()) await country.selectOption({ label: "United States" }).catch(() => {});
  if (u.role === "freelancer") {
    await page.getByRole("spinbutton", { name: /Hourly rate/ }).fill("55");
    await page.getByRole("textbox", { name: "Primary skills" }).fill("Next.js, Tailwind, Figma");
    await page.getByRole("combobox", { name: "Years of experience" }).selectOption("3–5");
    await page.getByRole("combobox", { name: "Availability" }).selectOption("Full-time");
    await page.getByRole("textbox", { name: "Password" }).fill(PW);
  } else {
    await page.fill("#agency", u.company); await page.fill("#password", PW); await page.fill("#confirm", PW);
  }
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /Create account/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 20000 });
  await page.close();
  return ctx;
}
const call = async (ctx, method, path, data) => {
  const csrf = (await ctx.cookies()).find((c) => c.name === "autopilot_csrf")?.value ?? "";
  const res = await ctx.request.fetch(`${BASE}${path}`, { method, data, headers: { "X-Session-Mode": "cookie", Origin: BASE, "X-CSRF-Token": csrf } });
  const body = await res.json().catch(() => null);
  if (res.status() >= 400) throw new Error(`${method} ${path}: ${res.status()} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
};

const ctx = {};
for (const [k, u] of Object.entries(accounts)) ctx[k] = await signup(u);
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// Video 2: Harbor Digital already awarded Leo a contract, so the agency-freelancer conversation has a subject.
const spec = await call(ctx.agency, "POST", "/api/pool/admin/specs", {
  title: "Brand refresh for a neighbourhood bakery", summary: "New logo lockup, colour palette and a one-page menu site.",
  stack: ["Figma", "Next.js"], estHours: 24, deadline: inDays(21), maxRate: 70,
});
await call(ctx.leo, "POST", `/api/pool/specs/${spec.id}/bid`, { hours: 22, rate: 55, note: "I've done two bakery brands this year." });
const bid = (await call(ctx.agency, "GET", "/api/pool/admin/specs")).find((s) => s.id === spec.id).bids[0];
await call(ctx.agency, "POST", `/api/pool/admin/specs/${spec.id}/award`, { bidId: bid.id, milestones: [] });

// Video 2: three forwarded marketplace notifications in the agency's Unified Inbox (as the mail provider would post them).
const { address } = await call(ctx.agency, "GET", "/api/inbox/address");
const inbound = [
  ["Upwork <donotreply@upwork.com>", "New message from Dana R. (client)", "Hi! Are you available to start Monday on the analytics dashboard? Budget is flexible for the right team."],
  ["Fiverr <noreply@fiverr.com>", "You received a new message from sam_cafe", "Could you add a delivery-time badge to the menu page? Happy to extend the order by two days."],
  ["Freelancer <no-reply@freelancer.com>", "New message regarding your bid", "Thanks for the bid on the landing page project. Can you share two similar sites you've built?"],
];
for (const [i, [from, subject, text]] of inbound.entries()) {
  const res = await fetch(`${API}/api/inbox/inbound`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${HOOK}` },
    body: JSON.stringify({ To: address, From: from, Subject: subject, TextBody: text, MessageID: `<demo-${i}-${Date.now()}@demo.example.test>` }) });
  if (res.status >= 400) throw new Error(`inbound ${from}: ${res.status} ${await res.text()} (is INBOUND_EMAIL_PLATFORMS=upwork,fiverr,freelancer.com set?)`);
}

await browser.close();
console.log(`
Demo data ready (synthetic; password for every account: ${PW})
  Agency      ${accounts.agency.email}   Harbor Digital: one awarded contract (Leo), 3 forwarded inbox messages, the default Agent Fleet (5 starter agents)
  Freelancer  ${accounts.maya.email}  Maya Lopez: clean account for the first-sale recording
  Freelancer  ${accounts.leo.email}    Leo Chen: holds the bakery contract (messaging recording)
`);
