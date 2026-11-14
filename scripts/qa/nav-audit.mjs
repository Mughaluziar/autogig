// Nav audit: signs up a fresh synthetic agency, visits every admin/freelancer nav route (desktop + mobile)
// and records failed requests, redirects, "Coming soon" states, console errors and visible buttons.
// Needs the same stack as e2e.mjs. Usage: BASE=http://localhost:3100 OUT=audit.json node scripts/qa/nav-audit.mjs
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:3100";
const OUT = process.env.OUT || "nav-audit.json";
const PW = "Qa-Synthetic-Pass-9182";
const RUN = Date.now().toString(36);
const navSrc = fs.readFileSync("components/dashboard/nav-config.ts", "utf8");
const routes = [...new Set([...navSrc.matchAll(/href: "(\/[a-z\-\/]*)"/g)].map((m) => m[1]))];
const extra = ["/dashboard/clients", "/dashboard/contracts", "/dashboard/milestones", "/dashboard/freelancers", "/dashboard/conversations", "/dashboard/notifications", "/dashboard/bidding", "/dashboard/billing", "/dashboard/user-testing", "/dashboard/qa", "/dashboard/voice", "/dashboard/payments"];
const all = [...new Set([...routes, ...extra])].filter((r) => !r.startsWith("/investor"));
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--disable-dev-shm-usage"] });
async function session(role, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(`/signup/${role}`);
  await page.fill("#first", "Audit"); await page.fill("#last", "Agency"); await page.fill("#email", email);
  const sel = page.locator("select#country"); if (await sel.count()) await sel.selectOption({ label: "United States" }).catch(() => {});
  if (role === "freelancer") {
    await page.getByRole("spinbutton", { name: /Hourly rate/ }).fill("55");
    await page.getByRole("textbox", { name: "Primary skills" }).fill("React");
    await page.getByRole("combobox", { name: "Years of experience" }).selectOption("3–5");
    await page.getByRole("combobox", { name: "Availability" }).selectOption("Full-time");
    await page.getByRole("textbox", { name: "Password" }).fill(PW);
  } else { await page.fill("#agency", "Audit Agency"); await page.fill("#password", PW); await page.fill("#confirm", PW); }
  const box = page.getByRole("checkbox"); if (await box.count()) await box.first().check();
  await page.getByRole("button", { name: /Create account/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signup"), { timeout: 20000 });
  return { ctx, page };
}
const out = [];
async function visit(ctx, route, mobile) {
  const page = await ctx.newPage();
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  const bad = [], errs = [];
  page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  page.on("pageerror", (e) => errs.push("pageerror " + e.message.slice(0, 120)));
  await page.goto(route, { waitUntil: "networkidle", timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(800);
  const final = new URL(page.url()).pathname;
  const info = await page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const text = main.innerText;
    const btns = [...main.querySelectorAll("button,a[role=button]")].filter((b) => b.offsetParent).map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40)).filter(Boolean);
    return { soon: /coming soon/i.test(text), simulated: /simulat/i.test(text), tables: main.querySelectorAll("table").length, overflow: document.documentElement.scrollWidth > innerWidth + 2, head: text.slice(0, 160).replace(/\s+/g, " "), btns: [...new Set(btns)].slice(0, 25) };
  });
  out.push({ route, mobile, final, redirected: final !== route, bad: [...new Set(bad)], errs, ...info });
  await page.close();
}
const admin = await session("admin", `audit-admin-${RUN}@example.test`);
for (const r of all.filter((r) => !r.startsWith("/freelancer"))) await visit(admin.ctx, r, false);
for (const r of all.filter((r) => r.startsWith("/dashboard")).slice(0, 60)) await visit(admin.ctx, r, true);
const fl = await session("freelancer", `audit-fl-${RUN}@example.test`);
for (const r of all.filter((r) => r.startsWith("/freelancer"))) { await visit(fl.ctx, r, false); await visit(fl.ctx, r, true); }
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
for (const o of out.filter((o) => !o.mobile)) console.log(`${o.route}${o.redirected ? " -> " + o.final : ""} | bad=${o.bad.length} soon=${o.soon} sim=${o.simulated} tbl=${o.tables} | ${o.head.slice(0, 70)}`);
await browser.close();
