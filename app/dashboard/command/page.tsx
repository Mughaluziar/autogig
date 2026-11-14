"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Gavel, Inbox, Mail, ShieldCheck, Workflow } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadState } from "@/components/shared/load-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { API_URL } from "@/lib/api";
import { usePool, type PoolContract, type PoolEarning, type PoolSpec } from "@/lib/pool";
import { formatCurrency, formatRelative } from "@/lib/utils";

type Lead = { id: string; title: string; status: string; budget?: string; receivedAt?: string };
type AutoJob = { id: string; title: string; platform: string; status: string; updatedAt: string };
type AuditRow = { id?: string; agent: string; action: string; status: string; time?: string; created_at?: string };

function Tile({ label, value, hint, href }: { label: string; value: React.ReactNode; hint: string; href: string }) {
  return (
    <Link href={href} className="group block rounded-xl border bg-card p-4 transition-colors hover:border-primary/50">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {hint} <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </p>
    </Link>
  );
}

/**
 * Agency home. Every number here comes from the signed-in account's own records
 * (freelancer pool, Upwork alert emails, automation jobs, audit log). Nothing is
 * estimated: with no activity the tiles read 0, and revenue/margin/win-rate
 * figures are left out until there is a real source for them.
 */
export default function CommandCenter() {
  const { user } = useAuth();
  const specs = usePool<PoolSpec[]>("/api/pool/admin/specs");
  const contracts = usePool<PoolContract[]>("/api/pool/admin/contracts");
  const earnings = usePool<{ entries: PoolEarning[]; owed: number }>("/api/pool/admin/earnings");
  const leads = usePool<{ leads: Lead[] }>("/api/upwork/leads");
  const jobs = usePool<AutoJob[]>("/api/automation/jobs");
  const audit = usePool<AuditRow[]>("/api/audit-log");
  const sources = [specs, contracts, earnings, leads, jobs, audit];
  const loading = sources.some((s) => s.loading);
  const error = sources.find((s) => s.error)?.error ?? "";
  const reloadAll = () => sources.forEach((s) => s.reload());

  const firstName = (user?.name ?? "there").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const openSpecs = (specs.data ?? []).filter((s) => s.status === "open");
  const bidsToReview = openSpecs.reduce((n, s) => n + (s.bidsIn ?? 0), 0);
  const activeContracts = (contracts.data ?? []).filter((c) => c.status === "active");
  const toReview = (contracts.data ?? []).flatMap((c) => c.milestones.filter((m) => m.status === "delivered").map((m) => ({ c, m })));
  const newLeads = (leads.data?.leads ?? []).filter((l) => l.status === "new");
  const waiting = (jobs.data ?? []).filter((j) => j.status === "needs_approval");
  const recent = (audit.data ?? []).slice(0, 6);

  if (!API_URL) {
    return (
      <>
        <PageHeader title="Dashboard" description="Connect the app to its API to see your workspace." />
        <EmptyState title="No server connected" description="This build has no backend, so there is no account data to show." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description="What needs your attention across the freelancer pool, Upwork alerts and automation."
        actions={<Button asChild variant="outline"><Link href="/dashboard/pool">Open freelancer pool</Link></Button>}
      />
      <LoadState loading={loading && !sources.every((s) => s.data)} error={error} onRetry={reloadAll} />

      {!error && !(loading && !sources.every((s) => s.data)) && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Tile label="Open specs" value={openSpecs.length} hint="Broadcast to the pool" href="/dashboard/pool" />
            <Tile label="Bids to review" value={bidsToReview} hint="Blind bids awaiting award" href="/dashboard/pool" />
            <Tile label="Active contracts" value={activeContracts.length} hint="Awarded and in progress" href="/dashboard/pool" />
            <Tile label="Milestones to approve" value={toReview.length} hint="Delivered by freelancers" href="/dashboard/pool" />
            <Tile label="Owed to freelancers" value={formatCurrency(earnings.data?.owed ?? 0)} hint="Approved, not yet marked paid" href="/dashboard/pool" />
            <Tile label="New Upwork leads" value={newLeads.length} hint="From your alert emails" href="/dashboard/gigs" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base"><Gavel className="size-4 text-primary" /> Needs your decision</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {toReview.slice(0, 5).map(({ c, m }) => (
                  <Link key={`${c.id}-${m.id}`} href="/dashboard/pool" className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm hover:border-primary/50">
                    <span className="min-w-0"><span className="block truncate font-medium">{m.title}</span><span className="block truncate text-xs text-muted-foreground">{c.title} · {c.freelancerName}</span></span>
                    <Badge variant="warning">Review {formatCurrency(m.amount)}</Badge>
                  </Link>
                ))}
                {waiting.slice(0, 3).map((j) => (
                  <Link key={j.id} href="/dashboard/automation" className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm hover:border-primary/50">
                    <span className="min-w-0"><span className="block truncate font-medium">{j.title || "Automation job"}</span><span className="block truncate text-xs text-muted-foreground">{j.platform || "all platforms"}</span></span>
                    <Badge variant="warning">Approve</Badge>
                  </Link>
                ))}
                {toReview.length === 0 && waiting.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">Nothing is waiting on you.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base"><Mail className="size-4 text-primary" /> Latest Upwork leads</CardTitle>
                <Button asChild variant="ghost" size="sm"><Link href="/dashboard/gigs">All gigs</Link></Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {newLeads.slice(0, 5).map((l) => (
                  <Link key={l.id} href="/dashboard/gigs" className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm hover:border-primary/50">
                    <span className="min-w-0 truncate font-medium">{l.title}</span>
                    {l.budget && <span className="shrink-0 text-xs text-muted-foreground">{l.budget}</span>}
                  </Link>
                ))}
                {newLeads.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No new leads. Forward your Upwork job-alert emails to your Autopilot address, or paste one on the Gigs page. You review each lead and submit proposals yourself.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 text-primary" /> Recent activity</CardTitle></CardHeader>
              <CardContent>
                {recent.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  <ul className="divide-y">
                    {recent.map((r, i) => (
                      <li key={r.id ?? i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <span className="min-w-0"><span className="font-medium">{r.agent}</span> <span className="text-muted-foreground">{r.action}</span></span>
                        <span className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={r.status} />
                          <span className="hidden text-xs text-muted-foreground sm:inline">{formatRelative(r.time ?? r.created_at)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Workflow className="size-4 text-primary" /> Coming soon</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-start gap-3 rounded-lg border border-dashed p-3">
                  <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div><p className="font-medium">Calendar</p><p className="text-xs text-muted-foreground">Milestone deadlines and meetings in one view. Not built yet.</p></div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-dashed p-3">
                  <Inbox className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div><p className="font-medium">Revenue and margin reporting</p><p className="text-xs text-muted-foreground">Shown only once there is real invoiced revenue to report on.</p></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
