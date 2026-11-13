"use client";
import * as React from "react";
import { Activity, BarChart3, GitBranch, Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { SectionNav, type SectionLink } from "@/components/security/section-nav";
import { RangePicker } from "./charts";
import { RANGES, earliestKey, useAnalyticsSources, useRange, windowFor, type RangeId, type Sources, type Window } from "./data";

export const ANALYTICS_LINKS: SectionLink[] = [
  { href: "/dashboard/analytics", label: "Overview", icon: BarChart3 },
  { href: "/dashboard/analytics/earnings", label: "Earnings", icon: Wallet },
  { href: "/dashboard/analytics/pipeline", label: "Pipeline", icon: GitBranch },
  { href: "/dashboard/analytics/activity", label: "Activity", icon: Activity },
];

export type AnalyticsContext = { src: Sources; w: Window; range: RangeId; rangeLabel: string; prevLabel: string };

/** Header, section tabs and the date range shared by every analytics page.
 *  The range sits in one row above everything it scopes. */
export function AnalyticsFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: (ctx: AnalyticsContext) => React.ReactNode;
}) {
  const src = useAnalyticsSources();
  const [range, setRange] = useRange();
  const w = React.useMemo(() => windowFor(range, earliestKey(src)), [range, src]);
  const rangeLabel = RANGES.find((r) => r.id === range)?.long ?? "";
  const prevLabel = range === "12m" ? "vs previous 12 months" : range === "all" ? "" : `vs previous ${range.replace("d", " days")}`;

  return (
    <>
      <PageHeader title={title} description={description} />
      <SectionNav links={ANALYTICS_LINKS} className="mb-4" />
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <RangePicker value={range} onChange={setRange} />
        <p className="text-xs text-muted-foreground">
          {rangeLabel}
          {w.from ? ` · ${new Date(`${w.from}T00:00:00`).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })} – today` : ""}
        </p>
      </div>
      {!src.ready ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/60" />)}
        </div>
      ) : (
        children({ src, w, range, rangeLabel, prevLabel })
      )}
    </>
  );
}
