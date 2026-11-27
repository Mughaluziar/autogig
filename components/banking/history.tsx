"use client";
import * as React from "react";
import { Download, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiFetch, apiGet } from "@/lib/api";
import { usd } from "@/lib/capital";
import { CATEGORY_LABEL, txnQuery, type TxnCategory, type TxnFilters, type TxnPage, type TxnRow } from "@/lib/banking";
import { errorText, shortDate } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { Figure, Frame, Loading } from "@/components/marketplace/common";
import { bankingLinks } from "./links";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as TxnCategory[];
const EMPTY: TxnFilters = { currency: "", direction: "", category: "", from: "", to: "", q: "" };

/** Every movement of the USD and USDC balances, from the ledger: transfers, card spend, investing, member payments. */
export function TransactionsView({ base, full }: { base: string; full: boolean }) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<TxnFilters>(EMPTY);
  const [filters, setFilters] = React.useState<TxnFilters>(EMPTY);
  const [page, setPage] = React.useState<TxnPage | null>(null);
  const [rows, setRows] = React.useState<TxnRow[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error" | "more">("loading");
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    void apiGet<TxnPage>(`/api/banking/transactions${txnQuery(filters, { limit: 50 })}`).then((d) => {
      if (cancelled) return;
      setPage(d);
      setRows(d?.rows ?? []);
      setState(d ? "ready" : "error");
    });
    return () => { cancelled = true; };
  }, [filters]);

  const more = async () => {
    if (!page?.nextBefore) return;
    setState("more");
    const d = await apiGet<TxnPage>(`/api/banking/transactions${txnQuery(filters, { limit: 50, before: page.nextBefore })}`);
    if (!d) {
      setState("ready");
      toast({ title: "Couldn't load more", description: "Check your connection and try again." });
      return;
    }
    setPage(d);
    setRows((r) => [...r, ...d.rows]);
    setState("ready");
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await apiFetch(`/api/banking/transactions.csv${txnQuery(filters)}`);
      if (!res.ok) {
        toast({ title: "Export failed", description: errorText(await res.json().catch(() => null)) });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `autopilot-transactions-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", description: "Can't reach the server." });
    } finally {
      setExporting(false);
    }
  };

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters({ ...draft, q: draft.q?.trim() });
  };
  const active = Object.values(filters).some(Boolean);
  const set = (k: keyof TxnFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <Frame kind="banking" links={bankingLinks(base, { full })} title="Transactions"
      description="Every movement of your USD and USDC balances, from the same ledger that settles them: transfers, card spend, investing and payments between members.">
      <div className="space-y-4">
        <form onSubmit={apply} className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(5,minmax(0,1fr))_auto] lg:items-end" aria-label="Filter transactions">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="tx-q">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="tx-q" value={draft.q} onChange={set("q")} placeholder="Description" className="pl-8" maxLength={80} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-cat">Category</Label>
            <Select id="tx-cat" value={draft.category} onChange={set("category")}>
              <option value="">All</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-cur">Currency</Label>
            <Select id="tx-cur" value={draft.currency} onChange={set("currency")}>
              <option value="">USD and USDC</option><option value="usd">USD</option><option value="usdc">USDC</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-dir">Direction</Label>
            <Select id="tx-dir" value={draft.direction} onChange={set("direction")}>
              <option value="">In and out</option><option value="in">Money in</option><option value="out">Money out</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-from">From</Label>
            <Input id="tx-from" type="date" value={draft.from} onChange={set("from")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-to">To</Label>
            <Input id="tx-to" type="date" value={draft.to} onChange={set("to")} />
          </div>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
            <Button type="submit" className="flex-1 lg:flex-none">Apply</Button>
            {active && (
              <Button type="button" variant="ghost" aria-label="Clear filters" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); }}><X /></Button>
            )}
          </div>
        </form>

        {state === "loading" ? <Loading /> : state === "error" || !page ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground">
            Couldn&apos;t load transactions. Check the dates, then try again.
            <div className="mt-3"><Button variant="outline" size="sm" onClick={() => setFilters({ ...filters })}>Retry</Button></div>
          </div>
        ) : (
          <section className="panel min-w-0 p-0">
            <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid grid-cols-3 gap-4 sm:gap-8">
                <Figure label="Transactions" value={String(page.count)} />
                <Figure label="Money in" value={usd(page.inCents)} tone={page.inCents ? "good" : undefined} />
                <Figure label="Money out" value={usd(page.outCents)} />
              </div>
              <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting || page.count === 0}>
                {exporting ? <Loader2 className="animate-spin" /> : <Download />} CSV
              </Button>
            </div>
            {rows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">{active ? "No transactions match these filters." : "No transactions yet."}</p>
            ) : (
              <ul className="divide-y text-sm">
                {rows.map((r) => (
                  <li key={r.seq} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate">{r.memo}</p>
                      <p className="text-xs text-muted-foreground">
                        {shortDate(r.at)} · <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{CATEGORY_LABEL[r.category] ?? r.category}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      {r.usdCents !== 0 && <p className={cn(r.usdCents > 0 && "text-success")}>{r.usdCents > 0 ? "+" : "−"}{usd(Math.abs(r.usdCents))}</p>}
                      {r.usdcCents !== 0 && <p className={cn("text-xs", r.usdcCents > 0 ? "text-success" : "text-muted-foreground")}>{r.usdcCents > 0 ? "+" : "−"}{usd(Math.abs(r.usdcCents))} USDC</p>}
                      <p className="text-[11px] text-muted-foreground">Bal. {usd(r.balanceUsdCents)}{r.balanceUsdcCents ? ` · ${usd(r.balanceUsdcCents)} USDC` : ""}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {page.nextBefore && (
              <div className="border-t p-4 text-center">
                <Button variant="outline" size="sm" onClick={() => void more()} disabled={state === "more"}>
                  {state === "more" && <Loader2 className="animate-spin" />} Load more
                </Button>
              </div>
            )}
          </section>
        )}
        <p className="text-[11px] text-muted-foreground">Simulated settlement. Balances shown after each line are running totals of your Autopilot balances.</p>
      </div>
    </Frame>
  );
}
