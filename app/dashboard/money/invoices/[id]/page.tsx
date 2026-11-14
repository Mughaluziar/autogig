"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, Circle, Copy, CopyPlus, ExternalLink, FileText, History, Link2, Loader2, Pencil, Send, Trash2, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/components/money/money-provider";
import { InvoicePreview } from "@/components/money/invoice-preview";
import { ClientMark, fmtDate, fmtDateTime, isOnline, methodsOf, money, StatusPill } from "@/components/money/format";
import { amountDue, effectiveStatus, PAID_VIA_LABEL, payableParts, todayStr } from "@/lib/ledger";
import { cn } from "@/lib/utils";

export default function InvoiceDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = React.use(props.params);
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { L, canLink, payStatus, links, share, linkBusy, removeInvoice, copy, payUrl } = useMoney();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const i = L.invoices.find((x) => x.id === params.id);

  if (!L.ready) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading invoice…</div>;
  if (!i) {
    return (
      <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <FileText className="size-8 text-muted-foreground/60" /><p className="font-medium">This invoice doesn&apos;t exist</p>
        <p className="text-sm text-muted-foreground">It may have been deleted.</p>
        <Button variant="outline" asChild><Link href="/dashboard/money/invoices">Back to invoices</Link></Button>
      </CardContent></Card>
    );
  }

  const st = effectiveStatus(i);
  const parts = payableParts(i);
  const paid = parts.filter((m) => m.status === "Paid");
  const left = amountDue(i);
  const anyPaid = paid.length > 0;
  const split = !!i.milestones?.length;
  const link = links.find((l) => l.invoiceId === i.id);
  const today = todayStr();
  const events = [...(i.events ?? [])].reverse();

  const text = () => {
    const lines = [`Invoice ${i.number}`, `To: ${i.client}`, `Amount: ${money(i.amount)}`, `Issued: ${fmtDate(i.issued)}`, `Due: ${fmtDate(i.due)}`];
    if (i.lineItems?.length) lines.push("", ...i.lineItems.map((l) => `- ${l.description}: ${l.quantity} × ${money(l.unitPrice)}`));
    if (split) lines.push("", "Milestones:", ...i.milestones!.map((m) => `- ${m.title}: ${money(m.amount)}, due ${fmtDate(m.due)}${m.status === "Paid" ? " (paid)" : ""}`));
    if (i.payToken) lines.push("", `Pay online: ${payUrl(i.payToken)}`);
    return `${lines.join("\n")}\n`;
  };

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" asChild><Link href="/dashboard/money/invoices"><ArrowLeft className="size-4" /> Invoices</Link></Button>

      {/* Header */}
      <Card className="overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-primary via-fuchsia-500 to-cyan-400" />
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-wrap items-start gap-4">
            <ClientMark name={i.client} className="size-12 text-base" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{i.client}</h1>
                <StatusPill status={st !== "Paid" && anyPaid ? "Partial" : st} />
              </div>
              <p className="text-sm text-muted-foreground">{i.number} · issued {fmtDate(i.issued)}{i.email ? ` · ${i.email}` : ""}</p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-extrabold tracking-tight">{money(st === "Paid" ? i.amount : left)}</p>
              <p className="text-xs text-muted-foreground">{st === "Paid" ? `paid in full ${fmtDate(i.paidOn)}` : anyPaid ? `left of ${money(i.amount)}` : i.status === "Draft" ? "draft" : `due ${fmtDate(parts.find((m) => m.status === "Due")?.due || i.due)}`}</p>
            </div>
          </div>
          {(split || anyPaid) && (
            <div className="mt-4">
              <div className="flex justify-between text-xs"><span className="font-medium">{money(i.amount - left)} received</span><span className="text-muted-foreground">{paid.length} of {parts.length} paid</span></div>
              <Progress value={((i.amount - left) / Math.max(i.amount, 0.01)) * 100} className="mt-1.5 h-2" />
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {st !== "Paid" && (
              <Button variant="gradient" disabled={linkBusy === i.id} onClick={() => share(i)}>
                {linkBusy === i.id ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {i.payToken ? "Send pay link" : "Get pay link"}
              </Button>
            )}
            {st !== "Paid" && (
              <Button variant="outline" onClick={() => { L.markPaid(i.id); toast({ title: split ? "Remaining milestones marked paid" : "Marked as paid", description: "Added to your income.", variant: "success" }); }}>
                <CheckCircle2 className="size-4" /> {split ? "Mark rest paid" : "Mark paid"}
              </Button>
            )}
            {i.status === "Draft" && <Button variant="outline" onClick={() => { L.updateInvoice(i.id, { status: "Sent" }); L.logEvent(i.id, "Marked as sent", "sent"); toast({ title: "Marked as sent" }); }}>Mark sent</Button>}
            {!anyPaid && <Button variant="ghost" asChild><Link href={`/dashboard/money/invoices/new?edit=${i.id}`}><Pencil className="size-4" /> Edit</Link></Button>}
            <Button variant="ghost" asChild><Link href={`/dashboard/money/invoices/new?from=${i.id}`}><CopyPlus className="size-4" /> Duplicate</Link></Button>
            <Button variant="ghost" onClick={() => copy(text(), "Invoice copied")}><Copy className="size-4" /> Copy text</Button>
            {confirmDelete ? (
              <span className="inline-flex items-center gap-1.5">
                <Button variant="destructive" onClick={() => { removeInvoice(i); router.push("/dashboard/money/invoices"); }}>Delete</Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </span>
            ) : (
              <Button variant="ghost" className="text-muted-foreground" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${i.number}`}><Trash2 className="size-4" /></Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-5">
          {/* Schedule */}
          <Card>
            <CardContent className="p-4 sm:p-5">
              <p className="mb-3 font-semibold">{split ? "Payment schedule" : "Payment"}</p>
              <ul className="space-y-2" data-testid="milestone-list">
                {parts.map((m) => {
                  const overdue = m.status === "Due" && !!m.due && m.due < today;
                  return (
                    <li key={m.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3", m.status === "Paid" ? "bg-success/5" : overdue ? "border-destructive/40 bg-destructive/5" : "bg-card")}>
                      {m.status === "Paid" ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <Circle className={cn("size-5 shrink-0", overdue ? "text-destructive" : "text-muted-foreground")} />}
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="truncate text-sm font-medium">{m.title}</p>
                        <p className={cn("text-[11px]", overdue ? "text-destructive" : "text-muted-foreground")}>
                          {m.status === "Paid" ? `Paid ${fmtDate(m.paidOn)} · ${PAID_VIA_LABEL[m.paidVia ?? "manual"]}` : m.due ? `Due ${fmtDate(m.due)}${overdue ? " · overdue" : ""}` : "Due on receipt"}
                        </p>
                      </div>
                      <p className="text-sm font-bold">{money(m.amount)}</p>
                      {m.status === "Paid"
                        ? isOnline(m.paidVia)
                          ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">Paid online</span>
                          : <Button size="sm" variant="ghost" onClick={() => { L.markMilestoneUnpaid(i.id, m.id); toast({ title: "Marked unpaid", description: "The income entry was removed." }); }}><Undo2 className="size-3.5" /> Undo</Button>
                        : <Button size="sm" variant="outline" onClick={() => { L.markMilestonePaid(i.id, m.id); toast({ title: `${m.title} marked paid`, description: "Added to your income.", variant: "success" }); }}><CheckCircle2 className="size-3.5" /> Mark paid</Button>}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {/* Pay link */}
          <Card>
            <CardContent className="p-4 sm:p-5">
              <p className="mb-1 flex items-center gap-2 font-semibold"><Link2 className="size-4 text-primary" /> Pay link</p>
              {!canLink ? (
                <p className="text-sm text-muted-foreground">Pay links need the server, so they&apos;re off in this demo.</p>
              ) : i.payToken ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {payStatus?.live === false ? "Your client can open the invoice; online payment turns on once Stripe is connected." : "Your client pays each part here by card or crypto. Paid parts show up in Money on their own."}
                  </p>
                  <div className="mt-3 flex min-w-0 items-center gap-2 rounded-xl border bg-muted/30 p-2 pl-3">
                    <code className="min-w-0 flex-1 truncate text-xs">{payUrl(i.payToken)}</code>
                    <Button size="sm" variant="ghost" onClick={() => copy(payUrl(i.payToken!), "Pay link copied")}><Copy className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" asChild><a href={payUrl(i.payToken)} target="_blank" rel="noreferrer" aria-label="Open pay page"><ExternalLink className="size-3.5" /></a></Button>
                  </div>
                  {link && link.extraPayments > 0 && (
                    <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">A client paid a part twice. Refund the duplicate from your Stripe dashboard.</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Create a link and your client can pay {split ? "each milestone" : "the invoice"} by {methodsOf(i).map((m) => (m === "crypto" ? "crypto" : `${m} card`)).join(", ")}.</p>
                  {st !== "Paid" && <Button className="mt-3" variant="outline" disabled={linkBusy === i.id} onClick={() => share(i)}>{linkBusy === i.id ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Create pay link</Button>}
                </>
              )}
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card>
            <CardContent className="p-4 sm:p-5">
              <p className="mb-3 flex items-center gap-2 font-semibold"><History className="size-4 text-primary" /> Timeline</p>
              {events.length === 0 ? <p className="text-sm text-muted-foreground">Created {fmtDate(i.issued)}.</p> : (
                <ol className="relative space-y-3 border-l pl-5">
                  {events.map((e, n) => (
                    <li key={n} className="relative">
                      <span className={cn("absolute -left-[25px] top-1 size-2.5 rounded-full ring-4 ring-card", e.tone === "paid" ? "bg-success" : e.tone === "sent" ? "bg-primary" : "bg-muted-foreground/50")} />
                      <p className="text-sm">{e.text}</p>
                      <p className="text-[11px] text-muted-foreground">{fmtDateTime(e.at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <InvoicePreview
          className="h-fit lg:sticky lg:top-2"
          data={{
            number: i.number, business: user?.company || user?.name, client: i.client, email: i.email, issued: i.issued, due: i.due,
            description: i.description, lineItems: i.lineItems ?? [], discount: i.discount, taxRate: i.taxRate, notes: i.notes,
            milestones: split ? i.milestones!.map((m) => ({ title: m.title, amount: m.amount, due: m.due, paid: m.status === "Paid" })) : undefined,
            methods: methodsOf(i), fallbackTotal: i.amount,
          }}
        />
      </div>
    </div>
  );
}
