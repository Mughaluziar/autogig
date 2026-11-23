"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FolderKanban, MessageSquare, Send } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadState } from "@/components/shared/load-state";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { StartConversationDialog } from "@/components/messages/inbox";
import { freelancerContracts as demoContracts } from "@/lib/mock-data";
import { API_URL } from "@/lib/api";
import { poolAction, usePool, type PoolContract } from "@/lib/pool";
import { formatCurrency } from "@/lib/utils";

/** The frontend-only demo has no milestones: its sample rows are shown read-only. */
const demoRows = (demoContracts as any[]).map((c) => ({ id: c.id, title: c.title, value: c.value, status: "active",
  milestonesDone: c.milestonesDone, milestonesTotal: c.milestonesTotal, milestones: [] })) as unknown as PoolContract[];

export default function FreelancerContractsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const pool = usePool<PoolContract[]>("/api/pool/my-contracts", demoRows);
  const [ask, setAsk] = React.useState<{ specId: string; title: string; to: string } | null>(null);
  const contracts = pool.data ?? [];
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState("");

  const deliver = async (contract: PoolContract, milestoneId: string) => {
    const key = `${contract.id}:${milestoneId}`;
    setBusy(key);
    const res = await poolAction(`/api/pool/contracts/${encodeURIComponent(contract.id)}/milestones/${encodeURIComponent(milestoneId)}/deliver`, { note: notes[key] ?? "" });
    setBusy("");
    if (res.error) { toast({ title: "Couldn't mark it delivered", description: res.error }); return; }
    toast({ title: "Sent for review", description: "Your agency has been notified.", variant: "success" });
    pool.reload();
  };

  const active = contracts.filter((c) => c.status === "active");
  return (
    <>
      <PageHeader title="My Contracts" description="Contracts awarded to you through the blind-auction process. Deliver each milestone; your agency reviews it." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active Contracts" value={String(active.length)} icon={<FolderKanban className="size-5" />} href="/freelancer/contracts" />
        <StatCard label="Total Value" value={formatCurrency(contracts.reduce((a, c) => a + (c.value || 0), 0))} icon={<FolderKanban className="size-5" />} href="/freelancer/earnings" />
        <StatCard label="Awaiting Review" value={String(contracts.reduce((a, c) => a + c.milestones.filter((m) => m.status === "delivered").length, 0))} icon={<Send className="size-5" />} href="/freelancer/contracts" />
      </div>
      <div className="mt-6 space-y-4">
        <LoadState loading={pool.loading} error={pool.error} onRetry={pool.reload} />
        {!pool.loading && !pool.error && !contracts.length && (
          <EmptyState title="No contracts yet" description="When an agency awards one of your bids, the contract and its milestones appear here." />
        )}
        {contracts.map((c) => (
          <Card key={c.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base">{c.title}</CardTitle>
              <div className="flex items-center gap-3">
                <span className="font-semibold">{formatCurrency(c.value)}</span><StatusBadge status={c.status} />
                {API_URL && c.specId && (
                  <Button size="sm" variant="outline" onClick={() => setAsk({ specId: c.specId, title: c.title, to: "your agency" })}>
                    <MessageSquare className="size-4" /> Message agency
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-w-xs">
                <div className="mb-1 text-xs text-muted-foreground">{c.milestonesDone}/{c.milestonesTotal} milestones approved</div>
                <Progress value={c.milestonesTotal ? (c.milestonesDone / c.milestonesTotal) * 100 : 0} />
              </div>
              <ul className="divide-y rounded-lg border">
                {c.milestones.map((m) => {
                  const key = `${c.id}:${m.id}`;
                  return (
                    <li key={m.id} className="space-y-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{m.title} <span className="text-muted-foreground">· {formatCurrency(m.amount)}</span></span>
                        <StatusBadge status={m.status} />
                      </div>
                      {m.rejectionNote && m.status === "pending" && <p className="rounded-md bg-warning/10 p-2 text-xs"><b>Changes requested:</b> {m.rejectionNote}</p>}
                      {m.status === "pending" && c.status === "active" && API_URL && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Textarea rows={2} maxLength={2000} placeholder="Delivery note: what you did, where to find it (optional)" aria-label={`Delivery note for ${m.title}`}
                            value={notes[key] ?? ""} onChange={(e) => setNotes({ ...notes, [key]: e.target.value })} />
                          <Button size="sm" variant="gradient" disabled={busy === key} onClick={() => void deliver(c, m.id)}><CheckCircle2 className="size-4" /> Mark delivered</Button>
                        </div>
                      )}
                      {m.status === "delivered" && <p className="text-xs text-muted-foreground">Waiting for your agency to review.</p>}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
      <StartConversationDialog target={ask} onClose={() => setAsk(null)}
        onStarted={(id) => { setAsk(null); router.push(`/freelancer/messages?thread=${encodeURIComponent(id)}`); }} />
    </>
  );
}
