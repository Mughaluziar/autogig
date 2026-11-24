"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Gavel, MessageSquare, Undo2, Zap } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadState } from "@/components/shared/load-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { DataTable, type Column } from "@/components/dashboard/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { StartConversationDialog } from "@/components/messages/inbox";
import { freelancerOpenSpecs as demoSpecs } from "@/lib/mock-data";
import { API_URL } from "@/lib/api";
import { poolAction, usePool, type BidCredits, type PoolSpec } from "@/lib/pool";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function FreelancerSpecsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const pool = usePool<PoolSpec[]>("/api/pool/specs", demoSpecs as unknown as PoolSpec[]);
  const credit = usePool<BidCredits>("/api/pool/bid-credits", null);
  const [target, setTarget] = React.useState<PoolSpec | null>(null);
  const [ask, setAsk] = React.useState<{ specId: string; title: string; to: string } | null>(null);
  const [hours, setHours] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const open = (spec: PoolSpec) => {
    setTarget(spec);
    setHours(String(spec.myBid?.hours ?? spec.estHours));
    setRate(spec.myBid ? String(spec.myBid.rate) : "");
    setNote(spec.myBid?.note ?? "");
    setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    if (!API_URL) { setError("Bidding needs the backend, which isn't connected in this demo build."); return; }
    const h = Number(hours), r = Number(rate);
    if (!Number.isInteger(h) || h < 1) { setError("Enter whole hours, at least 1."); return; }
    if (!(r > 0)) { setError("Enter your hourly rate."); return; }
    setBusy(true);
    const res = await poolAction(`/api/pool/specs/${encodeURIComponent(target.id)}/bid`, { hours: h, rate: r, note });
    setBusy(false);
    if (res.error) { setError(res.error); credit.reload(); return; }
    toast({ title: res.data.updated ? "Bid updated" : "Bid placed", description: `${formatCurrency(res.data.total)} on "${target.title}". Other freelancers can't see it.`, variant: "success" });
    setTarget(null);
    pool.reload();
    credit.reload();
  };

  const withdraw = async (spec: PoolSpec) => {
    const res = await poolAction(`/api/pool/specs/${encodeURIComponent(spec.id)}/bid`, undefined, "DELETE");
    if (res.error) { toast({ title: "Couldn't withdraw", description: res.error }); return; }
    toast({ title: "Bid withdrawn" });
    pool.reload();
  };

  // Editing, or bidding again on a spec you already paid a credit for, is free (the server decides; this only explains).
  const free = Boolean(target && (target.myBid || credit.data?.used.some((u) => u.specId === target.id)));

  const columns: Column<PoolSpec>[] = [
    { key: "title", header: "Spec", render: (r) => <span className="font-medium">{r.title}</span> },
    { key: "stack", header: "Stack", render: (r) => <div className="flex flex-wrap gap-1">{(r.stack ?? []).map((t) => <Badge key={t} variant="secondary" className="text-[11px]">{t}</Badge>)}</div> },
    { key: "estHours", header: "Est. Hours", render: (r) => r.estHours },
    { key: "deadline", header: "Deadline", render: (r) => formatDate(r.deadline) },
    { key: "bidsIn", header: "Bids In", render: (r) => <Badge variant="outline">{r.bidsIn}</Badge> },
    { key: "myBid", header: "Your bid", render: (r) => r.myBid ? <span className="font-medium">{formatCurrency(r.myBid.total)}</span> : <span className="text-muted-foreground">—</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "action", header: "",
      render: (r) => (
        <div className="flex gap-1.5">
          <Button size="sm" variant="gradient" onClick={() => open(r)}><Gavel className="size-4" /> {r.myBid ? "Edit bid" : "Bid"}</Button>
          {API_URL && <Button size="sm" variant="outline" onClick={() => setAsk({ specId: r.id, title: r.title, to: "the agency" })} aria-label={`Ask the agency about ${r.title}`}><MessageSquare className="size-4" /> Ask</Button>}
          {r.myBid && API_URL && <Button size="sm" variant="ghost" onClick={() => void withdraw(r)} aria-label={`Withdraw bid on ${r.title}`}><Undo2 className="size-4" /></Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Open Specs" description="Work agencies have broadcast to the freelancer pool. Bids are blind: you see how many bids are in, never anyone else's." />
      <LoadState loading={pool.loading} error={pool.error} onRetry={pool.reload} />
      {!pool.loading && !pool.error && (pool.data?.length ? (
        <DataTable columns={columns} data={pool.data} searchKeys={["title"]} searchPlaceholder="Search specs..." />
      ) : (
        <EmptyState title="No open specs right now" description="When an agency broadcasts a spec it appears here. Check back soon." />
      ))}

      <Dialog open={Boolean(target)} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogHeader>
          <DialogTitle>{target?.myBid ? "Edit your bid" : "Place a bid"}</DialogTitle>
          <DialogDescription>{target?.title}: about {target?.estHours} hours.{target?.maxRate ? ` The agency's maximum rate is ${formatCurrency(target.maxRate)}/h.` : ""}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bid-hours">Hours</Label>
              <Input id="bid-hours" type="number" min={1} step={1} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bid-rate">Rate (USD/hour)</Label>
              <Input id="bid-rate" type="number" min={0.01} step="0.01" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Total: <span className="font-semibold text-foreground">{formatCurrency((Number(hours) || 0) * (Number(rate) || 0))}</span></p>
          <div className="space-y-1.5">
            <Label htmlFor="bid-note">Note to the agency (optional)</Label>
            <Textarea id="bid-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {target && <CreditLine credits={credit.data} free={free} />}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
            <Button type="submit" variant="gradient" disabled={busy || (!free && outOfCredits(credit.data))}>{busy ? "Saving…" : target?.myBid ? "Update bid" : "Place bid"}</Button>
          </DialogFooter>
        </form>
      </Dialog>

      <StartConversationDialog target={ask} onClose={() => setAsk(null)}
        onStarted={(id) => { setAsk(null); router.push(`/freelancer/messages?thread=${encodeURIComponent(id)}`); }} />
    </>
  );
}

const outOfCredits = (c: BidCredits | null) => Boolean(c && c.enabled && !c.unlimited && c.left <= 0);

/** What placing this bid costs, from the server's own count. */
function CreditLine({ credits, free }: { credits: BidCredits | null; free: boolean }) {
  if (!credits || !credits.enabled) return null;
  if (credits.unlimited) return <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Zap className="size-3.5 text-primary" /> Pro plan: unlimited bids.</p>;
  if (free) return <p className="text-xs text-muted-foreground">No credit needed: you already used one on this spec.</p>;
  if (credits.left <= 0) {
    return (
      <p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
        You&apos;re out of bid credits. <Link href="/freelancer/billing" className="font-medium text-primary hover:underline">Get more bids or upgrade</Link> to keep bidding.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Uses 1 of your {credits.left} bid credit{credits.left === 1 ? "" : "s"}. <Link href="/freelancer/billing" className="text-primary hover:underline">Plans &amp; credits</Link>
    </p>
  );
}
