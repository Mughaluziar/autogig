"use client";
import * as React from "react";
import { ExternalLink, Loader2, RefreshCw, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { useToast } from "@/components/ui/toast";
import { API_URL, apiCall, apiGet } from "@/lib/api";
import { DEMO_EVENTS } from "@/lib/orders-demo";
import { DETECTION_LABELS, formatMoney, titleCase, type Order, type OrderAccount, type OrderEvent } from "@/lib/orders";
import { formatDate, formatRelative } from "@/lib/utils";
import { VerificationBadge } from "./orders-table";

const EVENT_DOT: Record<OrderEvent["status"], string> = {
  success: "bg-success", info: "bg-primary", warning: "bg-warning", error: "bg-destructive",
};

export function EventTimeline({ events }: { events: OrderEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No events recorded yet.</p>;
  return (
    <ol className="space-y-2.5">
      {events.map((e) => (
        <li key={e.id} className="flex gap-2.5 text-sm">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${EVENT_DOT[e.status] ?? "bg-muted-foreground"}`} />
          <div className="min-w-0">
            <p className="break-words">{e.message}</p>
            <p className="text-xs text-muted-foreground">{titleCase(e.type)} · {formatRelative(e.time)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

export function OrderDetailDialog({
  order, accounts, onClose, onChanged,
}: {
  order: Order | null;
  accounts: OrderAccount[];
  onClose: () => void;
  onChanged: (order: Order | null) => void;
}) {
  const { toast } = useToast();
  const [events, setEvents] = React.useState<OrderEvent[]>([]);
  const [busy, setBusy] = React.useState<"verify" | "dismiss" | "assign" | null>(null);
  const [assignTo, setAssignTo] = React.useState("");
  const orderId = order?.id;

  React.useEffect(() => {
    setAssignTo("");
    if (!orderId) return;
    if (!API_URL) {
      setEvents(DEMO_EVENTS.filter((e) => e.orderId === orderId));
      return;
    }
    let cancelled = false;
    apiGet<Order & { events: OrderEvent[] }>(`/api/orders/${encodeURIComponent(orderId)}`).then((res) => {
      if (!cancelled) setEvents(res?.events ?? []);
    });
    return () => { cancelled = true; };
  }, [orderId, order?.updatedAt]);

  if (!order) return null;
  const verified = order.verification.status === "verified";
  const sameplatformAccounts = accounts.filter((a) => a.platform === order.platform && a.id !== order.accountId);

  const act = async (kind: "verify" | "dismiss" | "assign") => {
    if (!API_URL) {
      toast({ title: "Sample data", description: "Connect the backend to verify real orders." });
      return;
    }
    setBusy(kind);
    const res = kind === "assign"
      ? await apiCall<Order>(`/api/orders/${encodeURIComponent(order.id)}/account`, { accountId: assignTo }, "PATCH")
      : await apiCall<Order>(`/api/orders/${encodeURIComponent(order.id)}/${kind}`, {});
    setBusy(null);
    if (!res || res.status >= 400) {
      toast({ title: "Action failed", description: (res?.data as { detail?: string } | undefined)?.detail ?? "Can't reach the server." });
      return;
    }
    onChanged(res.data);
    const v = res.data.verification;
    toast({
      title: kind === "verify" ? `Verification: ${titleCase(v.status)}` : kind === "dismiss" ? "Order dismissed" : "Account linked",
      description: v.reason,
      variant: v.status === "verified" ? "success" : undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle className="pr-6">{order.dataExpired ? `${order.platform} order` : order.title ?? `${order.platform} order`}</DialogTitle>
        <DialogDescription>
          {order.platform} · {order.accountLabel} · {order.externalOrderId ? <span className="font-mono">{order.externalOrderId}</span> : "no order ID"}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <section className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <VerificationBadge status={order.verification.status} />
            {order.verification.attempts > 0 && (
              <span className="text-xs text-muted-foreground">{order.verification.attempts} check{order.verification.attempts === 1 ? "" : "s"}</span>
            )}
          </div>
          <p className="mt-2 text-sm">{order.verification.reason}</p>
          {order.verification.verifiedAt && (
            <p className="mt-1 text-xs text-muted-foreground">Verified {formatRelative(order.verification.verifiedAt)} through the platform API.</p>
          )}
          {order.verification.nextAttemptAt && !verified && (
            <p className="mt-1 text-xs text-muted-foreground">Next automatic check {formatRelative(order.verification.nextAttemptAt).replace(" ago", "")}.</p>
          )}
          {order.dataExpired && (
            <p className="mt-2 text-xs text-warning">Platform details were cleared under the platform&apos;s data-retention terms. They return on the next successful sync.</p>
          )}
        </section>

        <dl className="grid grid-cols-2 gap-3">
          <Field label="Client">{order.clientName ?? order.clientId ?? "—"}</Field>
          <Field label="Amount">{formatMoney(order.amount, order.currency)}</Field>
          <Field label="Status"><StatusBadge status={titleCase(order.status)} /> <span className="text-xs text-muted-foreground">from {DETECTION_LABELS[order.statusSource] ?? order.statusSource}</span></Field>
          <Field label="Created">{formatDate(order.orderCreatedAt ?? order.detectedAt)}</Field>
          <Field label="Detected via">{order.detectedVia.map((d) => DETECTION_LABELS[d] ?? d).join(", ")}</Field>
          <Field label="Last platform sync">{order.lastSyncedAt ? formatRelative(order.lastSyncedAt) : "Never"}</Field>
        </dl>

        {order.milestones.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Milestones</h3>
            <ul className="divide-y rounded-lg border text-sm">
              {order.milestones.map((m) => (
                <li key={m.externalId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate">{m.title || m.externalId}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">{formatMoney(m.amount, m.currency)}</span>
                    {m.status && <StatusBadge status={titleCase(m.status)} />}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!verified && sameplatformAccounts.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">{order.accountId ? "Move to another account" : "Link to an account"}</h3>
            <div className="flex gap-2">
              <div className="flex-1">
                <Select aria-label="Account" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                  <option value="">Choose a {order.platform} account</option>
                  {sameplatformAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </Select>
              </div>
              <Button variant="outline" disabled={!assignTo || busy !== null} onClick={() => void act("assign")}>
                {busy === "assign" && <Loader2 className="animate-spin" />} Link
              </Button>
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold">Audit trail</h3>
          <EventTimeline events={events} />
        </section>
      </div>

      <DialogFooter className="flex-wrap">
        {order.url && (
          <Button variant="ghost" asChild>
            <a href={order.url} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open on {order.platform}</a>
          </Button>
        )}
        {!verified && !order.verification.dismissed && (
          <Button variant="outline" disabled={busy !== null} onClick={() => void act("dismiss")}>
            {busy === "dismiss" ? <Loader2 className="animate-spin" /> : <ShieldX />} Not genuine
          </Button>
        )}
        {order.verification.status !== "unverifiable" && (
          <Button disabled={busy !== null} onClick={() => void act("verify")}>
            {busy === "verify" ? <Loader2 className="animate-spin" /> : <RefreshCw />} {verified ? "Re-check" : "Verify now"}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
