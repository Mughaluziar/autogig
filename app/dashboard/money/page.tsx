"use client";
import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarClock, CheckCircle2, FileText, Landmark, Link2,
  Loader2, Plus, Rocket, Target, TrendingDown, TrendingUp, Wallet, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useMoney } from "@/components/money/money-provider";
import { GoalRing, IncomeAreaChart, IncomeExpenseBars } from "@/components/money/charts";
import { ClientMark, daysUntil, fmtShortDate, money, moneyRound } from "@/components/money/format";
import { amountDue, effectiveStatus, monthKey, monthlySeries, payableParts, todayStr } from "@/lib/ledger";
import { cn } from "@/lib/utils";

export default function MoneyOverviewPage() {
  const { L, openTxn, openGoal, share, linkBusy } = useMoney();

  const today = todayStr();
  const thisMonth = monthKey(today);
  const lastMonthDate = new Date(); lastMonthDate.setDate(1); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const sum = (type: "income" | "expense", month: string) => L.txns.filter((t) => t.type === type && monthKey(t.date) === month).reduce((n, t) => n + t.amount, 0);

  const income = sum("income", thisMonth);
  const expenses = sum("expense", thisMonth);
  const prevIncome = sum("income", lastMonth);
  const delta = prevIncome > 0 ? Math.round(((income - prevIncome) / prevIncome) * 100) : null;
  const sent = L.invoices.filter((i) => i.status !== "Draft");
  const outstanding = sent.reduce((n, i) => n + amountDue(i), 0);
  const overdue = sent.filter((i) => effectiveStatus(i) === "Overdue");
  const overdueAmt = overdue.reduce((n, i) => n + payableParts(i).filter((m) => m.status === "Due" && m.due && m.due < today).reduce((a, m) => a + m.amount, 0), 0);
  const series12 = monthlySeries(L.txns, 12);
  const series6 = series12.slice(-6);
  const hasHistory = L.txns.length > 0;

  const upcoming = sent
    .flatMap((i) => payableParts(i).filter((m) => m.status === "Due").map((m) => ({ invoice: i, part: m })))
    .sort((a, b) => (a.part.due || "9999").localeCompare(b.part.due || "9999"))
    .slice(0, 5);
  const recent = [...L.txns].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const bySource = Object.entries(
    L.txns.filter((t) => t.type === "income" && monthKey(t.date) === thisMonth)
      .reduce<Record<string, number>>((m, t) => { const k = t.party || t.category; m[k] = (m[k] ?? 0) + t.amount; return m; }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const goalPct = L.goal > 0 ? income / L.goal : 0;

  if (!L.ready) {
    return <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading your money…</div>;
  }

  return (
    <div className="space-y-6">
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/20 via-card to-card p-5 shadow-[0_20px_60px_-30px_hsl(var(--primary)/0.6)] sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 left-10 size-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-end">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Earned this month</p>
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="text-5xl font-extrabold tracking-tight sm:text-6xl">{moneyRound(income)}</p>
              {delta !== null && (
                <span className={cn("mb-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", delta >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                  {delta >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                  {delta >= 0 ? "+" : ""}{delta}% vs last month
                </span>
              )}
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-3">
              <HeroStat label="Waiting to be paid" value={moneyRound(outstanding)} />
              <HeroStat label="Overdue" value={moneyRound(overdueAmt)} tone={overdue.length ? "danger" : undefined} />
              <HeroStat label="Net profit" value={moneyRound(income - expenses)} tone={income - expenses < 0 ? "danger" : undefined} />
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="gradient" asChild><Link href="/dashboard/money/invoices/new"><Plus className="size-4" /> Create invoice</Link></Button>
              <Button variant="outline" className="bg-background/60" onClick={() => openTxn("income")}><ArrowDownLeft className="size-4" /> Record payment</Button>
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Income, last 12 months</p>
            {hasHistory ? (
              <IncomeAreaChart data={series12} />
            ) : (
              <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/30 bg-background/30 px-6 text-center">
                <Wallet className="size-8 text-primary/60" />
                <p className="text-sm font-medium">Your first payment draws this chart</p>
                <p className="max-w-xs text-xs text-muted-foreground">Send an invoice with a pay link. When your client pays by card or crypto, it shows up here on its own.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Overdue nudge ---------- */}
      {overdue.length > 0 && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center">
          <AlertTriangle className="size-5 shrink-0 text-destructive" />
          <p className="flex-1 text-sm"><span className="font-semibold">{overdue.length} invoice{overdue.length > 1 ? "s are" : " is"} overdue</span> ({money(overdueAmt)}). A friendly reminder with the pay link usually does it.</p>
          <Button size="sm" variant="outline" asChild><Link href="/dashboard/money/invoices?status=Overdue">Review overdue</Link></Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------- Cash flow ---------- */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="mb-1 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">Cash flow</p>
                <p className="text-xs text-muted-foreground">Income and expenses, last 6 months</p>
              </div>
              <Button size="sm" variant="ghost" asChild><Link href="/dashboard/money/transactions">All transactions <ArrowRight className="size-4" /></Link></Button>
            </div>
            <div className="my-4 grid grid-cols-3 gap-2 text-center">
              <MiniStat label="In this month" value={moneyRound(income)} tone="text-success" />
              <MiniStat label="Out this month" value={moneyRound(expenses)} />
              <MiniStat label="Kept" value={income > 0 ? `${Math.max(0, Math.round(((income - expenses) / income) * 100))}%` : "—"} />
            </div>
            {hasHistory ? <IncomeExpenseBars data={series6} /> : (
              <div className="flex h-56 flex-col items-center justify-center gap-3 rounded-xl bg-muted/30 text-center text-sm text-muted-foreground">
                <p>No transactions yet. Record income and expenses to see your real profit.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openTxn("income")}><ArrowDownLeft className="size-4" /> Income</Button>
                  <Button size="sm" variant="outline" onClick={() => openTxn("expense")}><ArrowUpRight className="size-4" /> Expense</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------- Goal + sources ---------- */}
        <div className="space-y-6">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between"><p className="font-semibold">Monthly goal</p>
                <Button size="sm" variant="ghost" onClick={openGoal}><Target className="size-4" />{L.goal ? "Change" : "Set goal"}</Button></div>
              {L.goal > 0 ? (
                <div className="mt-3 flex items-center gap-4">
                  <div className="relative shrink-0">
                    <GoalRing pct={goalPct} />
                    <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">{Math.min(999, Math.round(goalPct * 100))}%</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl font-bold">{moneyRound(income)}</p>
                    <p className="text-xs text-muted-foreground">of {moneyRound(L.goal)}</p>
                    <p className={cn("mt-2 text-xs font-medium", income >= L.goal ? "text-success" : "text-muted-foreground")}>
                      {income >= L.goal ? "Goal reached. Nice work." : `${moneyRound(L.goal - income)} to go${upcoming.length ? ` · ${moneyRound(outstanding)} on its way` : ""}`}
                    </p>
                  </div>
                </div>
              ) : <p className="mt-2 text-sm text-muted-foreground">Set an income target and watch the ring fill as clients pay.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="mb-3 font-semibold">Top clients this month</p>
              {bySource.length === 0 ? <p className="text-sm text-muted-foreground">Nothing received yet this month.</p> : (
                <div className="space-y-3">
                  {bySource.map(([name, amt]) => (
                    <div key={name}>
                      <div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium">{name}</span><span className="font-semibold">{moneyRound(amt)}</span></div>
                      <Progress value={(amt / Math.max(income, 1)) * 100} className="mt-1.5 h-1.5" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Coming in ---------- */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between"><p className="flex items-center gap-2 font-semibold"><CalendarClock className="size-4 text-primary" /> Coming in</p>
              <Button size="sm" variant="ghost" asChild><Link href="/dashboard/money/invoices">Invoices <ArrowRight className="size-4" /></Link></Button></div>
            {upcoming.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl bg-muted/30 py-8 text-center text-sm text-muted-foreground">
                <FileText className="size-7 opacity-50" />
                <p>No payments due. Create an invoice and split it into milestones to get paid as you deliver.</p>
                <Button size="sm" variant="gradient" asChild><Link href="/dashboard/money/invoices/new"><Plus className="size-4" /> New invoice</Link></Button>
              </div>
            ) : (
              <ul className="space-y-2">
                {upcoming.map(({ invoice: i, part: m }) => {
                  const d = m.due ? daysUntil(m.due) : null;
                  return (
                    <li key={`${i.id}-${m.id}`} className="flex items-center gap-3 rounded-xl border bg-card/60 p-3">
                      <ClientMark name={i.client} className="size-9 text-xs" />
                      <Link href={`/dashboard/money/invoices/${i.id}`} className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{i.client} · {m.title}</p>
                        <p className={cn("text-[11px]", d !== null && d < 0 ? "text-destructive" : "text-muted-foreground")}>
                          {i.number} · {d === null ? "No due date" : d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "Due today" : `Due ${fmtShortDate(m.due)}`}
                        </p>
                      </Link>
                      <p className="text-sm font-semibold">{money(m.amount)}</p>
                      <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={`Share pay link for ${i.number}`} disabled={linkBusy === i.id} onClick={() => share(i)}>
                        {linkBusy === i.id ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ---------- Recent ---------- */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between"><p className="font-semibold">Recent activity</p>
              <Button size="sm" variant="ghost" asChild><Link href="/dashboard/money/transactions">See all <ArrowRight className="size-4" /></Link></Button></div>
            {recent.length === 0 ? <p className="rounded-xl bg-muted/30 py-8 text-center text-sm text-muted-foreground">Payments and expenses you record show up here.</p> : (
              <ul className="divide-y">
                {recent.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", t.type === "income" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
                      {t.type === "income" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{t.party || t.category}</p><p className="truncate text-[11px] text-muted-foreground">{t.note || t.category} · {fmtShortDate(t.date)}</p></div>
                    <p className={cn("text-sm font-semibold", t.type === "income" && "text-success")}>{t.type === "income" ? "+" : "−"}{money(t.amount)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------- Grow your cash ---------- */}
      <section aria-labelledby="grow-cash">
        <p id="grow-cash" className="mb-3 text-sm font-semibold">Make your money work harder</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <GrowCard href="/dashboard/capital" icon={Zap} title="Get paid early" body="Turn a confirmed order into cash today instead of waiting for the marketplace to clear it." />
          <GrowCard href="/dashboard/banking" icon={Landmark} title="Cash out to your bank" body="Move what you've earned to your bank account or crypto wallet." />
          <GrowCard href="/dashboard/marketplace" icon={Rocket} title="Fund your growth" body="Raise money to hire, buy equipment or take on bigger projects." />
        </div>
      </section>

      {L.invoices.length > 0 && sent.every((i) => i.status === "Paid") && (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5 text-success" /> Every invoice you&apos;ve sent is paid. All caught up.</p>
      )}
    </div>
  );
}

function HeroStat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="min-w-0 rounded-xl bg-background/40 px-3 py-2.5 ring-1 ring-inset ring-border/60 backdrop-blur">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-base font-bold sm:text-lg", tone === "danger" && "text-destructive")}>{value}</dd>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 px-2 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("truncate text-sm font-bold", tone)}>{value}</p>
    </div>
  );
}

function GrowCard({ href, icon: Icon, title, body }: { href: string; icon: any; title: string; body: string }) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-primary/5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-semibold">{title}<ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
      </span>
    </Link>
  );
}
