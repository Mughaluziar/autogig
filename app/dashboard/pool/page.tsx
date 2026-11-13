"use client";
import * as React from "react";
import { Check, Plus, Trophy, Undo2, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadState } from "@/components/shared/load-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { API_URL } from "@/lib/api";
import { poolAction, usePool, type PoolContract, type PoolEarning, type PoolSpec } from "@/lib/pool";
import { formatCurrency, formatDate } from "@/lib/utils";

const NEW_SPEC = { title: "", summary: "", stack: "", estHours: "", deadline: "", maxRate: "" };

/** Agency view of the freelancer pool: broadcast specs, read the blind bids, award, review milestones, record payouts. */
export default function PoolPage() {
  const { toast } = useToast();
  const specs = usePool<PoolSpec[]>("/api/pool/admin/specs");
  const contracts = usePool<PoolContract[]>("/api/pool/admin/contracts");
  const earnings = usePool<{ entries: PoolEarning[]; owed: number; note: string }>("/api/pool/admin/earnings");
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(NEW_SPEC);
  const [formError, setFormError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [reason, setReason] = React.useState<Record<string, string>>({});
  const reloadAll = () => { specs.reload(); contracts.reload(); earnings.reload(); };

  const act = async (path: string, body: unknown, ok: string) => {
    const res = await poolAction(path, body);
    if (res.error) { toast({ title: "That didn't work", description: res.error }); return false; }
    toast({ title: ok, variant: "success" });
    reloadAll();
    return true;
  };

  const createSpec = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setBusy(true);
    const res = await poolAction("/api/pool/admin/specs", {
      title: form.title, summary: form.summary, stack: form.stack.split(",").map((s) => s.trim()).filter(Boolean),
      estHours: Number(form.estHours), deadline: form.deadline, ...(form.maxRate ? { maxRate: Number(form.maxRate) } : {}),
    });
    setBusy(false);
    if (res.error) { setFormError(res.error); return; }
    toast({ title: "Spec broadcast", description: "Freelancers can bid on it now.", variant: "success" });
    setOpen(false); setForm(NEW_SPEC); reloadAll();
  };

  if (!API_URL) {
    return (
      <>
        <PageHeader title="Freelancer Pool" description="Broadcast work to freelancers and award the best bid." />
        <EmptyState title="The pool needs the backend" description="This demo build has no account data." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Freelancer Pool" description="Broadcast a spec, read the blind bids, award one, review milestones and record payouts."
        actions={<Button variant="gradient" onClick={() => setOpen(true)}><Plus className="size-4" /> New spec</Button>} />
      <Tabs defaultValue="specs">
        <TabsList>
          <TabsTrigger value="specs">Specs</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="earnings">Payouts</TabsTrigger>
        </TabsList>

        <TabsContent value="specs" className="mt-4 space-y-4">
          <LoadState loading={specs.loading} error={specs.error} onRetry={specs.reload} />
          {!specs.loading && !specs.error && !specs.data?.length && <EmptyState title="No specs yet" description="Broadcast your first spec to the freelancer pool." />}
          {specs.data?.map((s) => (
            <Card key={s.id}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base">{s.title}</CardTitle>
                <div className="flex items-center gap-2"><Badge variant="outline">{s.bidsIn} bid{s.bidsIn === 1 ? "" : "s"}</Badge><StatusBadge status={s.status} /></div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{s.estHours} h est. · due {formatDate(s.deadline)}{s.maxRate ? ` · max ${formatCurrency(s.maxRate)}/h` : ""} · {(s.stack ?? []).join(", ")}</p>
                {s.bids && s.bids.length > 0 && (
                  <ul className="divide-y rounded-lg border">
                    {s.bids.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                        <span><b>{b.freelancerName}</b> · {b.hours}h × {formatCurrency(b.rate)} = <b>{formatCurrency(b.total)}</b>{b.note && <span className="block text-xs text-muted-foreground">{b.note}</span>}</span>
                        <span className="flex items-center gap-2">
                          <StatusBadge status={b.status} />
                          {s.status === "open" && b.status === "submitted" && (
                            <Button size="sm" variant="gradient" onClick={() => void act(`/api/pool/admin/specs/${s.id}/award`, { bidId: b.id }, "Awarded: contract created")}><Trophy className="size-4" /> Award</Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {s.status === "open" && <Button size="sm" variant="outline" onClick={() => void act(`/api/pool/admin/specs/${s.id}/close`, {}, "Spec closed")}><X className="size-4" /> Close without awarding</Button>}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="contracts" className="mt-4 space-y-4">
          <LoadState loading={contracts.loading} error={contracts.error} onRetry={contracts.reload} />
          {!contracts.loading && !contracts.error && !contracts.data?.length && <EmptyState title="No contracts yet" description="Award a bid and the contract appears here." />}
          {contracts.data?.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base">{c.title} <span className="text-sm font-normal text-muted-foreground">· {c.freelancerName}</span></CardTitle>
                <div className="flex items-center gap-2"><span className="font-semibold">{formatCurrency(c.value)}</span><StatusBadge status={c.status} /></div>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-lg border">
                  {c.milestones.map((m) => (
                    <li key={m.id} className="space-y-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{m.title} <span className="text-muted-foreground">· {formatCurrency(m.amount)}</span></span>
                        <StatusBadge status={m.status} />
                      </div>
                      {m.deliveryNote && <p className="text-xs text-muted-foreground">Delivery note: {m.deliveryNote}</p>}
                      {m.status === "delivered" && (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                          <Button size="sm" variant="gradient" onClick={() => void act(`/api/pool/admin/contracts/${c.id}/milestones/${m.id}/approve`, {}, "Milestone approved")}><Check className="size-4" /> Approve</Button>
                          <Input aria-label={`Reason for sending ${m.title} back`} placeholder="What needs to change?" value={reason[`${c.id}${m.id}`] ?? ""}
                            onChange={(e) => setReason({ ...reason, [`${c.id}${m.id}`]: e.target.value })} />
                          <Button size="sm" variant="outline" disabled={!(reason[`${c.id}${m.id}`] ?? "").trim()}
                            onClick={() => void act(`/api/pool/admin/contracts/${c.id}/milestones/${m.id}/reject`, { reason: reason[`${c.id}${m.id}`] }, "Sent back")}><Undo2 className="size-4" /> Send back</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="earnings" className="mt-4 space-y-4">
          <LoadState loading={earnings.loading} error={earnings.error} onRetry={earnings.reload} />
          {earnings.data && (
            <>
              <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">{earnings.data.note} Owed now: <b className="text-foreground">{formatCurrency(earnings.data.owed)}</b>.</p>
              {!earnings.data.entries.length && <EmptyState title="Nothing to pay yet" description="Approving a milestone creates an amount owed to the freelancer." />}
              <ul className="divide-y rounded-lg border">
                {earnings.data.entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span><b>{e.freelancerName}</b> · {e.contract} · {e.milestone}</span>
                    <span className="flex items-center gap-2">
                      <b>{formatCurrency(e.amount)}</b>
                      {e.status === "paid" ? <StatusBadge status="paid" /> : (
                        <Button size="sm" variant="outline" onClick={() => void act(`/api/pool/admin/earnings/${e.id}/mark-paid`, {}, "Payout recorded")}>I paid this</Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>Broadcast a spec</DialogTitle>
          <DialogDescription>Every freelancer in the pool can see it and bid. Bids are blind to other freelancers.</DialogDescription>
        </DialogHeader>
        <form onSubmit={createSpec} className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="sp-title">Title</Label><Input id="sp-title" required minLength={3} maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="sp-sum">What needs building</Label><Textarea id="sp-sum" rows={4} maxLength={4000} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="sp-stack">Stack (comma-separated)</Label><Input id="sp-stack" value={form.stack} onChange={(e) => setForm({ ...form, stack: e.target.value })} placeholder="React, Node.js" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label htmlFor="sp-hours">Est. hours</Label><Input id="sp-hours" type="number" min={1} required value={form.estHours} onChange={(e) => setForm({ ...form, estHours: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sp-due">Deadline</Label><Input id="sp-due" type="date" required value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sp-max">Max $/h</Label><Input id="sp-max" type="number" min={1} step="0.01" value={form.maxRate} onChange={(e) => setForm({ ...form, maxRate: e.target.value })} /></div>
          </div>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="gradient" disabled={busy}>{busy ? "Broadcasting…" : "Broadcast"}</Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
