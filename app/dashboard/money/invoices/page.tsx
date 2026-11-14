"use client";
import * as React from "react";
import Link from "next/link";
import { AlertCircle, ChevronRight, FileText, Link2, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useMoney } from "@/components/money/money-provider";
import { ClientMark, daysUntil, fmtShortDate, MethodChips, methodsOf, money, moneyRound, StatusPill } from "@/components/money/format";
import { amountDue, effectiveStatus, payableParts, todayStr } from "@/lib/ledger";
import { cn } from "@/lib/utils";

const FILTERS = ["All", "Draft", "Sent", "Overdue", "Paid"] as const;

export default function InvoicesPage(props: { searchParams: Promise<{ status?: string }> }) {
  const searchParams = React.use(props.searchParams);
  const { L, canLink, payStatus, share, linkBusy } = useMoney();
  const initial = FILTERS.find((s) => s === searchParams.status) ?? "All";
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>(initial);
  const [q, setQ] = React.useState("");

  const today = todayStr();
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  const since = monthAgo.toISOString().slice(0, 10);
  const counts = Object.fromEntries(FILTERS.map((f) => [f, f === "All" ? L.invoices.length : L.invoices.filter((i) => effectiveStatus(i) === f).length]));
  const sent = L.invoices.filter((i) => i.status !== "Draft");
  const outstanding = sent.reduce((n, i) => n + amountDue(i), 0);
  const overdueAmt = sent.reduce((n, i) => n + payableParts(i).filter((m) => m.status === "Due" && m.due && m.due < today).reduce((a, m) => a + m.amount, 0), 0);
  const paid30 = L.txns.filter((t) => t.type === "income" && t.invoiceId && t.date >= since).reduce((n, t) => n + t.amount, 0);

  const list = L.invoices
    .filter((i) => filter === "All" || effectiveStatus(i) === filter)
    .filter((i) => !q.trim() || `${i.client} ${i.number} ${i.description} ${i.email}`.toLowerCase().includes(q.trim().toLowerCase()));

  if (!L.ready) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading invoices…</div>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Summary label="Outstanding" value={moneyRound(outstanding)} />
        <Summary label="Overdue" value={moneyRound(overdueAmt)} tone={overdueAmt > 0 ? "text-destructive" : undefined} />
        <Summary label="Paid · 30 days" value={moneyRound(paid30)} tone={paid30 > 0 ? "text-success" : undefined} />
      </div>

      {!canLink ? (
        <p className="flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />Pay links need the server, so they&apos;re off in this demo. You can still create invoices and milestones and mark payments by hand.</p>
      ) : payStatus && !payStatus.live ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs"><AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />Online payment isn&apos;t switched on yet. Pay links show clients the invoice and milestones, but they can&apos;t pay online until Stripe is connected. Nothing is charged.</p>
      ) : null}

      {L.invoices.length === 0 ? (
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col items-center gap-3 bg-gradient-to-b from-primary/10 to-transparent py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-lg shadow-primary/30"><FileText className="size-7" /></span>
            <p className="text-lg font-semibold">Send your first invoice</p>
            <p className="max-w-sm text-sm text-muted-foreground">Add what you did, split it into milestones if you like, and share one link. Your client pays by debit card, credit card or crypto, and it lands here.</p>
            <Button variant="gradient" asChild><Link href="/dashboard/money/invoices/new"><Plus className="size-4" /> Create invoice</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
              <div className="inline-flex min-w-max gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Invoice status">
                {FILTERS.map((s) => (
                  <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)}
                    className={cn("inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium", filter === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {s}<span className="text-[10px] opacity-70">{counts[s]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="relative min-w-0 flex-1 sm:max-w-xs sm:ml-auto">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search invoices" className="h-9 pl-9" placeholder="Search client or number" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          {list.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No {filter === "All" ? "" : `${filter.toLowerCase()} `}invoices{q ? " match your search" : ""}.</CardContent></Card>
          ) : (
            <ul className="space-y-2.5" data-testid="invoice-list">
              {list.map((i) => {
                const st = effectiveStatus(i);
                const parts = payableParts(i);
                const paidParts = parts.filter((m) => m.status === "Paid");
                const left = amountDue(i);
                const nextDue = parts.filter((m) => m.status === "Due" && m.due).map((m) => m.due).sort()[0] || i.due;
                const d = nextDue ? daysUntil(nextDue) : null;
                const partial = st !== "Paid" && paidParts.length > 0;
                return (
                  <li key={i.id} data-testid="invoice-row">
                    <Card className="transition-colors hover:border-primary/40">
                      <CardContent className="flex items-center gap-3 p-3.5 sm:p-4">
                        <ClientMark name={i.client} className="hidden sm:flex" />
                        <Link href={`/dashboard/money/invoices/${i.id}`} className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-semibold">{i.client}</p>
                            <StatusPill status={partial ? "Partial" : st} className="shrink-0" />
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {i.number}{i.description ? ` · ${i.description}` : ""}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className={cn("text-[11px]", st === "Overdue" ? "font-medium text-destructive" : "text-muted-foreground")}>
                              {st === "Paid" ? `Paid ${fmtShortDate(i.paidOn)}` : d === null ? "No due date" : d < 0 ? `${-d}d overdue` : d === 0 ? "Due today" : `Due ${fmtShortDate(nextDue)}`}
                            </span>
                            <MethodChips methods={methodsOf(i)} className="hidden md:inline-flex" />
                            {i.payToken && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"><Link2 className="size-3" />Link</span>}
                          </div>
                          {i.milestones?.length ? (
                            <div className="mt-2 flex items-center gap-2">
                              <Progress value={((i.amount - left) / Math.max(i.amount, 0.01)) * 100} className="h-1.5 max-w-[12rem]" />
                              <span className="text-[11px] text-muted-foreground">{paidParts.length}/{parts.length} paid</span>
                            </div>
                          ) : null}
                        </Link>
                        <div className="shrink-0 text-right">
                          <p className="font-bold">{money(st === "Paid" ? i.amount : left || i.amount)}</p>
                          <p className="text-[11px] text-muted-foreground">{st === "Paid" ? "received" : partial ? `of ${money(i.amount)}` : "due"}</p>
                        </div>
                        {st !== "Paid" ? (
                          <Button size="icon" variant="ghost" className="size-9 shrink-0" aria-label={`Share pay link for ${i.number}`} disabled={linkBusy === i.id} onClick={() => share(i)}>
                            {linkBusy === i.id ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                          </Button>
                        ) : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-3 sm:p-4">
      <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{label}</p>
      <p className={cn("mt-0.5 truncate text-lg font-bold tracking-tight sm:text-2xl", tone)}>{value}</p>
    </div>
  );
}
