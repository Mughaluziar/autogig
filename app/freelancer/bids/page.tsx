"use client";
import { FileText, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadState } from "@/components/shared/load-state";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { DataTable, type Column } from "@/components/dashboard/data-table";
import { freelancerMyBids as demoBids } from "@/lib/mock-data";
import { usePool, type PoolBid } from "@/lib/pool";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function FreelancerBidsPage() {
  const pool = usePool<PoolBid[]>("/api/pool/my-bids", demoBids as unknown as PoolBid[]);
  const bids = pool.data ?? [];
  const columns: Column<PoolBid>[] = [
    { key: "spec", header: "Spec", render: (r) => <span className="font-medium">{r.spec}</span> },
    { key: "hours", header: "Hours", render: (r) => `${r.hours}h` },
    { key: "rate", header: "Rate", render: (r) => `${formatCurrency(r.rate)}/h` },
    { key: "total", header: "Total", render: (r) => <span className="font-semibold">{formatCurrency(r.total)}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "submitted", header: "Submitted", render: (r) => <span className="text-muted-foreground">{r.submitted ? formatDate(r.submitted) : "—"}</span> },
  ];
  return (
    <>
      <PageHeader title="My Bids" description="All your bids across the blind-auction pool." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Bids" value={String(bids.length)} icon={<FileText className="size-5" />} href="/freelancer/specs" />
        <StatCard label="Awarded" value={String(bids.filter((b) => b.status.toLowerCase() === "awarded").length)} icon={<TrendingUp className="size-5" />} href="/freelancer/contracts" />
        <StatCard label="Open Bid Value" value={formatCurrency(bids.filter((b) => b.status === "submitted").reduce((a, b) => a + (b.total || 0), 0))} icon={<FileText className="size-5" />} href="/freelancer/specs" />
      </div>
      <div className="mt-6">
        <LoadState loading={pool.loading} error={pool.error} onRetry={pool.reload} />
        {!pool.loading && !pool.error && (bids.length ? (
          <DataTable columns={columns} data={bids} searchKeys={["spec"]} searchPlaceholder="Search bids..." />
        ) : (
          <EmptyState title="No bids yet" description="Bid on an open spec and it appears here." />
        ))}
      </div>
    </>
  );
}
