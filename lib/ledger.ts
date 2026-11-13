"use client";
import * as React from "react";
import { useDemoStore } from "@/lib/demo-store";

/**
 * Money ledger: income, expenses and invoices the freelancer records.
 *
 * Stored inside the workspace (DemoState.ledger) by the demo store, so a
 * signed-in user's ledger is saved to their account on the server and the
 * frontend-only demo keeps it in this browser — same as every other workspace
 * collection.
 *
 * Invoices can be split into milestones and shared through a pay link
 * (backend/app/routers/payments.py), where the client pays by debit card,
 * credit card or crypto. Money only moves through that pay link: a payment
 * the server confirms is applied here with applyOnlinePayments. Everything
 * else (marking paid, income, expenses) is a record the user keeps.
 */

export type PayMethod = "debit" | "credit" | "crypto";
export type PaidVia = PayMethod | "manual";
export type Milestone = { id: string; title: string; amount: number; due: string; status: "Due" | "Paid"; paidOn?: string; paidVia?: PaidVia };
/** One billable line. The invoice total is subtotal − discount + tax. */
export type LineItem = { id: string; description: string; quantity: number; unitPrice: number };
/** Timeline entry on an invoice ("Created", "Pay link shared", "Deposit paid by credit card"…). */
export type InvoiceEvent = { at: string; text: string; tone?: "paid" | "sent" | "info" };
export type Txn = { id: string; date: string; type: "income" | "expense"; amount: number; category: string; party: string; note: string; invoiceId?: string; milestoneId?: string };
export type Invoice = {
  id: string; number: string; client: string; email: string; amount: number; issued: string; due: string; description: string;
  status: "Draft" | "Sent" | "Paid"; paidOn?: string; paidVia?: PaidVia;
  /** Payment schedule. Absent: the invoice is paid in one go. */
  milestones?: Milestone[];
  /** How the client may pay through the pay link. Absent: all methods. */
  methods?: PayMethod[];
  /** Public pay-link token, once a link was created. */
  payToken?: string;
  /** Itemized breakdown. Absent on invoices created before line items. */
  lineItems?: LineItem[];
  /** Flat discount in dollars, taken off the subtotal before tax. */
  discount?: number;
  /** Tax as a percentage of (subtotal − discount). */
  taxRate?: number;
  /** Printed on the invoice and the pay page (payment terms, thanks…). */
  notes?: string;
  /** Newest last. */
  events?: InvoiceEvent[];
};
export type LedgerState = { txns: Txn[]; invoices: Invoice[]; goal: number; seq: number };

/** A pay link as GET /api/pay-links returns it. */
export type PayLinkView = {
  invoiceId: string; token: string; active: boolean; methods: PayMethod[]; total: number; paid: number; remaining: number; extraPayments: number;
  milestones: { id: string; title: string; amount: number; due: string; status: "due" | "paid"; paidOn: string | null; paidVia: PaidVia | null }[];
};

export const PAY_METHODS: { id: PayMethod; label: string; short: string }[] = [
  { id: "debit", label: "Debit card", short: "Debit" },
  { id: "credit", label: "Credit card", short: "Credit" },
  { id: "crypto", label: "Crypto (USDC)", short: "Crypto" },
];
export const ALL_METHODS: PayMethod[] = ["debit", "credit", "crypto"];
export const PAID_VIA_LABEL: Record<PaidVia, string> = { debit: "debit card", credit: "credit card", crypto: "crypto (USDC)", manual: "marked by hand" };
/** Id of the single payable part of an invoice without milestones. */
export const FULL_PAYMENT = "full";

// A ledger saved by the earlier browser-only build; moved into the workspace once.
const LEGACY_KEY = "autopilot-ledger-v1";
const EMPTY: LedgerState = { txns: [], invoices: [], goal: 0, seq: 1 };

export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const monthKey = (date: string) => date.slice(0, 7);
const round2 = (n: number) => Math.round(n * 100) / 100;
const isOnline = (via?: PaidVia) => !!via && via !== "manual";
const cents = (n: number) => Math.round(round2(n) * 100);
const nowIso = () => new Date().toISOString();
const withEvent = (i: Invoice, text: string, tone?: InvoiceEvent["tone"]): Invoice => ({ ...i, events: [...(i.events ?? []), { at: nowIso(), text, ...(tone ? { tone } : {}) }].slice(-50) });

/** Subtotal, discount, tax and total from line items, rounded the way the
 *  server checks them (whole cents per line). */
export function invoiceBreakdown(items: Pick<LineItem, "quantity" | "unitPrice">[], discount = 0, taxRate = 0) {
  const sub = items.reduce((n, i) => n + Math.round(cents(i.unitPrice) * round2(i.quantity)), 0);
  const disc = Math.min(cents(discount), sub);
  const tax = Math.round(((sub - disc) * (Math.round(taxRate * 1000) / 1000)) / 100);
  return { subtotal: sub / 100, discount: disc / 100, tax: tax / 100, total: (sub - disc + tax) / 100 };
}

/** The parts a client pays: the milestones, or one part for the whole invoice. */
export function payableParts(i: Invoice): Milestone[] {
  if (i.milestones?.length) return i.milestones;
  return [{ id: FULL_PAYMENT, title: i.description.trim().slice(0, 80) || "Full payment", amount: i.amount, due: i.due, status: i.status === "Paid" ? "Paid" : "Due", paidOn: i.paidOn, paidVia: i.paidVia }];
}

/** What's still owed on an invoice (drafts count; filter them out if needed). */
export const amountDue = (i: Invoice) => round2(payableParts(i).filter((m) => m.status === "Due").reduce((n, m) => n + m.amount, 0));

export const effectiveStatus = (i: Invoice): "Draft" | "Sent" | "Paid" | "Overdue" => {
  if (i.status === "Paid") return "Paid";
  if (i.status !== "Sent") return i.status;
  const nextDue = payableParts(i).filter((m) => m.status === "Due" && m.due).map((m) => m.due).sort()[0];
  return nextDue && nextDue < todayStr() ? "Overdue" : "Sent";
};

/** Body for POST /api/pay-links. Parts paid by hand are sent as such, so the
 *  client can't pay them again; parts paid online are the server's record. */
export function payLinkSnapshot(i: Invoice) {
  const items = i.lineItems?.filter((l) => l.description.trim() && l.quantity > 0) ?? [];
  return {
    invoiceId: i.id, number: i.number, client: i.client, description: i.description, currency: "USD",
    methods: i.methods?.length ? i.methods : ALL_METHODS,
    milestones: payableParts(i).map((m) => ({ id: m.id, title: m.title, amount: m.amount, due: m.due, paidManually: m.status === "Paid" && !isOnline(m.paidVia) })),
    notes: i.notes ?? "", issued: i.issued, due: i.due,
    ...(items.length ? {
      lineItems: items.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unitPrice: l.unitPrice })),
      discount: i.discount ?? 0, taxRate: i.taxRate ?? 0,
    } : {}),
  };
}

export const INCOME_CATEGORIES = ["Client work", "Platform payout", "Retainer", "Bonus", "Other income"];
export const EXPENSE_CATEGORIES = ["Software", "Platform fees", "Marketing", "Contractors", "Equipment", "Taxes", "Other expense"];

const normalize = (p: any): LedgerState => (p && typeof p === "object"
  ? { txns: Array.isArray(p.txns) ? p.txns : [], invoices: Array.isArray(p.invoices) ? p.invoices : [], goal: Number(p.goal) || 0, seq: Number(p.seq) || 1 }
  : EMPTY);

const uid = () => Math.random().toString(36).slice(2, 10);

// ---- pure state transitions (idempotent: paying a paid part is a no-op)

function payWhole(s: LedgerState, id: string, via: PaidVia, date: string): LedgerState {
  const inv = s.invoices.find((i) => i.id === id);
  if (!inv || inv.status === "Paid") return s;
  const txn: Txn = { id: uid(), date, type: "income", amount: inv.amount, category: "Client work", party: inv.client, note: `${inv.number} paid`, invoiceId: id };
  return { ...s, txns: [txn, ...s.txns], invoices: s.invoices.map((i) => (i.id === id ? withEvent({ ...i, status: "Paid", paidOn: date, paidVia: via }, `Paid in full · ${PAID_VIA_LABEL[via]}`, "paid") : i)) };
}

function payPart(s: LedgerState, id: string, partId: string, via: PaidVia, date: string): LedgerState {
  const inv = s.invoices.find((i) => i.id === id);
  if (!inv) return s;
  if (!inv.milestones?.length) return partId === FULL_PAYMENT ? payWhole(s, id, via, date) : s;
  const m = inv.milestones.find((x) => x.id === partId);
  if (!m || m.status === "Paid") return s;
  const milestones = inv.milestones.map((x) => (x.id === partId ? { ...x, status: "Paid" as const, paidOn: date, paidVia: via } : x));
  const allPaid = milestones.every((x) => x.status === "Paid");
  const txn: Txn = { id: uid(), date, type: "income", amount: m.amount, category: "Client work", party: inv.client, note: `${inv.number} · ${m.title} paid`, invoiceId: id, milestoneId: partId };
  return {
    ...s, txns: [txn, ...s.txns],
    invoices: s.invoices.map((i) => (i.id === id ? withEvent({ ...i, milestones, status: allPaid ? "Paid" : i.status === "Draft" ? "Sent" : i.status, paidOn: allPaid ? date : undefined }, `${m.title} paid · ${PAID_VIA_LABEL[via]}`, "paid") : i)),
  };
}

function unpayPart(s: LedgerState, id: string, partId: string): LedgerState {
  const inv = s.invoices.find((i) => i.id === id);
  if (!inv) return s;
  if (!inv.milestones?.length) {
    if (partId !== FULL_PAYMENT || inv.status !== "Paid") return s;
    return { ...s, txns: s.txns.filter((t) => t.invoiceId !== id), invoices: s.invoices.map((i) => (i.id === id ? withEvent({ ...i, status: "Sent", paidOn: undefined, paidVia: undefined }, "Payment undone") : i)) };
  }
  const m = inv.milestones.find((x) => x.id === partId);
  if (!m || m.status !== "Paid") return s;
  const milestones = inv.milestones.map((x) => (x.id === partId ? { ...x, status: "Due" as const, paidOn: undefined, paidVia: undefined } : x));
  return {
    ...s, txns: s.txns.filter((t) => !(t.invoiceId === id && t.milestoneId === partId)),
    invoices: s.invoices.map((i) => (i.id === id ? withEvent({ ...i, milestones, status: i.status === "Paid" ? "Sent" : i.status, paidOn: undefined }, `${m.title} marked unpaid`) : i)),
  };
}

export function useLedger() {
  const demo = useDemoStore();
  const state = normalize(demo?.state.ledger);
  const ready = !!demo?.hydrated;
  const update = demo?.updateLedger;

  // One-time move of a browser-only ledger into the workspace.
  React.useEffect(() => {
    if (!ready || !update || demo?.state.ledger) return;
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      update(() => normalize(JSON.parse(raw)));
      localStorage.removeItem(LEGACY_KEY);
    } catch { /* storage blocked or corrupt — start empty */ }
  }, [ready, update, demo?.state.ledger]);

  const commit = React.useCallback((fn: (s: LedgerState) => LedgerState) => {
    update?.((current) => fn(normalize(current)));
  }, [update]);

  const addTxn = (t: Omit<Txn, "id">) => commit((s) => ({ ...s, txns: [{ ...t, id: uid() }, ...s.txns] }));
  const deleteTxn = (id: string) => commit((s) => ({ ...s, txns: s.txns.filter((t) => t.id !== id) }));
  const setGoal = (goal: number) => commit((s) => ({ ...s, goal }));

  /** With milestones, the total and final due date come from the schedule.
   *  Returns the new invoice (the store applies the change synchronously). */
  const addInvoice = (i: InvoiceInput): Invoice | null => {
    let created: Invoice | null = null;
    commit((s) => {
      const invoice = buildInvoice(i, uid(), `INV-${String(s.seq).padStart(4, "0")}`);
      created = withEvent(invoice, invoice.status === "Draft" ? "Draft created" : "Invoice created", "info");
      return { ...s, seq: s.seq + 1, invoices: [created, ...s.invoices] };
    });
    return created;
  };
  /** Replace an invoice's contents. Only while nothing on it is paid. */
  const editInvoice = (id: string, i: InvoiceInput): boolean => {
    let ok = false;
    commit((s) => {
      const cur = s.invoices.find((x) => x.id === id);
      if (!cur || payableParts(cur).some((m) => m.status === "Paid")) return s;
      ok = true;
      const next = buildInvoice({ ...i, status: i.status ?? cur.status }, cur.id, cur.number);
      return { ...s, invoices: s.invoices.map((x) => (x.id === id ? withEvent({ ...next, payToken: cur.payToken, events: cur.events }, "Invoice edited") : x)) };
    });
    return ok;
  };
  const logEvent = (id: string, text: string, tone?: InvoiceEvent["tone"]) =>
    commit((s) => ({ ...s, invoices: s.invoices.map((x) => (x.id === id ? withEvent(x, text, tone) : x)) }));
  const updateInvoice = (id: string, patch: Partial<Invoice>) => commit((s) => ({ ...s, invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  /** Marks everything still due as paid by hand. */
  const markPaid = (id: string, date = todayStr()) => commit((s) => {
    const inv = s.invoices.find((i) => i.id === id);
    if (!inv) return s;
    return inv.milestones?.length
      ? inv.milestones.filter((m) => m.status === "Due").reduce((acc, m) => payPart(acc, id, m.id, "manual", date), s)
      : payWhole(s, id, "manual", date);
  });
  /** Undoes payments marked by hand. Payments made through the pay link stay. */
  const markUnpaid = (id: string) => commit((s) => {
    const inv = s.invoices.find((i) => i.id === id);
    if (!inv) return s;
    return payableParts(inv).filter((m) => m.status === "Paid" && !isOnline(m.paidVia)).reduce((acc, m) => unpayPart(acc, id, m.id), s);
  });
  const markMilestonePaid = (id: string, partId: string, via: PaidVia = "manual", date = todayStr()) => commit((s) => payPart(s, id, partId, via, date));
  const markMilestoneUnpaid = (id: string, partId: string) => commit((s) => unpayPart(s, id, partId));
  const deleteInvoice = (id: string) => commit((s) => ({ ...s, txns: s.txns.filter((t) => t.invoiceId !== id), invoices: s.invoices.filter((i) => i.id !== id) }));

  /** Apply payments the server confirmed through pay links. Returns the parts
   *  newly marked paid (computed from the current state; applying is
   *  idempotent, so a repeated or concurrent call changes nothing). */
  const applyOnlinePayments = (links: PayLinkView[]) => {
    const fresh: { invoice: Invoice; part: Milestone; via: PayMethod }[] = [];
    const plan: { id: string; partId: string; via: PayMethod; date: string }[] = [];
    for (const link of links) {
      const inv = state.invoices.find((i) => i.id === link.invoiceId);
      if (!inv) continue;
      for (const m of link.milestones) {
        if (m.status !== "paid" || !m.paidVia || m.paidVia === "manual") continue;
        const part = payableParts(inv).find((p) => p.id === m.id);
        if (!part) continue;
        if (part.status === "Paid" && part.paidVia === m.paidVia) continue;
        if (part.status === "Due") fresh.push({ invoice: inv, part, via: m.paidVia });
        plan.push({ id: inv.id, partId: m.id, via: m.paidVia, date: m.paidOn || todayStr() });
      }
    }
    if (plan.length) {
      commit((s) => plan.reduce((acc, p) => {
        const inv = acc.invoices.find((i) => i.id === p.id);
        const part = inv && payableParts(inv).find((x) => x.id === p.partId);
        if (!inv || !part) return acc;
        if (part.status === "Due") return payPart(acc, p.id, p.partId, p.via, p.date);
        // Marked paid by hand here, but the client actually paid online: keep the
        // payment, record how it really arrived.
        if (part.paidVia === p.via) return acc;
        return {
          ...acc, invoices: acc.invoices.map((i) => (i.id !== p.id ? i : i.milestones?.length
            ? { ...i, milestones: i.milestones.map((x) => (x.id === p.partId ? { ...x, paidVia: p.via } : x)) }
            : { ...i, paidVia: p.via })),
        };
      }, s));
    }
    return fresh;
  };

  return { ...state, ready, addTxn, deleteTxn, setGoal, addInvoice, editInvoice, logEvent, updateInvoice, markPaid, markUnpaid, markMilestonePaid, markMilestoneUnpaid, deleteInvoice, applyOnlinePayments };
}

export type Ledger = ReturnType<typeof useLedger>;

/** What the invoice builder hands to addInvoice/editInvoice. */
export type InvoiceInput = Omit<Invoice, "id" | "number" | "status" | "milestones" | "events" | "payToken"> & {
  status?: Invoice["status"];
  milestones?: Omit<Milestone, "id" | "status">[];
};

function buildInvoice(i: InvoiceInput, id: string, number: string): Invoice {
  const milestones = i.milestones?.length ? i.milestones.map((m) => ({ ...m, amount: round2(m.amount), id: uid(), status: "Due" as const })) : undefined;
  const items = i.lineItems?.filter((l) => l.description.trim() && l.quantity > 0);
  const fromItems = items?.length ? invoiceBreakdown(items, i.discount, i.taxRate).total : undefined;
  const amount = milestones ? round2(milestones.reduce((n, m) => n + m.amount, 0)) : fromItems ?? round2(i.amount);
  const due = milestones ? milestones.map((m) => m.due).sort().slice(-1)[0] || i.due : i.due;
  const invoice: Invoice = { ...i, amount, due, milestones, lineItems: items?.length ? items : undefined, status: i.status ?? "Sent", id, number };
  if (!milestones) delete invoice.milestones;
  if (!invoice.lineItems) { delete invoice.lineItems; delete invoice.discount; delete invoice.taxRate; }
  return invoice;
}

/** Last n months (oldest first) of income/expense totals. */
export function monthlySeries(txns: Txn[], n = 6) {
  const out: { key: string; label: string; income: number; expense: number }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ key, label: d.toLocaleString("en", { month: "short" }), income: 0, expense: 0 });
  }
  for (const t of txns) { const row = out.find((r) => r.key === monthKey(t.date)); if (row) row[t.type] += t.amount; }
  return out;
}

export function toCsv(txns: Txn[]) {
  // Quote every cell; prefix text that a spreadsheet would run as a formula.
  const esc = (v: string | number) => `"${(typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : String(v)).replace(/"/g, '""')}"`;
  return ["Date,Type,Amount,Category,Party,Note", ...txns.map((t) => [t.date, t.type, t.amount, t.category, t.party, t.note].map(esc).join(","))].join("\n");
}
