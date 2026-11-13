"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Download, FileText, Loader2, Search, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useMoney } from "@/components/money/money-provider";
import { fmtShortDate, money, moneyRound } from "@/components/money/format";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, monthKey, toCsv, todayStr } from "@/lib/ledger";
import { cn } from "@/lib/utils";

const monthLabel = (key: string) => new Date(`${key}-01T00:00:00`).toLocaleDateString("en", { month: "long", year: "numeric" });

export default function TransactionsPage() {
  const { L, openTxn } = useMoney();
  const { toast } = useToast();
  const [q, setQ] = React.useState("");
  const [type, setType] = React.useState<"all" | "income" | "expense">("all");
  const [cat, setCat] = React.useState("all");
  const [month, setMonth] = React.useState("all");
  const [del, setDel] = React.useState<string | null>(null);

  const months = Array.from(new Set(L.txns.map((t) => monthKey(t.date)))).sort().reverse();
  const cats = Array.from(new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES, ...L.txns.map((t) => t.category)]));
  const rows = L.txns
    .filter((t) => type === "all" || t.type === type)
    .filter((t) => cat === "all" || t.category === cat)
    .filter((t) => month === "all" || monthKey(t.date) === month)
    .filter((t) => !q.trim() || `${t.party} ${t.category} ${t.note}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));
  const inSum = rows.filter((t) => t.type === "income").reduce((n, t) => n + t.amount, 0);
  const outSum = rows.filter((t) => t.type === "expense").reduce((n, t) => n + t.amount, 0);
  const groups = rows.reduce<{ key: string; items: typeof rows }[]>((acc, t) => {
    const k = monthKey(t.date);
    const g = acc.find((x) => x.key === k);
    if (g) g.items.push(t); else acc.push({ key: k, items: [t] });
    return acc;
  }, []);
  const spend = Object.entries(rows.filter((t) => t.type === "expense").reduce<Record<string, number>>((m, t) => { m[t.category] = (m[t.category] ?? 0) + t.amount; return m; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 5);

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `transactions-${todayStr()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  if (!L.ready) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading transactions…</div>;

  if (L.txns.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10"><Wallet className="size-7 text-primary" /></span>
          <p className="text-lg font-semibold">No transactions yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Payments through your pay links are added automatically. Record other income and your business expenses to see your real profit.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="gradient" onClick={() => openTxn("income")}><ArrowDownLeft className="size-4" /> Record income</Button>
            <Button variant="outline" onClick={() => openTxn("expense")}><ArrowUpRight className="size-4" /> Record expense</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-52">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search transactions" className="h-9 pl-9" placeholder="Search client, category or note" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Type">
              {([["all", "All"], ["income", "In"], ["expense", "Out"]] as const).map(([v, l]) => (
                <button key={v} aria-pressed={type === v} onClick={() => setType(v)} className={cn("rounded-md px-3 py-1 text-xs font-medium", type === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select aria-label="Category" className="h-9 sm:w-44" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="all">All categories</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select aria-label="Month" className="h-9 sm:w-44" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="all">All time</option>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </Select>
            <Button variant="outline" size="sm" className="col-span-2 h-9 sm:ml-auto" disabled={!rows.length} onClick={exportCsv}><Download className="size-4" /> Export CSV</Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Total label="Money in" value={inSum} tone="text-success" />
          <Total label="Money out" value={outSum} />
          <Total label="Net" value={inSum - outSum} tone={inSum - outSum < 0 ? "text-destructive" : undefined} />
        </div>

        {rows.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No transactions match these filters.</CardContent></Card>
        ) : groups.map((g) => (
          <section key={g.key} aria-label={monthLabel(g.key)}>
            <p className="mb-1.5 flex justify-between px-1 text-xs font-semibold text-muted-foreground">
              <span>{monthLabel(g.key)}</span>
              <span>{money(g.items.reduce((n, t) => n + (t.type === "income" ? t.amount : -t.amount), 0))}</span>
            </p>
            <Card><CardContent className="divide-y p-0" data-testid="txn-list">
              {g.items.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-3.5 py-3 sm:px-4" data-testid="txn-row">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", t.type === "income" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
                    {t.type === "income" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.party || t.category}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.category} · {fmtShortDate(t.date)}{t.note ? ` · ${t.note}` : ""}</p>
                  </div>
                  {t.invoiceId && <Link href={`/dashboard/money/invoices/${t.invoiceId}`} className="hidden text-muted-foreground hover:text-primary sm:block" aria-label="Open invoice"><FileText className="size-4" /></Link>}
                  <p className={cn("text-sm font-semibold", t.type === "income" && "text-success")}>{t.type === "income" ? "+" : "−"}{money(t.amount)}</p>
                  {del === t.id ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="destructive" onClick={() => { L.deleteTxn(t.id); setDel(null); toast({ title: "Transaction deleted" }); }}>Delete</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDel(null)}>Keep</Button>
                    </div>
                  ) : (
                    <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="Delete transaction" onClick={() => setDel(t.id)} disabled={!!t.invoiceId}
                      title={t.invoiceId ? "Undo the payment on its invoice instead" : undefined}><Trash2 className="size-4 text-muted-foreground" /></Button>
                  )}
                </div>
              ))}
            </CardContent></Card>
          </section>
        ))}
      </div>

      <aside className="space-y-4">
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-semibold">Record</p>
            <Button className="w-full justify-start" variant="outline" onClick={() => openTxn("income")}><ArrowDownLeft className="size-4 text-success" /> Income received</Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => openTxn("expense")}><ArrowUpRight className="size-4" /> Expense</Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-semibold">Where it goes</p>
            {spend.length === 0 ? <p className="text-xs text-muted-foreground">No expenses in this view.</p> : (
              <div className="space-y-3">
                {spend.map(([c, v]) => (
                  <div key={c}>
                    <div className="flex justify-between text-xs"><span className="truncate">{c}</span><span className="font-semibold">{moneyRound(v)}</span></div>
                    <Progress value={(v / Math.max(outSum, 1)) * 100} className="mt-1 h-1.5" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-2.5">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("truncate text-base font-bold sm:text-lg", tone)}>{moneyRound(value)}</p>
    </div>
  );
}
