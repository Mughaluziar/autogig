"use client";
import { StatCard } from "@/components/shared/stat-card";
import { AnalyticsFrame } from "@/components/analytics/frame";
import { ChartCard, EmptyChart, IncomeExpenseBars, RankedBars, money } from "@/components/analytics/charts";
import { change, moneyMetrics } from "@/components/analytics/data";

export default function EarningsAnalyticsPage() {
  return (
    <AnalyticsFrame title="Earnings" description="Where your money comes from, where it goes, and how fast clients pay — from your Money ledger and invoices.">
      {({ src, w, prevLabel }) => {
        const m = moneyMetrics(src, w);
        const margin = m.income ? Math.round((m.net / m.income) * 1000) / 10 : null;
        return (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Income" value={money(m.income)} trend={change(m.income, m.prevIncome)} hint={prevLabel || "all recorded income"} />
              <StatCard label="Expenses" value={money(m.expense)} trend={change(m.expense, m.prevExpense)} hint={prevLabel || "all recorded costs"} />
              <StatCard label="Profit margin" value={margin === null ? "—" : `${margin}%`} hint={`${money(m.net)} net`} />
              <StatCard label="Avg days to get paid" value={m.avgDaysToPaid === null ? "—" : `${m.avgDaysToPaid}d`} hint={m.paidCount ? `across ${m.paidCount} paid invoice${m.paidCount === 1 ? "" : "s"}` : "no invoices paid in range"} />
            </div>

            <ChartCard
              title="Income vs expenses"
              subtitle="Per period in the selected range"
              legend={[{ label: "Income", color: "hsl(var(--primary))" }, { label: "Expenses", color: "var(--series-2)" }]}
              table={{ columns: ["Period", "Income", "Expenses", "Net"], rows: m.series.map((r) => [r.label, money(r.income), money(r.expense), money(r.income - r.expense)]) }}
            >
              {m.series.some((r) => r.income || r.expense) ? (
                <IncomeExpenseBars data={m.series} height={300} />
              ) : (
                <EmptyChart text="No income or expenses recorded in this range." href="/dashboard/money" cta="Record income in Money" />
              )}
            </ChartCard>

            <div className="grid gap-6 lg:grid-cols-3">
              <ChartCard title="Income by client" subtitle="Who pays you the most">
                {m.byClient.length ? <RankedBars rows={m.byClient} format={money} /> : <EmptyChart text="No income in this range." />}
              </ChartCard>
              <ChartCard title="Income by type" subtitle="Client work, payouts, retainers…">
                {m.incomeByCategory.length ? <RankedBars rows={m.incomeByCategory} format={money} /> : <EmptyChart text="No income in this range." />}
              </ChartCard>
              <ChartCard title="Expenses by category" subtitle="Where your money goes">
                {m.expenseByCategory.length ? <RankedBars rows={m.expenseByCategory} format={money} /> : <EmptyChart text="No expenses in this range." href="/dashboard/money" cta="Add an expense" />}
              </ChartCard>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title="How clients paid" subtitle="Invoice payments received in this range">
                {m.byMethod.length ? (
                  <RankedBars rows={m.byMethod} format={money} />
                ) : (
                  <EmptyChart text="Invoice payments show up here by method — debit card, credit card or crypto." href="/dashboard/money" cta="Create an invoice" />
                )}
              </ChartCard>
              <ChartCard
                title="Unpaid invoices by age"
                subtitle="Everything still owed today, whatever the range"
                table={{ columns: ["Age", "Amount"], rows: m.aging.map((a) => [a.name, money(a.value)]) }}
              >
                {m.outstanding ? (
                  <>
                    <RankedBars rows={m.aging.filter((a) => a.value > 0)} format={money} />
                    <p className="mt-4 text-xs text-muted-foreground">
                      {money(m.outstanding)} outstanding{m.overdue ? `, ${money(m.overdue)} of it overdue — chase it from Money.` : " and nothing overdue."}
                    </p>
                  </>
                ) : (
                  <EmptyChart text="No unpaid invoices. Nice." />
                )}
              </ChartCard>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Invoices sent in range" value={String(m.issuedCount)} hint={money(m.issuedValue)} href="/dashboard/money" />
              <StatCard label="Invoices paid in range" value={String(m.paidCount)} href="/dashboard/money" />
              <StatCard label="Overdue now" value={money(m.overdue)} href="/dashboard/money" />
            </div>
          </div>
        );
      }}
    </AnalyticsFrame>
  );
}
