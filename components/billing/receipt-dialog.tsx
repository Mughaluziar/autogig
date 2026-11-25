"use client";
import * as React from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { fmtDate, money } from "@/components/money/format";

/** What GET /api/billing/receipts/{id} returns (backend/app/routers/billing.py). */
export type Receipt = {
  number: string; purchaseId: string; date: string | null; item: string; amount: number; currency: string; status: string;
  recurring: boolean; charged: boolean; paymentMethod: string | null; issuer: string; note: string;
  billedTo: { name: string; email: string; company: string };
};

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** A self-contained, printable receipt document (no scripts, no external files). */
export function receiptHtml(r: Receipt): string {
  const rows: [string, string][] = [
    ["Receipt number", r.number], ["Date", fmtDate(r.date)], ["Status", r.status],
    ...(r.paymentMethod ? [["Payment method", r.paymentMethod] as [string, string]] : []),
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt ${esc(r.number)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:640px;margin:40px auto;padding:0 20px}
h1{font-size:22px;margin:0 0 4px}.muted{color:#666}table{width:100%;border-collapse:collapse;margin:20px 0}
td{padding:8px 0;border-bottom:1px solid #eee;vertical-align:top}td:last-child{text-align:right}
.total td{font-weight:700;font-size:16px;border-bottom:2px solid #111}.note{background:#f6f6f6;padding:12px;border-radius:8px}</style></head>
<body><h1>${esc(r.issuer)} receipt</h1><p class="muted">${r.charged ? "Payment received." : "No payment was taken."}</p>
<table>${rows.map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<p><strong>Billed to</strong><br>${esc(r.billedTo.name)}${r.billedTo.company ? `<br>${esc(r.billedTo.company)}` : ""}<br>${esc(r.billedTo.email)}</p>
<table><tr><td>${esc(r.item)}${r.recurring ? ' <span class="muted">(monthly)</span>' : ""}</td><td>${esc(money(r.amount))}</td></tr>
<tr class="total"><td>${r.charged ? "Total paid" : "Total charged"}</td><td>${esc(money(r.charged ? r.amount : 0))} ${esc(r.currency)}</td></tr></table>
${r.note ? `<p class="note">${esc(r.note)}</p>` : ""}</body></html>`;
}

export function ReceiptDialog({ purchaseId, onClose }: { purchaseId: string | null; onClose: () => void }) {
  const [receipt, setReceipt] = React.useState<Receipt | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setReceipt(null);
    setError("");
    if (!purchaseId) return;
    let alive = true;
    apiFetch(`/api/billing/receipts/${encodeURIComponent(purchaseId)}`)
      .then(async (res) => {
        if (!alive) return;
        if (res.ok) setReceipt((await res.json()) as Receipt);
        else setError(res.status === 404 ? "That purchase isn't on your account." : "Couldn't load the receipt. Try again.");
      })
      .catch(() => alive && setError("Can't reach the server. Try again in a moment."));
    return () => { alive = false; };
  }, [purchaseId]);

  const download = () => {
    if (!receipt) return;
    const url = URL.createObjectURL(new Blob([receiptHtml(receipt)], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-${receipt.number}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const print = () => {
    if (!receipt) return;
    // Our own escaped, script-free document in a blank window (it needs the handle to write and print).
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) { download(); return; }      // pop-ups blocked: the downloaded file prints just as well
    w.document.write(receiptHtml(receipt));
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <Dialog open={Boolean(purchaseId)} onOpenChange={(v) => !v && onClose()}>
      <DialogHeader><DialogTitle>Receipt</DialogTitle></DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!receipt && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</p>}
      {receipt && (
        <div className="space-y-4 text-sm" data-testid="receipt">
          <dl className="grid grid-cols-2 gap-y-1.5">
            <dt className="text-muted-foreground">Receipt number</dt><dd className="text-right font-mono text-xs">{receipt.number}</dd>
            <dt className="text-muted-foreground">Date</dt><dd className="text-right">{fmtDate(receipt.date)}</dd>
            <dt className="text-muted-foreground">Status</dt><dd className="text-right">{receipt.status}</dd>
            {receipt.paymentMethod && <><dt className="text-muted-foreground">Payment method</dt><dd className="text-right">{receipt.paymentMethod}</dd></>}
          </dl>
          <div className="rounded-lg border p-3">
            <div className="flex justify-between gap-3"><span>{receipt.item}{receipt.recurring && <span className="text-muted-foreground"> · monthly</span>}</span><span>{money(receipt.amount)}</span></div>
            <div className="mt-2 flex justify-between gap-3 border-t pt-2 font-semibold"><span>{receipt.charged ? "Total paid" : "Total charged"}</span><span>{money(receipt.charged ? receipt.amount : 0)}</span></div>
          </div>
          <p className="text-xs text-muted-foreground">Billed to {receipt.billedTo.name}{receipt.billedTo.company ? `, ${receipt.billedTo.company}` : ""} · {receipt.billedTo.email}</p>
          {receipt.note && <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">{receipt.note}</p>}
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="outline" disabled={!receipt} onClick={print}><Printer className="size-4" /> Print</Button>
        <Button variant="gradient" disabled={!receipt} onClick={download}><Download className="size-4" /> Download</Button>
      </DialogFooter>
    </Dialog>
  );
}
