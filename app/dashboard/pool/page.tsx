"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, MessageSquare, Plus, Trophy, Undo2, X } from "lucide-react";
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
import { Inbox, StartConversationDialog } from "@/components/messages/inbox";
import { API_URL } from "@/lib/api";
import { useUnreadMessages } from "@/lib/messages";
import { poolAction, usePool, type PoolContract, type PoolEarning, type PoolSpec } from "@/lib/pool";
import { formatCurrency, formatDate } from "@/lib/utils";

const NEW_SPEC = { title: "", summary: "", stack: "", estHours: "", deadline: "", maxRate: "" };

const TABS = ["specs", "contracts", "earnings", "messages"];
type MessageTarget = { specId: string; freelancerId: string; title: string; to: string };

/** Agency view of the freelancer pool: broadcast specs, read the blind bids, award, review milestones, record payouts,
 *  and message the freelancers. The open tab and conversation live in the URL (?tab=messages&thread=...). */
export default function PoolPage() {
  return (
    <React.Suspense fallback={<div className="h-64 animate-pulse rounded-xl border bg-card" aria-busy="true" />}>
      <Pool />
    </React.Suspense>
  );
}

function Pool() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = TABS.includes(params.get("tab") ?? "") ? params.get("tab")! : "specs";
  const thread = params.get("thread");
  const go = (next: string, threadId?: string | null) =>
    router.replace(`${pathname}?tab=${next}${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}`, { scroll: false });
  const unread = useUnreadMessages(Boolean(API_URL));
  const [messageTarget, setMessageTarget] = React.useState<MessageTarget | null>(null);
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
      <Tabs value={tab} onValueChange={(v) => go(v)}>
        <TabsList>
          <TabsTrigger value="specs">Specs</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="earnings">Payouts</TabsTrigger>
          <TabsTrigger value="messages">Messages{unread > 0 && <Badge variant="destructive" className="ml-1.5 h-5 px-1.5">{unread}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value="specs" className="mt-4 space-y-4">
          <LoadState loading={specs.loading} error={specs.error} onRetry={specs.reload} />
          {!specs.loading && !specs.error && !specs.data?.length && <EmptyState title="No specs yet" description="Broadcast your first spec to the freelancer pool." />}
          {specs.data?.map((s) => {
            // Open specs count the bids still waiting; once awarded or closed, the bids it received.
            const bidCount = s.status === "open" ? s.bidsIn : (s.bids?.length ?? s.bidsIn);
            return (
            <Card key={s.id}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base">{s.title}</CardTitle>
                <div className="flex items-center gap-2"><Badge variant="outline">{bidCount} bid{bidCount === 1 ? "" : "s"}</Badge><StatusBadge status={s.status} /></div>
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
                          {b.freelancerId && (
                            <Button size="sm" variant="ghost" aria-label={`Message ${b.freelancerName}`}
                              onClick={() => setMessageTarget({ specId: s.id, freelancerId: b.freelancerId!, title: s.title, to: b.freelancerName ?? "the freelancer" })}>
                              <MessageSquare className="size-4" />
                            </Button>
                          )}
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
            );
          })}
        </TabsContent>

        <TabsContent value="contracts" className="mt-4 space-y-4">
          <LoadState loading={contracts.loading} error={contracts.error} onRetry={contracts.reload} />
          {!contracts.loading && !contracts.error && !contracts.data?.length && <EmptyState title="No contracts yet" description="Award a bid and the contract appears here." />}
          {contracts.data?.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base">{c.title} <span className="text-sm font-normal text-muted-foreground">· {c.freelancerName}</span></CardTitle>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{formatCurrency(c.value)}</span><StatusBadge status={c.status} />
                  {c.freelancerId && (
                    <Button size="sm" variant="outline" onClick={() => setMessageTarget({ specId: c.specId, freelancerId: c.freelancerId!, title: c.title, to: c.freelancerName })}>
                      <MessageSquare className="size-4" /> Message
                    </Button>
                  )}
                </div>
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

        <TabsContent value="messages" className="mt-4">
          <Inbox side="agency" selectedId={thread} onSelect={(id) => go("messages", id)} />
        </TabsContent>
      </Tabs>

      <StartConversationDialog target={messageTarget} onClose={() => setMessageTarget(null)}
        onStarted={(id) => { setMessageTarget(null); toast({ title: "Message sent", variant: "success" }); go("messages", id); }} />

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
