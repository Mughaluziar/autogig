"use client";
import { Banknote, TrendingUp, Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadState } from "@/components/shared/load-state";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { SimpleLineChart } from "@/components/charts/charts";
import { DataTable, type Column } from "@/components/dashboard/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { API_URL } from "@/lib/api";
import { usePool, type PoolEarning } from "@/lib/pool";
import { formatCurrency, formatDate } from "@/lib/utils";

type Earnings = { summary: { totalEarned: number; pendingPayout: number; paid: number; thisMonth: number }; entries: PoolEarning[]; payoutsNote: string };

export default function FreelancerEarningsPage() {
  const pool = usePool<Earnings>("/api/pool/earnings", null);
  const data = pool.data;
  const entries = data?.entries ?? [];
  const cols: Column<PoolEarning>[] = [
    { key: "contract", header: "Contract", render: (r) => <span className="font-medium">{r.contract}<span className="block text-xs font-normal text-muted-foreground">{r.milestone}</span></span> },
    { key: "amount", header: "Amount", render: (r) => <span className="font-semibold">{formatCurrency(r.amount)}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status === "approved" ? "pending" : r.status} /> },
    { key: "date", header: "Approved", render: (r) => (r.approvedAt ? formatDate(r.approvedAt) : "—") },
  ];
  const byMonth = Object.entries(entries.reduce<Record<string, number>>((acc, e) => {
    const key = (e.approvedAt ?? "").slice(0, 7);
    if (key) acc[key] = (acc[key] ?? 0) + e.amount;
    return acc;
  }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));
  const money = (v?: number) => (API_URL && data ? formatCurrency(v ?? 0) : "—");

  return (
    <>
      <PageHeader title="Earnings" description="Money you've earned from approved milestones, and what your agency has recorded as paid." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Earned" value={money(data?.summary.totalEarned)} icon={<Wallet className="size-5" />} href="/freelancer/contracts" />
        <StatCard label="Awaiting Payout" value={money(data?.summary.pendingPayout)} icon={<Banknote className="size-5" />} href="/freelancer/earnings" />
        <StatCard label="This Month" value={money(data?.summary.thisMonth)} icon={<TrendingUp className="size-5" />} href="/freelancer/earnings" />
      </div>
      <LoadState loading={pool.loading} error={pool.error} onRetry={pool.reload} />
      {data && (
        <>
          <p className="mt-4 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">{data.payoutsNote}</p>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Earnings Over Time</CardTitle></CardHeader>
              <CardContent>{byMonth.length ? <SimpleLineChart data={byMonth} dataKey="amount" /> : <EmptyState title="No earnings yet" description="Approved milestones show up here." />}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Payout History</CardTitle></CardHeader>
              <CardContent>{entries.length ? <DataTable columns={cols} data={entries} /> : <EmptyState title="Nothing to pay out yet" description="An earning is created when your agency approves a delivered milestone." />}</CardContent>
            </Card>
          </div>
        </>
      )}
      {!API_URL && <EmptyState title="Earnings need the backend" description="This demo build has no account data." />}
    </>
  );
}
