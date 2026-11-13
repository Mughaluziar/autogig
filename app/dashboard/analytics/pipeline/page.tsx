"use client";
import { StatCard } from "@/components/shared/stat-card";
import { AnalyticsFrame } from "@/components/analytics/frame";
import { ChartCard, EmptyChart, Funnel, RankedBars, TrendArea } from "@/components/analytics/charts";
import { change, outreachMetrics, pipelineMetrics } from "@/components/analytics/data";

export default function PipelineAnalyticsPage() {
  return (
    <AnalyticsFrame title="Pipeline" description="How the jobs you track turn into work: response and win rates, the best sources, and where deals stall.">
      {({ src, w, prevLabel }) => {
        const p = pipelineMetrics(src, w);
        const o = outreachMetrics(src, w);
        return (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Applications sent" value={String(p.applied)} trend={change(p.applied, p.prevApplied)} hint={prevLabel || `${p.tracked} tracked`} />
              <StatCard label="Response rate" value={p.responseRate === null ? "—" : `${p.responseRate}%`} hint="interview, won or a no" />
              <StatCard label="Win rate" value={p.winRate === null ? "—" : `${p.winRate}%`} hint={`${p.won} won`} />
              <StatCard label="Avg days to a response" value={p.avgDaysToResponse === null ? "—" : `${p.avgDaysToResponse}d`} hint={p.avgDaysToResponse === null ? "needs stage dates" : "from applying"} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard
                title="Funnel"
                subtitle="Each job counted at the furthest stage it reached"
                table={{ columns: ["Stage", "Jobs"], rows: p.funnel.map((s) => [s.stage, s.value]) }}
              >
                {p.tracked ? <Funnel stages={p.funnel} /> : <EmptyChart text="Track jobs from Job Radar to build your funnel." href="/dashboard/job-radar" cta="Open Job Radar" />}
              </ChartCard>
              <ChartCard title="Outcomes" subtitle="Where your sent applications stand">
                {p.applied ? <RankedBars rows={p.outcomes.filter((r) => r.value > 0)} /> : <EmptyChart text="Applications you send show their outcome here." />}
              </ChartCard>
            </div>

            <ChartCard title="Jobs tracked over time" table={{ columns: ["Period", "Tracked"], rows: p.series.map((r) => [r.label, r.value]) }}>
              {p.tracked ? <TrendArea id="pipeline" data={p.series} name="tracked" height={260} /> : <EmptyChart text="Nothing tracked in this range." href="/dashboard/job-radar" cta="Scan for jobs" />}
            </ChartCard>

            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title="Best sources" subtitle="Applications and wins by where you found the job">
                {p.bySource.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="py-2 text-left font-medium">Source</th>
                          <th className="py-2 text-right font-medium">Applied</th>
                          <th className="py-2 text-right font-medium">Won</th>
                          <th className="py-2 text-right font-medium">Win rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {p.bySource.map((s) => (
                          <tr key={s.name}>
                            <td className="py-2">{s.name}</td>
                            <td className="py-2 text-right tabular-nums">{s.total}</td>
                            <td className="py-2 text-right tabular-nums">{s.won}</td>
                            <td className="py-2 text-right tabular-nums">{Math.round((s.won / s.total) * 100)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyChart text="Sources appear once you've applied to a few jobs." />
                )}
              </ChartCard>
              <ChartCard title="Outreach" subtitle="Direct outreach by status and platform">
                {o.direct ? (
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-medium text-muted-foreground">By status</p>
                      <RankedBars rows={o.byStatus} />
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium text-muted-foreground">By platform</p>
                      <RankedBars rows={o.byPlatform} />
                    </div>
                  </div>
                ) : (
                  <EmptyChart text="Prospects you reach out to from Outreach show up here." href="/dashboard/growth" cta="Open Outreach" />
                )}
              </ChartCard>
            </div>
          </div>
        );
      }}
    </AnalyticsFrame>
  );
}
