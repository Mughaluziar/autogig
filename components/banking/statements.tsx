"use client";
import * as React from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/capital";
import { statementCsv, thisMonth, useStatement } from "@/lib/banking";
import { shortDate } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { Figure, Frame, Loading } from "@/components/marketplace/common";
import { bankingLinks } from "./links";

function recentMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function StatementsView({ base, full }: { base: string; full: boolean }) {
  const months = React.useMemo(() => recentMonths(12), []);
  const [month, setMonth] = React.useState(thisMonth());
  const { data, loaded } = useStatement(month);

  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([statementCsv(data)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `autopilot-statement-${month}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Frame kind="banking" links={bankingLinks(base, { full })} title="Statements"
      description="Every movement in your USD and USDC balances, month by month, from the same ledger that settles them.">
      <div className="space-y-4">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          {months.map((m) => (
            <button key={m} type="button" aria-pressed={month === m} onClick={() => setMonth(m)}
              className={cn("h-9 shrink-0 rounded-full border px-3.5 text-xs font-medium",
                month === m ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>
              {new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })}
            </button>
          ))}
        </div>
        {!loaded ? <Loading /> : !data ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load this statement.</p>
        ) : (
          <section className="panel min-w-0 p-0">
            <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-primary" /> {monthLabel(month)}</p>
                <p className="text-xs text-muted-foreground">Simulated settlement · amounts in USD and USDC</p>
              </div>
              <Button variant="outline" size="sm" onClick={download} disabled={!data.rows.length}><Download /> CSV</Button>
            </div>
            <div className="grid grid-cols-2 gap-4 border-b p-5 md:grid-cols-4">
              <Figure label="Opening" value={usd(data.openingCents.usd + data.openingCents.usdc)} />
              <Figure label="Money in" value={usd(data.inCents)} tone={data.inCents ? "good" : undefined} />
              <Figure label="Money out" value={usd(data.outCents)} />
              <Figure label="Closing" value={usd(data.closingCents.usd + data.closingCents.usdc)}
                hint={`${usd(data.closingCents.usd)} USD · ${usd(data.closingCents.usdc)} USDC`} />
            </div>
            {data.rows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">No activity this month.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.rows.map((r) => (
                  <li key={r.seq} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate">{r.memo}</p>
                      <p className="text-xs text-muted-foreground">{shortDate(r.at)}</p>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      {r.usdCents !== 0 && <p className={r.usdCents > 0 ? "text-success" : ""}>{r.usdCents > 0 ? "+" : "−"}{usd(Math.abs(r.usdCents))}</p>}
                      {r.usdcCents !== 0 && <p className={cn("text-xs", r.usdcCents > 0 ? "text-success" : "text-muted-foreground")}>{r.usdcCents > 0 ? "+" : "−"}{usd(Math.abs(r.usdcCents))} USDC</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Frame>
  );
}
