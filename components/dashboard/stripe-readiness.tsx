"use client";
import * as React from "react";
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Stripe readiness for platform owners (GET /api/payments/stripe/readiness and
 * /api/payments/stripe/events, both owner-only on the server; see docs/payments.md).
 * The live check calls Stripe, so it only runs when the owner asks for it.
 */

type Status = "pass" | "warn" | "fail";
type Check = { id: string; label: string; status: Status; detail: string };
type Readiness = {
  summary: Status; mode: string; key: string; environment: string; webhookUrl: string | null; requiredEvents: string[];
  probed: boolean; checks: Check[];
  account: { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; country: string; defaultCurrency: string } | null;
};
type WebhookEvent = {
  id: string; type: string; livemode: boolean; receivedAt: string | null; outcome: string; attempts: number; duplicates: number;
  refs: Record<string, string>;
};

const STATUS: Record<Status, { label: string; variant: "success" | "warning" | "destructive"; icon: typeof CheckCircle2; tone: string }> = {
  pass: { label: "Ready", variant: "success", icon: CheckCircle2, tone: "text-success" },
  warn: { label: "Check warnings", variant: "warning", icon: AlertTriangle, tone: "text-warning" },
  fail: { label: "Not ready", variant: "destructive", icon: XCircle, tone: "text-destructive" },
};
const OUTCOME: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  applied: "success", duplicate: "secondary", ignored: "secondary", "rejected-amount": "warning", error: "destructive", processing: "warning",
};
const MODE: Record<string, string> = {
  test: "Test mode", live: "Live mode", "restricted-test": "Test mode · restricted key", "restricted-live": "Live mode · restricted key",
  off: "Not configured", unknown: "Unrecognized key",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export function StripeReadinessCard() {
  const [report, setReport] = React.useState<Readiness | null>(null);
  const [events, setEvents] = React.useState<WebhookEvent[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState<"refresh" | "probe" | null>(null);
  const [probeFailed, setProbeFailed] = React.useState(false);

  const load = React.useCallback(async (probe: boolean) => {
    const [r, e] = await Promise.all([
      apiGet<Readiness>(`/api/payments/stripe/readiness?probe=${probe}`),
      apiGet<{ events: WebhookEvent[] }>("/api/payments/stripe/events?limit=25"),
    ]);
    return { r, e: e?.events ?? null };
  }, []);

  React.useEffect(() => {
    let active = true;
    load(false).then(({ r, e }) => {
      if (!active) return;
      if (r) { setReport(r); setEvents(e ?? []); setState("ready"); } else setState("error");
    });
    return () => { active = false; };
  }, [load]);

  const rerun = async (probe: boolean) => {
    setBusy(probe ? "probe" : "refresh");
    setProbeFailed(false);
    const { r, e } = await load(probe);
    setBusy(null);
    if (r) { setReport(r); setState("ready"); } else if (probe) setProbeFailed(true); else setState("error");
    if (e) setEvents(e);
  };

  return (
    <Card className="mb-6" data-testid="stripe-readiness">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="flex items-center gap-2"><CreditCard className="size-5 text-primary" /> Stripe readiness</CardTitle>
          <CardDescription>Platform owners only. Settings are checked on the server; the live check reads your Stripe account and webhook endpoint. Keys are never shown.</CardDescription>
        </div>
        {report && <Badge variant={STATUS[report.summary].variant} className="shrink-0">{STATUS[report.summary].label}</Badge>}
      </CardHeader>
      <CardContent className="space-y-5">
        {state === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking Stripe settings…</p>
        ) : state === "error" || !report ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p className="text-muted-foreground">Couldn&apos;t load the readiness report. The backend may be unreachable.</p>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => rerun(false)}>
              {busy === "refresh" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Try again
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="font-medium">{MODE[report.mode] ?? report.mode}</span>
              {report.key && <code className="text-xs text-muted-foreground">{report.key}</code>}
              <span className="text-xs text-muted-foreground">Server: {report.environment}</span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => rerun(false)}>
                  {busy === "refresh" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null || report.mode === "off"} onClick={() => rerun(true)}>
                  {busy === "probe" && <Loader2 className="animate-spin" />} Run live check
                </Button>
              </span>
            </div>
            {probeFailed && <p role="alert" className="text-xs text-destructive">The live check didn&apos;t finish. Try again in a moment.</p>}
            {!report.probed && report.mode !== "off" && <p className="text-xs text-muted-foreground">Run the live check to confirm the account can take payments and the webhook endpoint is registered.</p>}

            <ul className="divide-y rounded-xl border">
              {report.checks.map((c) => {
                const s = STATUS[c.status];
                return (
                  <li key={c.id} className="flex items-start gap-3 px-3.5 py-2.5 text-sm">
                    <s.icon className={cn("mt-0.5 size-4 shrink-0", s.tone)} aria-label={c.status} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{c.label}</p>
                      <p className="break-words text-xs text-muted-foreground">{c.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Webhook events to subscribe ({report.requiredEvents.length})</summary>
              <p className="mt-2 break-words font-mono">{report.requiredEvents.join(", ")}</p>
              {report.webhookUrl && <p className="mt-1 break-all">Endpoint: <code>{report.webhookUrl}</code></p>}
            </details>

            <div>
              <p className="mb-2 text-sm font-semibold">Recent webhook events</p>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No webhook events received yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Received</TableHead><TableHead>Event</TableHead><TableHead>Outcome</TableHead><TableHead className="hidden md:table-cell">Stripe objects</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{when(e.receivedAt)}</TableCell>
                        <TableCell className="px-3 py-2">
                          <p className="font-mono text-xs">{e.type}</p>
                          <p className="text-[11px] text-muted-foreground">{e.livemode ? "live" : "test"}{e.attempts > 1 ? ` · ran ${e.attempts}×` : ""}{e.duplicates ? ` · ${e.duplicates} re-sent` : ""}</p>
                        </TableCell>
                        <TableCell className="px-3 py-2"><Badge variant={OUTCOME[e.outcome] ?? "secondary"}>{e.outcome}</Badge></TableCell>
                        <TableCell className="hidden px-3 py-2 font-mono text-[11px] text-muted-foreground md:table-cell">{Object.values(e.refs).join(" · ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
