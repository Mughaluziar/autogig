"use client";
import { CheckCircle2, Circle } from "lucide-react";
import { invoiceBreakdown, type PayMethod } from "@/lib/ledger";
import { cn } from "@/lib/utils";
import { fmtDate, MethodChips, money } from "./format";

export type PreviewData = {
  number: string;
  business?: string;
  client: string;
  email?: string;
  issued: string;
  due: string;
  description?: string;
  lineItems: { description: string; quantity: number; unitPrice: number }[];
  discount?: number;
  taxRate?: number;
  notes?: string;
  milestones?: { title: string; amount: number; due: string; paid?: boolean }[];
  methods: PayMethod[];
  /** Used for invoices from before line items existed. */
  fallbackTotal?: number;
};

/** The invoice as the client sees it: a clean paper-like document. */
export function InvoicePreview({ data, className }: { data: PreviewData; className?: string }) {
  const items = data.lineItems.filter((l) => l.description.trim() || l.unitPrice);
  const b = items.length ? invoiceBreakdown(items, data.discount, data.taxRate) : null;
  const total = b ? b.total : data.fallbackTotal ?? 0;
  const schedule = (data.milestones ?? []).filter((m) => m.title.trim() || m.amount);

  return (
    <article className={cn("overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xl shadow-primary/5", className)} aria-label="Invoice preview">
      <div className="h-1.5 bg-gradient-to-r from-primary via-fuchsia-500 to-cyan-400" />
      <div className="space-y-6 p-5 sm:p-7">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Invoice</p>
            <p className="mt-0.5 text-xl font-bold tracking-tight">{data.number || "INV-…"}</p>
            {data.business && <p className="text-sm text-muted-foreground">from {data.business}</p>}
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">Amount due</p>
            <p className="text-2xl font-extrabold tracking-tight">{money(total)}</p>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Billed to</p>
            <p className="truncate font-medium">{data.client || "Client name"}</p>
            {data.email && <p className="truncate text-xs text-muted-foreground">{data.email}</p>}
          </div>
          <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Issued</p><p className="font-medium">{fmtDate(data.issued)}</p></div>
          <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Due</p><p className="font-medium">{fmtDate(data.due)}</p></div>
        </div>

        {data.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{data.description}</p>}

        {b ? (
          <div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 border-b pb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Item</span><span className="text-right">Qty × rate</span><span className="w-20 text-right">Amount</span>
            </div>
            <ul className="divide-y">
              {items.map((l, n) => (
                <li key={n} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 py-2 text-sm">
                  <span className="min-w-0 break-words">{l.description || <span className="text-muted-foreground">Item {n + 1}</span>}</span>
                  <span className="whitespace-nowrap text-right text-xs text-muted-foreground">{l.quantity} × {money(l.unitPrice)}</span>
                  <span className="w-20 text-right font-medium">{money(Math.round(l.quantity * l.unitPrice * 100) / 100)}</span>
                </li>
              ))}
            </ul>
            <dl className="ml-auto mt-2 w-full max-w-[16rem] space-y-1 text-sm">
              <Row label="Subtotal" value={money(b.subtotal)} />
              {b.discount > 0 && <Row label="Discount" value={`−${money(b.discount)}`} />}
              {b.tax > 0 && <Row label={`Tax (${data.taxRate}%)`} value={money(b.tax)} />}
              <div className="flex justify-between border-t pt-1.5 text-base font-bold"><dt>Total</dt><dd>{money(b.total)}</dd></div>
            </dl>
          </div>
        ) : null}

        {schedule.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payment schedule</p>
            <ol className="space-y-1.5">
              {schedule.map((m, n) => (
                <li key={n} className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  {m.paid ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <Circle className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{m.title || `Milestone ${n + 1}`}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{m.due ? `Due ${fmtDate(m.due)}` : ""}</span>
                  <span className={cn("font-semibold", m.paid && "text-muted-foreground line-through decoration-1")}>{money(m.amount || 0)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <footer className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>Pay online with</span><MethodChips methods={data.methods} /></div>
          {data.notes && <p className="whitespace-pre-line text-xs text-muted-foreground">{data.notes}</p>}
        </footer>
      </div>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-muted-foreground"><dt>{label}</dt><dd className="text-foreground">{value}</dd></div>;
}
