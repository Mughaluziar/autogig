"use client";
import * as React from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { pct, timeLeft, toCents, usd, type Claim, type Coverage, type EligibleRow, type PoolSummary } from "@/lib/capital";
import { formatDate } from "@/lib/utils";

type Detail = { detail?: string; reasons?: string[] };
const describe = (d?: Detail) => [d?.detail, ...(d?.reasons ?? [])].filter(Boolean).join(" ");

const CLAIM_VARIANT: Record<Claim["status"], "success" | "warning" | "destructive" | "secondary" | "default"> = {
  eligible: "warning", waiting: "warning", paying: "warning", paid: "success", ineligible: "secondary", denied: "destructive",
};

export function ProtectionPanel({
  orders, coverages, claims, verified, policy, onChanged,
}: {
  policy: PoolSummary["policy"];
  orders: EligibleRow[];
  coverages: Coverage[];
  claims: Claim[];
  verified: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [buying, setBuying] = React.useState<EligibleRow | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  // Cover is sold only in the first hours after an order arrives.
  const coverable = orders.filter((r) => !r.covered && r.order.pricing === "fixed" && r.order.currency === "USD"
    && ["active", "delivered"].includes(r.order.status) && r.coverClosesAt != null && Date.parse(r.coverClosesAt) > Date.now());
  const liveClaim = new Set(claims.filter((c) => ["eligible", "waiting", "paying"].includes(c.status)).map((c) => c.coverageId));

  const fileClaim = async (cover: Coverage) => {
    setBusy(cover.id);
    const res = await apiCall<Claim & Detail>(`/api/capital/coverages/${encodeURIComponent(cover.id)}/claim`, {});
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Claim not opened", description: describe(res?.data) || "Can't reach the server." });
    toast({ title: res.data.status === "ineligible" ? "Not eligible yet" : "Claim opened", description: res.data.reason });
    onChanged();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" /> Order protection</CardTitle>
          <CardDescription>
            Protects against a loss <em>the marketplace itself reports</em>: a client cancellation or refund after protection starts.
            Every early payment is protected automatically; other orders can be protected in their first 24 hours. Backed by the
            platform&apos;s protection fund, not a licensed insurer: claims are reviewed by an operator and paid up to the fund&apos;s balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {coverages.length === 0 && <p className="text-sm text-muted-foreground">No protection yet.</p>}
          <ul className="divide-y">
            {coverages.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{c.orderTitle ?? c.orderId}</span>
                    <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.kind === "advance" ? "Protects your early payment" : `${usd(c.coveredCents)} protected · ${usd(c.premiumCents)} premium`}
                    {" "}· since {formatDate(c.startsAt)}{c.endsAt && ` · until ${formatDate(c.endsAt)}`}
                  </p>
                </div>
                {c.status === "active" && !liveClaim.has(c.id) && (
                  <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => void fileClaim(c)}>
                    {busy === c.id && <Loader2 className="animate-spin" />} File a claim
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {coverable.length > 0 && verified && (
            <div className="border-t pt-3">
              <p className="mb-2 text-sm font-medium">Protect a new order</p>
              <div className="flex flex-wrap gap-2">
                {coverable.map((r) => (
                  <Button key={r.order.id} size="sm" variant="outline" onClick={() => setBuying(r)}>
                    {r.order.title ?? r.order.externalOrderId}
                    <span className="text-xs text-muted-foreground">· {timeLeft(r.coverClosesAt!)} left</span>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Claims</CardTitle></CardHeader>
        <CardContent>
          {claims.length === 0 ? <p className="text-sm text-muted-foreground">No claims.</p> : (
            <ul className="divide-y">
              {claims.map((c) => (
                <li key={c.id} className="py-3">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{c.orderTitle ?? c.orderId}</span>
                    <Badge variant={CLAIM_VARIANT[c.status]}>{c.status}</Badge>
                    {c.openedBy === "system" && <Badge variant="secondary">opened automatically</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.reason}{c.amountCents > 0 && ` · ${usd(c.amountCents)} claimed`}{c.paidCents > 0 && ` · ${usd(c.paidCents)} paid`}
                    {(c.shortfallCents ?? 0) > 0 && ` · ${usd(c.shortfallCents!)} unpaid (fund balance too low)`}
                    {c.reviewNote && ` · ${c.reviewNote}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {buying && <BuyCoverDialog row={buying} policy={policy} onClose={() => setBuying(null)} onDone={() => { setBuying(null); onChanged(); }} />}
    </div>
  );
}

function BuyCoverDialog({ row, policy, onClose, onDone }: {
  row: EligibleRow; policy: PoolSummary["policy"]; onClose: () => void; onDone: () => void;
}) {
  const max = Math.min(Math.floor((row.underwriting.orderCents * policy.protectionMaxCoverBps) / 10_000), policy.protectionMaxCoverCents);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Protect this order</DialogTitle>
        <DialogDescription>
          {row.order.title} · {row.order.platform} · {usd(row.underwriting.orderCents)}
          {row.coverClosesAt && ` · offer closes in ${timeLeft(row.coverClosesAt)}`}
        </DialogDescription>
      </DialogHeader>
      <CoverForm orderId={row.order.id} platform={row.order.platform} maxCents={max} premiumBps={policy.protectionPremiumBps}
        termDays={policy.protectionTermDays} onDone={onDone} secondary={<Button variant="ghost" onClick={onClose}>Cancel</Button>} />
    </Dialog>
  );
}

/** Protected amount, premium and terms, then buy. Shared by the capital page and the new-order prompt. */
export function CoverForm({ orderId, platform, maxCents, premiumBps, termDays, secondary, onDone }: {
  orderId: string; platform: string; maxCents: number; premiumBps: number; termDays: number;
  secondary: React.ReactNode; onDone: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState((maxCents / 100).toFixed(2));
  const [agree, setAgree] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const cents = toCents(amount);
  const premium = cents ? Math.max(1, Math.floor((cents * premiumBps) / 10_000)) : 0;
  const inputId = `cover-amount-${orderId}`;
  const buy = async () => {
    setBusy(true);
    const res = await apiCall<Coverage & Detail>("/api/capital/coverages", { orderId, coveredCents: cents, acceptTerms: agree });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Protection not added", description: describe(res?.data) || "Can't reach the server." });
    toast({ title: "Order protected (simulated)", variant: "success" });
    onDone();
  };
  return (
    <>
      <div className="space-y-3 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>Protected amount (up to {usd(maxCents)})</Label>
          <Input id={inputId} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Premium: {pct(premiumBps)} of the protected amount, {usd(premium)}. Protection lasts {termDays} days.
          </p>
        </div>
        <label className="flex items-start gap-2">
          <Checkbox checked={agree} onCheckedChange={setAgree} className="mt-0.5" />
          I understand this protection is backed by the platform&apos;s discretionary protection fund, not a licensed insurer.
          Only a cancellation or refund reported by {platform} after today qualifies, and payouts are limited to the
          fund&apos;s balance.
        </label>
      </div>
      <DialogFooter className="flex-wrap">
        {secondary}
        <Button disabled={busy || !agree || cents == null || cents > maxCents} onClick={() => void buy()}>
          {busy && <Loader2 className="animate-spin" />} Pay {usd(premium)} and protect
        </Button>
      </DialogFooter>
    </>
  );
}
