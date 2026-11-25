"use client";
import * as React from "react";
import Link from "next/link";
import { Banknote, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/empty-state";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { ADVANCE_LABELS, pct, toCents, usd, type Advance, type EligibleRow } from "@/lib/capital";
import { formatDate } from "@/lib/utils";

type Detail = { detail?: string; reasons?: string[] };
const describe = (d?: Detail) => [d?.detail, ...(d?.reasons ?? [])].filter(Boolean).join(" ");

export function EarlyPayPanel({
  orders, advances, verified, onChanged,
}: {
  orders: EligibleRow[];
  advances: Advance[];
  verified: boolean;
  onChanged: () => void;
}) {
  const [quoting, setQuoting] = React.useState<EligibleRow | null>(null);
  const [repaying, setRepaying] = React.useState<Advance | null>(null);
  const live = advances.filter((a) => a.status !== "quoted" && a.status !== "cancelled");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Your verified orders</CardTitle>
          <CardDescription>
            Only fixed-price USD orders that the platform&apos;s API verified, and confirmed in the last day, qualify.
            Fiverr and other email-only orders can&apos;t be verified, so they never qualify.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <EmptyState icon={<Banknote className="size-6" />} title="No verified orders yet"
              description="Connect an Upwork or Freelancer.com account through the API on the Orders page. Verified orders show up here."
              action={<Button variant="outline" size="sm" asChild><Link href="/dashboard/orders">Go to Orders</Link></Button>} />
          ) : (
            <ul className="divide-y">
              {orders.map((row) => (
                <li key={row.order.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.order.title ?? row.order.externalOrderId}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.order.platform} · {row.order.accountLabel} · {usd(row.underwriting.orderCents)}
                      {row.covered && " · protected"}
                    </p>
                    {!row.underwriting.eligible && (
                      <p className="mt-1 text-xs text-muted-foreground">{row.underwriting.reasons.join(" ")}</p>
                    )}
                  </div>
                  {row.underwriting.eligible && (
                    <Button size="sm" disabled={!verified} onClick={() => setQuoting(row)}>
                      Get up to {usd(row.underwriting.maxPrincipalCents)}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Early payments</CardTitle></CardHeader>
        <CardContent>
          {live.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
            <ul className="divide-y">
              {live.map((a) => {
                const meta = ADVANCE_LABELS[a.status];
                return (
                  <li key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="truncate">{a.orderTitle ?? a.orderExternalId}</span>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {usd(a.principalCents)} received · {usd(a.feeCents)} fee
                        {a.dueAt && ` · due ${formatDate(a.dueAt)}`}
                        {a.totalDueCents > 0 && ` · ${usd(a.totalDueCents)} left to repay`}
                        {a.principalCoveredCents > 0 && ` · ${usd(a.principalCoveredCents)} paid by protection`}
                      </p>
                    </div>
                    {a.totalDueCents > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setRepaying(a)}>Repay</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {quoting && <QuoteDialog row={quoting} onClose={() => setQuoting(null)} onDone={() => { setQuoting(null); onChanged(); }} />}
      {repaying && <RepayDialog advance={repaying} onClose={() => setRepaying(null)} onDone={() => { setRepaying(null); onChanged(); }} />}
    </div>
  );
}

function QuoteDialog({ row, onClose, onDone }: { row: EligibleRow; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const max = row.underwriting.maxPrincipalCents;
  const [amount, setAmount] = React.useState((max / 100).toFixed(2));
  const [quote, setQuote] = React.useState<Advance | null>(null);
  const [agree, setAgree] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const cents = toCents(amount);

  const getQuote = async () => {
    setBusy(true);
    const res = await apiCall<Advance & Detail>("/api/capital/advances/quote", { orderId: row.order.id, principalCents: cents });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "No quote", description: describe(res?.data) || "Can't reach the server." });
    setQuote(res.data);
  };

  const accept = async () => {
    if (!quote) return;
    setBusy(true);
    const res = await apiCall<Advance & Detail>(`/api/capital/advances/${encodeURIComponent(quote.id)}/accept`, { acceptTerms: agree });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Not sent", description: describe(res?.data) || "Can't reach the server." });
    toast({ title: "Early payment recorded (simulated)", description: `Repay ${usd(res.data.totalDueCents)} by ${formatDate(res.data.dueAt!)}.`, variant: "success" });
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Early payment</DialogTitle>
        <DialogDescription>{row.order.title} · {row.order.platform} · order value {usd(row.underwriting.orderCents)}</DialogDescription>
      </DialogHeader>
      {!quote ? (
        <div className="space-y-1.5">
          <Label htmlFor="adv-amount">Amount (up to {usd(max)})</Label>
          <Input id="adv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="text-xs text-muted-foreground">Flat fee: {pct(row.underwriting.feeBps)} of the amount.</p>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-2 rounded-lg border p-3">
            <dt className="text-muted-foreground">You receive</dt><dd className="text-right font-medium">{usd(quote.principalCents)}</dd>
            <dt className="text-muted-foreground">Fee</dt><dd className="text-right">{usd(quote.feeCents)}</dd>
            <dt className="text-muted-foreground">You repay</dt><dd className="text-right font-semibold">{usd(quote.principalCents + quote.feeCents)}</dd>
            <dt className="text-muted-foreground">Due</dt><dd className="text-right">{quote.termDays} days after acceptance (+{quote.graceDays}-day grace)</dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            You repay this yourself once {row.order.platform} pays you. If the platform reports the client cancelled or
            refunded, its protection can repay it for you (backed by the protection fund, not a licensed insurer; reviewed, and limited to the fund&apos;s balance).
            Missing the grace period puts the advance in default and pauses new early payments. The quote expires in 15 minutes.
          </p>
          <label className="flex items-start gap-2">
            <Checkbox checked={agree} onCheckedChange={setAgree} className="mt-0.5" />
            I agree to repay {usd(quote.principalCents + quote.feeCents)} by the due date.
          </label>
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {!quote ? (
          <Button disabled={busy || cents == null || cents > max} onClick={() => void getQuote()}>
            {busy && <Loader2 className="animate-spin" />} See terms
          </Button>
        ) : (
          <Button disabled={busy || !agree} onClick={() => void accept()}>
            {busy && <Loader2 className="animate-spin" />} Accept and receive {usd(quote.principalCents)}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}

function RepayDialog({ advance, onClose, onDone }: { advance: Advance; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState((advance.totalDueCents / 100).toFixed(2));
  const [busy, setBusy] = React.useState(false);
  const cents = toCents(amount);
  const repay = async () => {
    setBusy(true);
    const res = await apiCall<Advance & Detail>(`/api/capital/advances/${encodeURIComponent(advance.id)}/repay`, { amountCents: cents });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Repayment not recorded", description: describe(res?.data) || "Can't reach the server." });
    toast({ title: res.data.status === "repaid" ? "Fully repaid" : "Repayment recorded (simulated)", variant: "success" });
    onDone();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Repay early payment</DialogTitle>
        <DialogDescription>{advance.orderTitle} · {usd(advance.totalDueCents)} left ({usd(advance.principalDueCents)} principal, {usd(advance.feeDueCents)} fee)</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="repay-amount">Amount</Label>
        <Input id="repay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <p className="text-xs text-muted-foreground">Payments go to the principal first, then the fee.</p>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || cents == null || cents > advance.totalDueCents} onClick={() => void repay()}>
          {busy && <Loader2 className="animate-spin" />} Record repayment
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
