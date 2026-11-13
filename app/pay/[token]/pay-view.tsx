"use client";
import * as React from "react";
import Link from "next/link";
import {
  AlertCircle, Bot, CheckCircle2, Circle, Coins, CreditCard, Loader2, Lock, RefreshCw, SearchX, ShieldCheck, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { API_URL, fetchWithTimeout } from "@/lib/api";
import { cn } from "@/lib/utils";

type Method = "debit" | "credit" | "crypto";
type Part = { id: string; title: string; amount: number; due: string; status: "due" | "paid"; paidOn: string | null; paidVia: string | null };
type PayPage = {
  business: string; number: string; client: string; description: string; currency: string;
  methods: Method[]; live: boolean; cryptoLive: boolean; milestones: Part[]; total: number; paid: number; remaining: number;
  // Printed breakdown (absent on links created before it existed).
  lineItems?: { description: string; quantity: number; unitPrice: number; amount: number }[];
  subtotal?: number | null; discount?: number; taxRate?: number; tax?: number; notes?: string; issued?: string; due?: string;
};

const METHODS: Record<Method, { label: string; hint: string; icon: typeof CreditCard }> = {
  debit: { label: "Debit card", hint: "Visa, Mastercard and more", icon: CreditCard },
  credit: { label: "Credit card", hint: "Visa, Mastercard, Amex and more", icon: CreditCard },
  crypto: { label: "Crypto", hint: "USDC stablecoin from your wallet", icon: Coins },
};
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (n: number) => usd.format(n);
const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "");

export function PayView({ token, returnStatus }: { token: string; returnStatus: "success" | "cancelled" | null }) {
  const [state, setState] = React.useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [page, setPage] = React.useState<PayPage | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState<Method | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [banner, setBanner] = React.useState(returnStatus);

  const load = React.useCallback(async () => {
    if (!API_URL) { setState("error"); return; }
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/pay/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (res.status === 404) { setState("notfound"); return; }
      if (!res.ok) throw new Error(String(res.status));
      setPage(await res.json());
      setState("ready");
    } catch {
      setState((s) => (s === "ready" ? s : "error"));
    }
  }, [token]);

  React.useEffect(() => { load(); }, [load]);

  // Back from Stripe: drop ?status from the address bar, and refresh a few
  // times, since the payment confirmation (webhook) can land a moment later.
  React.useEffect(() => {
    if (!returnStatus) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (returnStatus !== "success") return;
    let n = 0;
    const timer = setInterval(() => { n += 1; load(); if (n >= 10) clearInterval(timer); }, 3000);
    return () => clearInterval(timer);
  }, [returnStatus, load]);

  if (state === "loading") {
    return <Shell><div className="flex flex-col items-center gap-3 py-24 text-sm text-muted-foreground"><Loader2 className="size-6 animate-spin text-primary" />Loading your invoice…</div></Shell>;
  }
  if (state === "notfound") {
    return (
      <Shell>
        <Notice icon={<SearchX className="size-6" />} title="This payment link isn't valid"
          body="It may have been withdrawn, or the link was copied incompletely. Ask the sender for a new link." />
      </Shell>
    );
  }
  if (state === "error" || !page) {
    return (
      <Shell>
        <Notice icon={<AlertCircle className="size-6" />} title="We couldn't load this invoice"
          body={API_URL ? "Check your connection and try again. Nothing has been charged." : "Online payments aren't available in this demo."}
          action={API_URL ? <Button variant="outline" onClick={() => { setState("loading"); load(); }}><RefreshCw className="size-4" /> Try again</Button> : undefined} />
      </Shell>
    );
  }

  const due = page.milestones.filter((m) => m.status === "due");
  const part = due.find((m) => m.id === selected) ?? due[0] ?? null;
  const usable = (m: Method) => m !== "crypto" || page.cryptoLive;
  const chosen = method && page.methods.includes(method) && usable(method) ? method : page.methods.find(usable) ?? null;
  const split = page.milestones.length > 1;
  const who = page.business || "the sender";

  const pay = async () => {
    if (!part || !chosen) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/pay/${encodeURIComponent(token)}/checkout`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: chosen, milestoneId: part.id }),
      }, 30_000);
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.url === "string" && data.url.startsWith("https://")) {
        window.location.assign(data.url);
        return; // stay busy while the browser leaves
      }
      setError(typeof data.detail === "string" ? data.detail : "Something went wrong, so nothing was charged. Try again in a moment.");
      if (res.status === 409) load();
    } catch {
      setError("Couldn't reach the payment service, so nothing was charged. Check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <Shell>
      {banner === "success" && (
        <Banner tone="success" onClose={() => setBanner(null)} icon={<CheckCircle2 className="size-4" />}>
          Thank you, your payment went through. It can take a minute to show as paid below.
        </Banner>
      )}
      {banner === "cancelled" && (
        <Banner tone="muted" onClose={() => setBanner(null)} icon={<XCircle className="size-4" />}>
          Payment cancelled. Nothing was charged.
        </Banner>
      )}

      <div className="grid gap-5 md:grid-cols-5">
        {/* Invoice */}
        <Card className="md:col-span-3">
          <CardContent className="p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Invoice {page.number}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{page.business || "Invoice"}</h1>
            {page.client && <p className="mt-1 text-sm text-muted-foreground">Billed to {page.client}</p>}
            {(page.issued || page.due) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {page.issued && `Issued ${fmtDate(page.issued)}`}{page.issued && page.due && " · "}{page.due && `Due ${fmtDate(page.due)}`}
              </p>
            )}
            {page.description && <p className="mt-4 whitespace-pre-line text-sm">{page.description}</p>}

            {page.lineItems && page.lineItems.length > 0 && (
              <div className="mt-5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b pb-2 text-[11px] uppercase tracking-wide text-muted-foreground"><span>Item</span><span className="text-right">Amount</span></div>
                <ul className="divide-y">
                  {page.lineItems.map((l, n) => (
                    <li key={n} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2 text-sm">
                      <span className="min-w-0 break-words">{l.description}<span className="block text-[11px] text-muted-foreground">{l.quantity} × {money(l.unitPrice)}</span></span>
                      <span className="text-right font-medium">{money(l.amount)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="ml-auto mt-2 w-full max-w-[15rem] space-y-1 text-sm">
                  {page.subtotal != null && <div className="flex justify-between text-muted-foreground"><dt>Subtotal</dt><dd className="text-foreground">{money(page.subtotal)}</dd></div>}
                  {!!page.discount && <div className="flex justify-between text-muted-foreground"><dt>Discount</dt><dd className="text-foreground">−{money(page.discount)}</dd></div>}
                  {!!page.tax && <div className="flex justify-between text-muted-foreground"><dt>Tax ({page.taxRate}%)</dt><dd className="text-foreground">{money(page.tax)}</dd></div>}
                </dl>
              </div>
            )}

            <dl className="mt-5 grid grid-cols-3 gap-3 rounded-xl border bg-muted/30 p-4 text-center">
              <div><dt className="text-[11px] text-muted-foreground">Total</dt><dd className="mt-0.5 font-semibold">{money(page.total)}</dd></div>
              <div><dt className="text-[11px] text-muted-foreground">Paid</dt><dd className="mt-0.5 font-semibold text-success">{money(page.paid)}</dd></div>
              <div><dt className="text-[11px] text-muted-foreground">Remaining</dt><dd className="mt-0.5 font-bold gradient-text">{money(page.remaining)}</dd></div>
            </dl>
            {page.paid > 0 && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Paid so far" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((page.paid / Math.max(page.total, 0.01)) * 100)}>
                <div className="h-full rounded-full bg-gradient-to-r from-success to-primary" style={{ width: `${Math.min(100, (page.paid / Math.max(page.total, 0.01)) * 100)}%` }} />
              </div>
            )}

            {split && (
              <div className="mt-5">
                <p className="mb-2 text-sm font-semibold">Payment schedule <span className="font-normal text-muted-foreground">· choose what to pay now</span></p>
                <div role="radiogroup" aria-label="Choose what to pay" className="space-y-2">
                  {page.milestones.map((m) => {
                    const paid = m.status === "paid";
                    const active = !paid && part?.id === m.id;
                    return (
                      <button key={m.id} type="button" role="radio" aria-checked={active} disabled={paid}
                        onClick={() => setSelected(m.id)}
                        className={cn("flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                          paid ? "cursor-default bg-muted/30 opacity-80" : active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50")}>
                        {paid ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <Circle className={cn("size-5 shrink-0", active ? "fill-primary text-primary" : "text-muted-foreground")} />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium"><span className="mr-1.5 text-muted-foreground">{page.milestones.indexOf(m) + 1}.</span>{m.title}</span>
                          <span className="block text-[11px] text-muted-foreground">{paid ? `Paid ${fmtDate(m.paidOn)}` : m.due ? `Due ${fmtDate(m.due)}` : "Due now"}</span>
                        </span>
                        <span className={cn("text-sm font-semibold", paid && "text-muted-foreground line-through decoration-1")}>{money(m.amount)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {page.notes && <p className="mt-5 whitespace-pre-line border-t pt-4 text-xs text-muted-foreground">{page.notes}</p>}
          </CardContent>
        </Card>

        {/* Payment — first on phones when there's nothing to choose */}
        <Card className={cn("h-fit md:sticky md:top-6 md:col-span-2", !split && "order-first md:order-none")}>
          <CardContent className="p-5 sm:p-6">
            {!part ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success"><CheckCircle2 className="size-6" /></span>
                <p className="mt-1 font-semibold">Paid in full</p>
                <p className="text-sm text-muted-foreground">Nothing left to pay on this invoice. Thank you!</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{split ? `Paying: ${part.title}` : "Amount due"}</p>
                <p className="mt-0.5 text-3xl font-extrabold tracking-tight">{money(part.amount)}</p>
                {part.due && <p className="text-xs text-muted-foreground">Due {fmtDate(part.due)}</p>}

                <p className="mb-2 mt-5 text-sm font-semibold">Pay with</p>
                <div role="radiogroup" aria-label="Payment method" className="space-y-2">
                  {page.methods.map((m) => {
                    const info = METHODS[m];
                    const ok = usable(m);
                    const active = chosen === m;
                    return (
                      <button key={m} type="button" role="radio" aria-checked={active} disabled={!ok || !page.live}
                        onClick={() => setMethod(m)}
                        className={cn("flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                          active && page.live ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50")}>
                        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", m === "crypto" ? "bg-gradient-to-br from-fuchsia-500 to-cyan-400 text-white" : "bg-gradient-to-br from-primary to-purple-500 text-white")}>
                          <info.icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{info.label}</span>
                          <span className="block text-[11px] text-muted-foreground">{ok ? info.hint : "Not available yet"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {!page.live && (
                  <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    Online payment isn&apos;t switched on for this invoice yet, so nothing can be charged here. Contact {who} to arrange payment.
                  </p>
                )}
                {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{error}</p>}

                <Button variant="gradient" size="xl" className="mt-5 w-full" disabled={!page.live || !chosen || busy} onClick={pay}>
                  {busy ? <><Loader2 className="size-4 animate-spin" /> Opening secure checkout…</> : <><Lock className="size-4" /> Pay {money(part.amount)}</>}
                </Button>
                <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <ShieldCheck className="mt-px size-3.5 shrink-0" />
                  You&apos;ll finish on Stripe&apos;s secure checkout. Autopilot never sees your card number or wallet keys.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="aurora pointer-events-none absolute inset-x-0 top-0 h-72" aria-hidden />
      <header className="relative mx-auto flex h-16 w-full max-w-4xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-purple-500 text-white"><Bot className="size-4" /></span>
          Autopilot
        </Link>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="size-3.5" /> Secure payment</span>
      </header>
      <main className="relative mx-auto w-full max-w-4xl px-4 pb-16 pt-4">{children}</main>
    </div>
  );
}

function Notice({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">{icon}</span>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        {action}
      </CardContent>
    </Card>
  );
}

function Banner({ tone, icon, onClose, children }: { tone: "success" | "muted"; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="status" className={cn("mb-5 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
      tone === "success" ? "border-success/40 bg-success/10 text-success" : "bg-muted/50 text-muted-foreground")}>
      <span className="mt-0.5">{icon}</span>
      <span className="flex-1">{children}</span>
      <button type="button" onClick={onClose} className="text-xs underline-offset-2 hover:underline">Dismiss</button>
    </div>
  );
}
