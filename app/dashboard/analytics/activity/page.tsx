"use client";
import { StatCard } from "@/components/shared/stat-card";
import { AnalyticsFrame } from "@/components/analytics/frame";
import { ChartCard, EmptyChart, RankedBars, TrendArea } from "@/components/analytics/charts";
import { agentMetrics, calendarMetrics, orderMetrics, outreachMetrics } from "@/components/analytics/data";

export default function ActivityAnalyticsPage() {
  return (
    <AnalyticsFrame title="Activity" description="What your agents, orders, outreach and calendar added up to over the selected range.">
      {({ src, w }) => {
        const a = agentMetrics(src, w);
        const ord = orderMetrics(src, w);
        const o = outreachMetrics(src, w);
        const cal = calendarMetrics(src);
        return (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Agent runs" value={String(a.runs)} hint={`${a.succeeded} succeeded · ${a.failed} failed`} />
              <StatCard label="Agent success rate" value={a.successRate === null ? "—" : `${a.successRate}%`} hint="finished runs only" />
              <StatCard label="Orders in range" value={String(ord.total)} hint={src.ordersAvailable ? `${ord.active} active now` : "connect accounts to track"} href="/dashboard/orders" />
              <StatCard label="Calendar, next 7 days" value={String(cal.upcoming)} hint="Calendar is coming soon" />
            </div>

            <ChartCard title="Agent runs over time" subtitle="Dry runs excluded" table={{ columns: ["Period", "Runs"], rows: a.series.map((r) => [r.label, r.value]) }}>
              {a.runs ? <TrendArea id="runs" data={a.series} name="runs" height={260} /> : <EmptyChart text="Agent activity will show here once Agent Fleet is available (coming soon)." />}
            </ChartCard>

            <div className="grid gap-6 lg:grid-cols-3">
              <ChartCard title="Runs by agent">
                {a.runs ? <RankedBars rows={a.byAgent} /> : <EmptyChart text="No agent runs in this range." />}
              </ChartCard>
              <ChartCard title="Orders by platform">
                {ord.total ? <RankedBars rows={ord.byPlatform} /> : <EmptyChart text="No orders in this range." href="/dashboard/orders" cta="Open Orders" />}
              </ChartCard>
              <ChartCard title="Campaigns">
                {o.campaigns ? (
                  <dl className="grid grid-cols-2 gap-4">
                    <div><dt className="text-xs text-muted-foreground">Campaigns</dt><dd className="text-xl font-bold">{o.campaigns}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Emails sent</dt><dd className="text-xl font-bold">{o.sent}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Failed</dt><dd className="text-xl font-bold">{o.failed}</dd></div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Delivery rate</dt>
                      <dd className="text-xl font-bold">{o.sent + o.failed ? `${Math.round((o.sent / (o.sent + o.failed)) * 100)}%` : "—"}</dd>
                    </div>
                  </dl>
                ) : (
                  <EmptyChart text="No campaigns in this range." href="/dashboard/growth" cta="Start a campaign" />
                )}
              </ChartCard>
            </div>
          </div>
        );
      }}
    </AnalyticsFrame>
  );
}
