"use client";
import * as React from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { usd } from "@/lib/capital";
import {
  amount, defaultPeriod, downloadJournalCsv, kindLabel, loadReport, periodError, utcDay, type TreasuryReport,
} from "@/lib/treasury";

type Period = { start: string; end: string };
type Result = { period: Period; report: TreasuryReport | null; error: string | null };

const PRESETS: { label: string; period: () => Period }[] = [
  { label: "This month", period: () => defaultPeriod() },
  { label: "Last 30 days", period: () => ({ start: utcDay(new Date(Date.now() - 29 * 86_400_000)), end: utcDay(new Date()) }) },
  { label: "This year", period: () => ({ start: `${utcDay(new Date()).slice(0, 4)}-01-01`, end: utcDay(new Date()) }) },
];

/** Period report with an inclusive UTC date range, plus the journal export for the same range. */
export function PeriodReport() {
  const { toast } = useToast();
  const [form, setForm] = React.useState<Period>(defaultPeriod);
  const [applied, setApplied] = React.useState<Period>(form);
  const [result, setResult] = React.useState<Result | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const invalid = periodError(form.start, form.end);
  const loading = result?.period !== applied;

  React.useEffect(() => {
    let cancelled = false;
    void loadReport(applied.start, applied.end).then((r) => {
      if (cancelled) return;
      setResult({ period: applied, report: r.data, error: r.data ? null : r.detail ?? (r.status === 0 ? "Can't reach the server." : `The report failed (${r.status}).`) });
    });
    return () => { cancelled = true; };
  }, [applied]);

  const run = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invalid) setApplied({ ...form });
  };
  const exportCsv = async () => {
    setExporting(true);
    const error = await downloadJournalCsv(form.start, form.end);
    setExporting(false);
    if (error) toast({ title: "Export did not download", description: error });
  };

  const r = result?.report;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Period report</CardTitle>
        <CardDescription>Dates are inclusive and in UTC, up to 366 days. Opening and closing balances are rebuilt from the journal.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={run} className="space-y-3" aria-label="Report period">
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="treasury-start">Start</Label>
              <Input id="treasury-start" type="date" value={form.start} max={form.end || undefined} required
                onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} aria-invalid={!!invalid} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="treasury-end">End</Label>
              <Input id="treasury-end" type="date" value={form.end} min={form.start || undefined} required
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} aria-invalid={!!invalid} />
            </div>
            <div className="col-span-2 flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={!!invalid}>Run report</Button>
              <Button type="button" variant="outline" size="sm" disabled={!!invalid || exporting} onClick={() => void exportCsv()}>
                {exporting ? <Loader2 className="animate-spin" /> : <Download />} Journal CSV
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.label} type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                onClick={() => { const next = p.period(); setForm(next); setApplied(next); }}>
                {p.label}
              </Button>
            ))}
          </div>
          {invalid && <p role="alert" className="text-xs text-destructive">{invalid}</p>}
          <p className="text-xs text-muted-foreground">The CSV has one row per ledger line and names customer accounts, so treat it as confidential.</p>
        </form>

        {loading ? (
          <p role="status" className="py-6 text-center text-sm text-muted-foreground">Building the report…</p>
        ) : result?.error ? (
          <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">{result.error}</p>
        ) : r ? (
          <ReportBody r={r} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-1 ${strong ? "border-t font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}

function ReportBody({ r }: { r: TreasuryReport }) {
  const moneyIn = r.external.reduce((n, x) => n + x.inCents, 0);
  const moneyOut = r.external.reduce((n, x) => n + x.outCents, 0);
  return (
    <div className="space-y-5" data-testid="treasury-report">
      <p className="text-sm">
        <span className="font-medium">{r.start} to {r.end}</span>
        <span className="text-muted-foreground"> · {r.entries.toLocaleString("en-US")} ledger {r.entries === 1 ? "entry" : "entries"} · simulated</span>
      </p>
      {r.entries === 0 && <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No ledger entries in this period. Opening and closing balances are shown below.</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold">Income</h3>
          <dl className="text-sm">
            <Row label="Pool fee income" value={usd(r.income.poolFeeIncomeCents)} />
            <Row label="Protection premiums" value={usd(r.income.protectionPremiumsCents)} />
            <Row label="Protection fee share" value={usd(r.income.protectionFeeShareCents)} />
            <Row label="Platform income" value={usd(r.income.platformIncomeCents)} />
            <Row label="Marketplace fees" value={usd(r.income.marketplaceFeesCents)} />
            <Row label="Credit fees" value={usd(r.income.creditFeesCents)} />
            <Row label="Total" value={usd(r.income.totalCents)} strong />
          </dl>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold">Losses</h3>
          <dl className="text-sm">
            <Row label="Pool write-offs" value={usd(r.losses.poolWriteOffsCents)} />
            <Row label="Pool recoveries" value={`−${usd(r.losses.poolRecoveriesCents)}`} />
            <Row label="Credit write-offs" value={usd(r.losses.creditWriteOffsCents)} />
            <Row label="Credit recoveries" value={`−${usd(r.losses.creditRecoveriesCents)}`} />
            <Row label="Protection payouts" value={usd(r.losses.protectionPayoutsCents)} />
            <Row label="Total" value={usd(r.losses.totalCents)} strong />
          </dl>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold">Money in and out</h3>
          {r.external.length === 0 ? <p className="text-sm text-muted-foreground">Nothing crossed an external account.</p> : (
            <dl className="text-sm">
              {r.external.map((x) => (
                <div key={x.account} className="py-1">
                  <dt className="break-all font-mono text-xs text-muted-foreground">{x.account}</dt>
                  <dd className="flex justify-between gap-2 tabular-nums"><span>in {usd(x.inCents)}</span><span>out {usd(x.outCents)}</span></dd>
                </div>
              ))}
              <Row label="Net in" value={usd(moneyIn - moneyOut)} strong />
            </dl>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold">Balances by program</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-left text-sm">
            <caption className="sr-only">Opening balance, net flow and closing balance for each program</caption>
            <thead className="text-xs text-muted-foreground">
              <tr><th scope="col" className="py-1">Program</th><th scope="col" className="text-right">Opening</th><th scope="col" className="text-right">Net flow</th><th scope="col" className="text-right">Closing</th></tr>
            </thead>
            <tbody>
              {r.groups.map((g) => (
                <React.Fragment key={`${g.key}:${g.unit}`}>
                  <tr className="border-t font-medium">
                    <th scope="row" className="py-1.5 font-medium">{g.label}{g.unit !== "USD" ? ` (${g.unit})` : ""}</th>
                    <td className="text-right tabular-nums">{amount(g.opening, g.unit)}</td>
                    <td className="text-right tabular-nums">{amount(g.netFlow, g.unit)}</td>
                    <td className="text-right tabular-nums">{amount(g.closing, g.unit)}</td>
                  </tr>
                  {g.accounts.map((a) => (
                    <tr key={a.account} className="text-xs text-muted-foreground">
                      <td className="break-all py-0.5 pl-3 font-mono">{a.account}</td>
                      <td className="text-right tabular-nums">{amount(a.opening, g.unit)}</td>
                      <td className="text-right tabular-nums">{amount(a.closing - a.opening, g.unit)}</td>
                      <td className="text-right tabular-nums">{amount(a.closing, g.unit)}</td>
                    </tr>
                  ))}
                  {g.aggregate && (
                    <tr className="text-xs text-muted-foreground">
                      <td className="py-0.5 pl-3">Customer accounts ({g.aggregate.openingCount} → {g.aggregate.closingCount})</td>
                      <td className="text-right tabular-nums">{amount(g.aggregate.opening, g.unit)}</td>
                      <td className="text-right tabular-nums">{amount(g.aggregate.closing - g.aggregate.opening, g.unit)}</td>
                      <td className="text-right tabular-nums">{amount(g.aggregate.closing, g.unit)}</td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold">Flows by entry kind</h3>
        {r.flows.length === 0 ? <p className="text-sm text-muted-foreground">No entries in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[300px] text-left text-sm">
              <caption className="sr-only">Ledger entries in the period by kind, with gross USD moved</caption>
              <thead className="text-xs text-muted-foreground">
                <tr><th scope="col" className="py-1">Kind</th><th scope="col" className="text-right">Entries</th><th scope="col" className="text-right">Gross USD</th></tr>
              </thead>
              <tbody>
                {r.flows.map((f) => (
                  <tr key={f.kind} className="border-t">
                    <td className="py-1.5 capitalize">{kindLabel(f.kind)}</td>
                    <td className="text-right tabular-nums">{f.count.toLocaleString("en-US")}</td>
                    <td className="text-right tabular-nums">{usd(f.grossCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
