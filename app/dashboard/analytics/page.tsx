"use client";
import Link from "next/link";
import { ArrowRight, Briefcase, Radar, Wallet } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { AnalyticsFrame } from "@/components/analytics/frame";
import {
  ChartCard, EmptyChart, Funnel, IncomeExpenseBars, RankedBars, TrendArea, money,
} from "@/components/analytics/charts";
import {
  agentMetrics, calendarMetrics, change, moneyMetrics, orderMetrics, outreachMetrics, pipelineMetrics,
} from "@/components/analytics/data";

export default function AnalyticsPage() {
  return (
    <AnalyticsFrame title="Analytics" description="How your freelance business is doing — money in and out, your pipeline and what your agents did. All from your own data.">
      {({ src, w, prevLabel }) => {
        const m = moneyMetrics(src, w);
        const p = pipelineMetrics(src, w);
        const a = agentMetrics(src, w);
        const o = outreachMetrics(src, w);
        const ord = orderMetrics(src, w);
        const cal = calendarMetrics(src);
        const nothing = !m.hasAny && src.applications.length === 0 && src.runs.length === 0 && src.orders.length === 0;

        return (
          <div className="space-y-6">
            {nothing && <GettingStarted />}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Income" value={money(m.income)} trend={change(m.income, m.prevIncome)} hint={prevLabel || "recorded payments"} href="/dashboard/analytics/earnings" />
              <StatCard label="Net profit" value={money(m.net)} trend={change(m.net, m.prevNet)} hint={`${money(m.expense)} expenses`} href="/dashboard/analytics/earnings" />
              <StatCard label="Waiting to be paid" value={money(m.outstanding)} hint={m.overdue ? `${money(m.overdue)} overdue` : "nothing overdue"} href="/dashboard/money" />
              <StatCard label="Applications sent" value={String(p.applied)} trend={change(p.applied, p.prevApplied)} hint={`${p.tracked} tracked`} href="/dashboard/analytics/pipeline" />
              <StatCard label="Win rate" value={p.winRate === null ? "—" : `${p.winRate}%`} hint={`${p.won} won of ${p.applied}`} href="/dashboard/analytics/pipeline" />
              <StatCard label="Agent runs" value={String(a.runs)} hint={a.successRate === null ? "no finished runs" : `${a.successRate}% succeeded`} href="/dashboard/analytics/activity" />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <ChartCard
                className="lg:col-span-2"
                title="Income vs expenses"
                subtitle="What you recorded in Money, per period"
                legend={[{ label: "Income", color: "hsl(var(--primary))" }, { label: "Expenses", color: "var(--series-2)" }]}
                table={{ columns: ["Period", "Income", "Expenses", "Net"], rows: m.series.map((r) => [r.label, money(r.income), money(r.expense), money(r.income - r.expense)]) }}
              >
                {m.series.some((r) => r.income || r.expense) ? (
                  <IncomeExpenseBars data={m.series} />
                ) : (
                  <EmptyChart text="No income or expenses in this range. Add them in Money, or get paid through an invoice pay link." href="/dashboard/money" cta="Open Money" />
                )}
              </ChartCard>
              <ChartCard title="Top clients" subtitle="Share of income in this range">
                {m.byClient.length ? <RankedBars rows={m.byClient} format={money} /> : <EmptyChart text="Income you record shows up here by client." />}
              </ChartCard>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title="Application funnel" subtitle="Jobs tracked in Job Radar, by the furthest stage they reached">
                {p.tracked ? <Funnel stages={p.funnel} /> : <EmptyChart text="Save or apply to jobs in Job Radar to see your funnel." href="/dashboard/job-radar" cta="Find jobs" />}
              </ChartCard>
              <ChartCard
                title="Applications tracked"
                subtitle="New jobs added to your pipeline"
                table={{ columns: ["Period", "Tracked"], rows: p.series.map((r) => [r.label, r.value]) }}
              >
                {p.tracked ? <TrendArea id="apps" data={p.series} name="tracked" /> : <EmptyChart text="Nothing tracked in this range yet." href="/dashboard/job-radar" cta="Scan for jobs" />}
              </ChartCard>
            </div>

            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <ChartCard title="Agent activity" subtitle="Runs by agent (dry runs excluded)">
                {a.runs ? <RankedBars rows={a.byAgent} /> : <EmptyChart text="Agent activity will show here once Agent Fleet is available (coming soon)." />}
              </ChartCard>
              <ChartCard title="Orders by platform" subtitle={src.ordersAvailable ? "Orders detected on your connected accounts" : "Connect accounts to track orders"}>
                {ord.total ? (
                  <>
                    <RankedBars rows={ord.byPlatform} />
                    <p className="mt-4 text-xs text-muted-foreground">{ord.active} active now · {ord.completed} completed · {ord.cancelled} cancelled or refunded in range</p>
                  </>
                ) : (
                  <EmptyChart text="No orders in this range." href="/dashboard/orders" cta="Open Orders" />
                )}
              </ChartCard>
              <ChartCard title="Outreach" subtitle="Campaigns and direct outreach you sent">
                {o.campaigns || o.direct ? (
                  <dl className="grid grid-cols-2 gap-4">
                    <Metric label="Campaign emails sent" value={String(o.sent)} />
                    <Metric label="Failed to deliver" value={String(o.failed)} />
                    <Metric label="Campaigns" value={String(o.campaigns)} />
                    <Metric label="Direct outreach" value={String(o.direct)} />
                    <Metric label="Events next 7 days" value={String(cal.upcoming)} />
                  </dl>
                ) : (
                  <EmptyChart text="Run a campaign or reach out to prospects from Outreach." href="/dashboard/growth" cta="Open Outreach" />
                )}
              </ChartCard>
            </div>
          </div>
        );
      }}
    </AnalyticsFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function GettingStarted() {
  const steps = [
    { icon: Wallet, title: "Record money", text: "Add income and expenses or send an invoice.", href: "/dashboard/money" },
    { icon: Radar, title: "Track jobs", text: "Save and apply to jobs from Job Radar.", href: "/dashboard/job-radar" },
    { icon: Briefcase, title: "Review Upwork leads", text: "Read your job-alert leads and draft proposals in Gigs.", href: "/dashboard/gigs" },
  ];
  return (
    <section className="panel overflow-hidden p-5">
      <h2 className="font-semibold">Your analytics fill in as you work</h2>
      <p className="mt-1 text-sm text-muted-foreground">There&apos;s no data yet. Everything here comes from what you do in Autopilot — no sample numbers.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {steps.map((s) => (
          <Link key={s.href} href={s.href} className="group flex items-start gap-3 rounded-xl border p-3 transition-colors hover:border-primary/50 hover:bg-accent/40">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><s.icon className="size-4" /></span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-sm font-medium">{s.title} <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" /></span>
              <span className="block text-xs text-muted-foreground">{s.text}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
