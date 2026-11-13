"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowLeft, Eye, FileText, Layers, Loader2, Pencil, Plus, Send, Sparkles, Trash2, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { ALL_METHODS, invoiceBreakdown, payableParts, PAY_METHODS, todayStr, type Invoice, type PayMethod } from "@/lib/ledger";
import { cn } from "@/lib/utils";
import { useMoney } from "./money-provider";
import { InvoicePreview } from "./invoice-preview";
import { addDays, methodIcon, money, newKey, round2 } from "./format";

type Item = { key: string; description: string; quantity: string; unitPrice: string };
type Part = { key: string; title: string; amount: string; due: string };
type Form = {
  client: string; email: string; issued: string; due: string; description: string;
  items: Item[]; discount: string; taxRate: string; notes: string;
  schedule: "single" | "milestones"; parts: Part[]; methods: PayMethod[];
};

const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const DEFAULT_NOTES = "Thank you for your business. Pay securely online with the link on this invoice.";

function blank(): Form {
  const issued = todayStr();
  return {
    client: "", email: "", issued, due: addDays(issued, 14), description: "",
    items: [{ key: newKey(), description: "", quantity: "1", unitPrice: "" }],
    discount: "", taxRate: "", notes: DEFAULT_NOTES, schedule: "single", parts: [], methods: [...ALL_METHODS],
  };
}

function fromInvoice(i: Invoice, copy: boolean): Form {
  const issued = copy ? todayStr() : i.issued;
  const items: Item[] = i.lineItems?.length
    ? i.lineItems.map((l) => ({ key: newKey(), description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice) }))
    : [{ key: newKey(), description: i.description.split("\n")[0].slice(0, 120) || "Services", quantity: "1", unitPrice: String(i.amount) }];
  const shift = (d: string) => (copy && d ? addDays(issued, Math.max(0, Math.round((new Date(`${d}T00:00:00`).getTime() - new Date(`${i.issued}T00:00:00`).getTime()) / 86_400_000))) : d);
  return {
    client: i.client, email: i.email ?? "", issued, due: shift(i.due) || addDays(issued, 14), description: i.lineItems?.length ? i.description : "",
    items, discount: i.discount ? String(i.discount) : "", taxRate: i.taxRate ? String(i.taxRate) : "", notes: i.notes ?? DEFAULT_NOTES,
    schedule: i.milestones?.length ? "milestones" : "single",
    parts: (i.milestones ?? []).map((m) => ({ key: newKey(), title: m.title, amount: String(m.amount), due: shift(m.due) })),
    methods: i.methods?.length ? [...i.methods] : [...ALL_METHODS],
  };
}

export function InvoiceBuilder({ editId, fromId }: { editId?: string; fromId?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { L, canLink, payStatus, share } = useMoney();
  const source = (editId || fromId) ? L.invoices.find((i) => i.id === (editId || fromId)) : undefined;
  const editing = !!editId && !!source;
  const locked = editing && payableParts(source!).some((m) => m.status === "Paid");

  const [f, setF] = React.useState<Form>(blank);
  const [loadedFrom, setLoadedFrom] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [view, setView] = React.useState<"edit" | "preview">("edit");
  const [saving, setSaving] = React.useState(false);

  // Prefill once the ledger has loaded (edit or duplicate).
  React.useEffect(() => {
    if (!source || loadedFrom === source.id) return;
    setF(fromInvoice(source, !editId));
    setLoadedFrom(source.id);
  }, [source, loadedFrom, editId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const setItem = (key: string, patch: Partial<Item>) => setF((cur) => ({ ...cur, items: cur.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  const setPart = (key: string, patch: Partial<Part>) => setF((cur) => ({ ...cur, parts: cur.parts.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));

  const items = f.items.map((i) => ({ description: i.description.trim(), quantity: num(i.quantity), unitPrice: num(i.unitPrice) }));
  const totals = invoiceBreakdown(items.filter((i) => i.description && i.quantity > 0), num(f.discount), num(f.taxRate));
  const scheduled = round2(f.parts.reduce((n, p) => n + num(p.amount), 0));
  const unscheduled = round2(totals.total - scheduled);
  const nextNumber = editing ? source!.number : `INV-${String(L.seq).padStart(4, "0")}`;

  // ---- milestone helpers
  const splitEvenly = (n: number) => setF((cur) => {
    const total = invoiceBreakdown(cur.items.map((i) => ({ quantity: num(i.quantity), unitPrice: num(i.unitPrice) })), num(cur.discount), num(cur.taxRate)).total;
    const each = Math.floor((total / n) * 100) / 100;
    const titles = n === 2 ? ["Deposit", "Final delivery"] : Array.from({ length: n }, (_, k) => (k === 0 ? "Deposit" : k === n - 1 ? "Final delivery" : `Milestone ${k + 1}`));
    const span = Math.max(7, Math.round((new Date(`${cur.due}T00:00:00`).getTime() - new Date(`${cur.issued}T00:00:00`).getTime()) / 86_400_000) || 14);
    return {
      ...cur, schedule: "milestones",
      parts: titles.map((title, k) => ({
        key: newKey(), title, amount: String(k === n - 1 ? round2(total - each * (n - 1)) : each),
        due: k === 0 ? cur.issued : addDays(cur.issued, Math.round((span * k) / (n - 1))),
      })),
    };
  });
  const balanceLast = () => setF((cur) => {
    if (!cur.parts.length) return cur;
    const others = round2(cur.parts.slice(0, -1).reduce((n, p) => n + num(p.amount), 0));
    const last = cur.parts[cur.parts.length - 1];
    return { ...cur, parts: [...cur.parts.slice(0, -1), { ...last, amount: String(Math.max(0, round2(totals.total - others))) }] };
  });

  // ---- validation + save
  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!f.client.trim()) e.client = "Who is this invoice for?";
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "That email doesn't look right.";
    if (!f.issued) e.issued = "Pick the issue date.";
    const filled = f.items.filter((i) => i.description.trim() || i.unitPrice);
    if (!filled.length) e.items = "Add at least one item.";
    else if (filled.some((i) => !i.description.trim())) e.items = "Every item needs a description.";
    else if (filled.some((i) => num(i.quantity) <= 0)) e.items = "Quantities must be above 0.";
    else if (filled.some((i) => num(i.unitPrice) < 0)) e.items = "Rates can't be negative.";
    if (num(f.discount) < 0) e.discount = "The discount can't be negative.";
    else if (num(f.discount) > totals.subtotal) e.discount = "The discount can't be more than the subtotal.";
    if (num(f.taxRate) < 0 || num(f.taxRate) > 100) e.taxRate = "Tax must be between 0 and 100%.";
    if (!e.items && totals.total <= 0) e.items = "The invoice total must be above $0.";
    if (totals.total > 999_999.99 && f.schedule === "single") e.items = "Split totals over $999,999.99 into milestones.";
    if (f.schedule === "single") {
      if (!f.due) e.due = "Pick a due date.";
      else if (f.due < f.issued) e.due = "Due date can't be before the issue date.";
    } else {
      if (!f.parts.length) e.parts = "Add at least one milestone.";
      f.parts.forEach((p, n) => {
        if (e.parts) return;
        if (!p.title.trim()) e.parts = `Milestone ${n + 1} needs a name.`;
        else if (num(p.amount) <= 0) e.parts = `Milestone ${n + 1}: enter an amount above 0.`;
        else if (!p.due) e.parts = `Milestone ${n + 1}: pick a due date.`;
        else if (p.due < f.issued) e.parts = `Milestone ${n + 1} is due before the issue date.`;
      });
      if (!e.parts && Math.abs(unscheduled) >= 0.01) e.parts = unscheduled > 0
        ? `${money(unscheduled)} of the total isn't in a milestone yet.`
        : `The milestones add up to ${money(-unscheduled)} more than the total.`;
    }
    if (!f.methods.length) e.methods = "Pick at least one way to get paid.";
    setErr(e);
    if (Object.keys(e).length) {
      setView("edit");
      toast({ title: "Check the invoice", description: Object.values(e)[0] });
    }
    return !Object.keys(e).length;
  };

  const save = async (mode: "draft" | "send") => {
    if (locked || !validate()) return;
    setSaving(true);
    const input = {
      client: f.client.trim(), email: f.email.trim(), amount: totals.total, issued: f.issued,
      due: f.schedule === "single" ? f.due : "", description: f.description.trim(),
      lineItems: f.items.filter((i) => i.description.trim()).map((i) => ({ id: i.key, description: i.description.trim(), quantity: round2(num(i.quantity)), unitPrice: round2(num(i.unitPrice)) })),
      discount: round2(num(f.discount)), taxRate: round2(num(f.taxRate)), notes: f.notes.trim(), methods: f.methods,
      status: mode === "draft" ? ("Draft" as const) : ("Sent" as const),
      milestones: f.schedule === "milestones" ? f.parts.map((p) => ({ title: p.title.trim(), amount: round2(num(p.amount)), due: p.due })) : undefined,
    };
    if (editing) {
      const ok = L.editInvoice(source!.id, input);
      setSaving(false);
      if (!ok) { toast({ title: "This invoice can't be edited", description: "Part of it is already paid." }); return; }
      router.push(`/dashboard/money/invoices/${source!.id}`);
      toast({ title: "Invoice updated", description: source!.payToken ? "The pay link shows the new version." : undefined, variant: "success" });
      return;
    }
    const invoice = L.addInvoice(input);
    setSaving(false);
    if (!invoice) { toast({ title: "Couldn't save the invoice", description: "Try again in a moment." }); return; }
    router.push(`/dashboard/money/invoices/${invoice.id}`);
    if (mode === "send" && canLink) void share(invoice);
    else toast({ title: mode === "draft" ? "Draft saved" : "Invoice created", variant: "success" });
  };

  const preview = (
    <InvoicePreview
      data={{
        number: nextNumber, business: user?.company || user?.name, client: f.client, email: f.email, issued: f.issued,
        due: f.schedule === "single" ? f.due : f.parts.map((p) => p.due).filter(Boolean).sort().slice(-1)[0] ?? "",
        description: f.description, lineItems: items, discount: num(f.discount), taxRate: num(f.taxRate), notes: f.notes,
        milestones: f.schedule === "milestones" ? f.parts.map((p) => ({ title: p.title, amount: num(p.amount), due: p.due })) : undefined,
        methods: f.methods.length ? f.methods : ALL_METHODS,
      }}
    />
  );

  if (editId && !source && L.ready) {
    return (
      <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <FileText className="size-8 text-muted-foreground/60" /><p className="font-medium">Invoice not found</p>
        <Button variant="outline" asChild><Link href="/dashboard/money/invoices">Back to invoices</Link></Button>
      </CardContent></Card>
    );
  }

  return (
    <div className="pb-24 lg:pb-0">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" className="-ml-2" asChild>
          <Link href={editing ? `/dashboard/money/invoices/${source!.id}` : "/dashboard/money/invoices"}><ArrowLeft className="size-4" /> {editing ? source!.number : "Invoices"}</Link>
        </Button>
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{editing ? `Edit ${source!.number}` : fromId ? "Duplicate invoice" : "New invoice"}</h1>
          <p className="text-sm text-muted-foreground">Bill by line item, split into milestones, and let your client pay each one by card or crypto.</p>
        </div>
        <div className="flex w-full rounded-lg bg-muted p-1 lg:hidden" role="group" aria-label="View">
          {(["edit", "preview"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium", view === v ? "bg-background shadow-sm" : "text-muted-foreground")}>
              {v === "edit" ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}{v === "edit" ? "Details" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      {locked && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm"><AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />Part of this invoice is already paid, so it can&apos;t be edited. Duplicate it instead to bill for more work.</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <form className={cn("min-w-0 space-y-5", view === "preview" && "hidden lg:block")} onSubmit={(e) => { e.preventDefault(); void save("send"); }} noValidate>
          {/* Client */}
          <Section n={1} title="Who are you billing?">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="b-client" label="Client or company" error={err.client}>
                <Input id="b-client" autoFocus={!source} placeholder="Acme Inc." value={f.client} onChange={(e) => set("client", e.target.value)} aria-invalid={!!err.client} />
              </Field>
              <Field id="b-email" label="Client email" hint="We'll email the pay link here" error={err.email}>
                <Input id="b-email" type="email" placeholder="billing@acme.com" value={f.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!err.email} />
              </Field>
              <Field id="b-issued" label="Issue date" error={err.issued}>
                <Input id="b-issued" type="date" value={f.issued} onChange={(e) => set("issued", e.target.value)} />
              </Field>
              {f.schedule === "single" && (
                <Field id="b-due" label="Due date" error={err.due}>
                  <Input id="b-due" type="date" value={f.due} onChange={(e) => set("due", e.target.value)} aria-invalid={!!err.due} />
                </Field>
              )}
            </div>
            <Field id="b-desc" label="Project (optional)" className="mt-3">
              <Input id="b-desc" placeholder="Website redesign — phase 1" value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </Section>

          {/* Items */}
          <Section n={2} title="What did you do?">
            <div className="space-y-3">
              {f.items.map((it, n) => (
                <div key={it.key} className="rounded-xl border bg-muted/20 p-3">
                  <div className="flex items-start gap-2">
                    <Input aria-label={`Item ${n + 1} description`} placeholder={n === 0 ? "Design and build landing page" : "Description"} value={it.description}
                      onChange={(e) => setItem(it.key, { description: e.target.value })} className="min-w-0" />
                    <Button type="button" size="icon" variant="ghost" className="size-10 shrink-0" aria-label={`Remove item ${n + 1}`} disabled={f.items.length <= 1}
                      onClick={() => setF((cur) => ({ ...cur, items: cur.items.filter((x) => x.key !== it.key) }))}><Trash2 className="size-4 text-muted-foreground" /></Button>
                  </div>
                  <div className="mt-2 grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2">
                    <Input aria-label={`Item ${n + 1} quantity`} type="number" inputMode="decimal" min="0" step="0.25" value={it.quantity} onChange={(e) => setItem(it.key, { quantity: e.target.value })} />
                    <div className="relative min-w-0">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                      <Input aria-label={`Item ${n + 1} rate`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="Rate" className="pl-7" value={it.unitPrice} onChange={(e) => setItem(it.key, { unitPrice: e.target.value })} />
                    </div>
                    <p className="w-24 text-right text-sm font-semibold">{money(round2(num(it.quantity) * num(it.unitPrice)))}</p>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" disabled={f.items.length >= 50}
                onClick={() => setF((cur) => ({ ...cur, items: [...cur.items, { key: newKey(), description: "", quantity: "1", unitPrice: "" }] }))}>
                <Plus className="size-4" /> Add item
              </Button>
              {err.items && <p role="alert" className="text-xs text-destructive">{err.items}</p>}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field id="b-discount" label="Discount ($)" error={err.discount}>
                <Input id="b-discount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0" value={f.discount} onChange={(e) => set("discount", e.target.value)} />
              </Field>
              <Field id="b-tax" label="Tax (%)" error={err.taxRate}>
                <Input id="b-tax" type="number" inputMode="decimal" min="0" max="100" step="0.1" placeholder="0" value={f.taxRate} onChange={(e) => set("taxRate", e.target.value)} />
              </Field>
            </div>
            <dl className="mt-4 space-y-1 rounded-xl bg-muted/40 p-3 text-sm">
              <div className="flex justify-between text-muted-foreground"><dt>Subtotal</dt><dd className="text-foreground">{money(totals.subtotal)}</dd></div>
              {totals.discount > 0 && <div className="flex justify-between text-muted-foreground"><dt>Discount</dt><dd className="text-foreground">−{money(totals.discount)}</dd></div>}
              {totals.tax > 0 && <div className="flex justify-between text-muted-foreground"><dt>Tax</dt><dd className="text-foreground">{money(totals.tax)}</dd></div>}
              <div className="flex justify-between border-t pt-1.5 text-base font-bold"><dt>Total</dt><dd>{money(totals.total)}</dd></div>
            </dl>
          </Section>

          {/* Schedule */}
          <Section n={3} title="When do you get paid?">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment schedule">
              {([["single", "One payment", "The whole amount on the due date", FileText], ["milestones", "Milestones", "A deposit up front, the rest as you deliver", Layers]] as const).map(([v, title, sub, Icon]) => (
                <button key={v} type="button" role="radio" aria-checked={f.schedule === v}
                  onClick={() => (v === "milestones" && !f.parts.length ? splitEvenly(2) : set("schedule", v))}
                  className={cn("flex min-w-0 flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors", f.schedule === v ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/40")}>
                  <Icon className={cn("size-4", f.schedule === v ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-sm font-semibold">{title}</span>
                  <span className="text-[11px] text-muted-foreground">{sub}</span>
                </button>
              ))}
            </div>

            {f.schedule === "milestones" && (
              <div className="mt-4 space-y-3" data-testid="milestone-editor">
                <div className="flex flex-wrap gap-1.5">
                  <span className="mr-1 inline-flex items-center gap-1 text-xs text-muted-foreground"><Wand2 className="size-3.5" />Quick split:</span>
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => splitEvenly(2)}>50 / 50</Button>
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => splitEvenly(3)}>3 payments</Button>
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => splitEvenly(4)}>4 payments</Button>
                </div>
                {f.parts.map((p, n) => (
                  <div key={p.key} className="rounded-xl border bg-muted/20 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">{n + 1}</span>
                      <Input aria-label={`Milestone ${n + 1} name`} placeholder={`Milestone ${n + 1}`} value={p.title} onChange={(e) => setPart(p.key, { title: e.target.value })} className="min-w-0" />
                      <Button type="button" size="icon" variant="ghost" className="size-10 shrink-0" aria-label={`Remove milestone ${n + 1}`} disabled={f.parts.length <= 1}
                        onClick={() => setF((cur) => ({ ...cur, parts: cur.parts.filter((x) => x.key !== p.key) }))}><Trash2 className="size-4 text-muted-foreground" /></Button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="relative min-w-0">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                        <Input aria-label={`Milestone ${n + 1} amount`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="Amount" className="pl-7" value={p.amount} onChange={(e) => setPart(p.key, { amount: e.target.value })} />
                      </div>
                      <Input aria-label={`Milestone ${n + 1} due date`} type="date" value={p.due} onChange={(e) => setPart(p.key, { due: e.target.value })} className="min-w-0" />
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" size="sm" variant="ghost" disabled={f.parts.length >= 24}
                    onClick={() => setF((cur) => ({ ...cur, parts: [...cur.parts, { key: newKey(), title: "", amount: unscheduled > 0 ? String(unscheduled) : "", due: cur.parts[cur.parts.length - 1]?.due || cur.due }] }))}>
                    <Plus className="size-4" /> Add milestone
                  </Button>
                  <div className="flex items-center gap-2 text-xs">
                    {Math.abs(unscheduled) < 0.01
                      ? <span className="font-medium text-success">Schedule matches the total</span>
                      : <>
                          <span className={cn("font-medium", unscheduled < 0 ? "text-destructive" : "text-warning")}>{unscheduled > 0 ? `${money(unscheduled)} left to schedule` : `${money(-unscheduled)} over the total`}</span>
                          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={balanceLast}>Fix last</Button>
                        </>}
                  </div>
                </div>
                {err.parts && <p role="alert" className="text-xs text-destructive">{err.parts}</p>}
              </div>
            )}
          </Section>

          {/* Methods */}
          <Section n={4} title="How can they pay?">
            <div className="grid gap-2 sm:grid-cols-3">
              {PAY_METHODS.map((m) => {
                const Icon = methodIcon(m.id);
                const on = f.methods.includes(m.id);
                const off = m.id === "crypto" && payStatus?.live && !payStatus.cryptoLive;
                return (
                  <label key={m.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm transition-colors", on ? "border-primary bg-primary/5" : "hover:bg-accent")}>
                    <Checkbox checked={on} onCheckedChange={(v) => set("methods", ALL_METHODS.filter((x) => (x === m.id ? v : f.methods.includes(x))))} />
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="min-w-0"><span className="block font-medium">{m.label}</span>{off && <span className="block text-[11px] text-muted-foreground">Not switched on yet</span>}</span>
                  </label>
                );
              })}
            </div>
            {err.methods && <p role="alert" className="mt-2 text-xs text-destructive">{err.methods}</p>}
            <p className="mt-2 text-[11px] text-muted-foreground">Clients pay from your pay link on Stripe&apos;s secure checkout, no account needed. Each paid milestone lands in Money automatically.</p>
            {!canLink && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground"><AlertCircle className="mt-px size-3.5 shrink-0" />Pay links need the server, so they&apos;re off in this demo. You can still create the invoice and mark payments by hand.</p>}
            {canLink && payStatus && !payStatus.live && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning"><AlertCircle className="mt-px size-3.5 shrink-0" />Online payment isn&apos;t switched on yet: your client will see the invoice but can&apos;t pay online until Stripe is connected.</p>}
          </Section>

          {/* Notes */}
          <Section n={5} title="Anything else?">
            <Textarea id="b-notes" aria-label="Notes" rows={3} maxLength={2000} placeholder="Payment terms, thank-you note…" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </Section>

          <div className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur md:-mx-6 md:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <Button type="button" variant="outline" className="flex-1 sm:flex-none" disabled={saving || locked} onClick={() => save("draft")}>Save draft</Button>
            <Button type="submit" variant="gradient" className="flex-1 sm:flex-none" disabled={saving || locked}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : canLink ? <Send className="size-4" /> : <Sparkles className="size-4" />}
              {editing ? "Save changes" : canLink ? "Create & send" : "Create invoice"}
            </Button>
          </div>
        </form>

        <aside className={cn("min-w-0", view === "edit" && "hidden lg:block")}>
          <div className="lg:sticky lg:top-2">
            <p className="mb-2 hidden text-xs font-medium text-muted-foreground lg:block">What your client sees</p>
            {preview}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-[11px] font-bold text-white">{n}</span>
          {title}
        </p>
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ id, label, hint, error, className, children }: { id: string; label: string; hint?: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
