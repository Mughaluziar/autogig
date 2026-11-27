"use client";
import * as React from "react";
import { ArrowDownToLine, ArrowUpFromLine, Landmark, Loader2, PiggyBank, ShieldCheck, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/shared/stat-card";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { useBankingOverview } from "@/lib/banking";
import { newIdempotencyKey, pct, toCents, usd, type InvestorPosition, type PoolSummary } from "@/lib/capital";

type Detail = { detail?: string; reasons?: string[] };

export function PoolStats({ pool }: { pool: PoolSummary }) {
  const p = pool.policy;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pool value" value={usd(pool.navCents)} icon={<Landmark className="size-4" />}
          hint={`${usd(pool.sharePriceCents)} per share`} />
        <StatCard label="Out in early payments" value={usd(pool.outstandingCents)} icon={<ArrowUpFromLine className="size-4" />}
          hint={`${usd(pool.availableForAdvancesCents)} available to lend`} />
        <StatCard label="Realised yield" value={usd(pool.realisedYieldCents)} icon={<TrendingUp className="size-4" />}
          hint={`${usd(pool.writtenOffCents)} written off · ${(pool.defaultRate * 100).toFixed(1)}% default rate`} />
        <StatCard label="Protection fund" value={usd(pool.protectionFundCents)} icon={<ShieldCheck className="size-4" />}
          hint={`${usd(pool.protectionPaidCents)} paid in claims`} />
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Each early payment is up to {pct(p.advanceRateBps)} of a verified fixed-price order, with a flat {pct(p.feeBps)} fee over
        {" "}{p.termDays} days ({p.graceDays}-day grace). Fees split {pct(p.investorShareBps)} to investors, {pct(p.protectionShareBps)} to
        the protection fund and {pct(p.platformShareBps)} to the platform. {pct(p.liquidityReserveBps)} of the pool stays in cash for withdrawals.
      </p>
    </>
  );
}

export function InvestPanel({
  pool, position, onChanged,
}: {
  pool: PoolSummary;
  position: InvestorPosition | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const banking = useBankingOverview();
  const [deposit, setDeposit] = React.useState("");
  const [withdraw, setWithdraw] = React.useState("");
  // Where the money comes from / goes to: the Autopilot USD balance, or outside (the original simulated deposit).
  const [route, setRoute] = React.useState<"wallet" | "external">("external");
  const [busy, setBusy] = React.useState<"deposit" | "withdraw" | "all" | null>(null);
  // One key per typed amount: a double-click or retry can't post twice.
  const depositKey = React.useMemo(() => newIdempotencyKey(), [deposit, route]); // eslint-disable-line react-hooks/exhaustive-deps
  const withdrawKey = React.useMemo(() => newIdempotencyKey(), [withdraw, route]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocked = position?.reasons ?? [];
  const walletCents = banking.data?.balances.usdCents ?? null;
  const viaWallet = route === "wallet";

  const act = async (kind: "deposit" | "withdraw" | "all") => {
    const amount = toCents(kind === "deposit" ? deposit : withdraw);
    if (kind !== "all" && amount == null) {
      toast({ title: "Enter an amount in dollars" });
      return;
    }
    setBusy(kind);
    const res = kind === "deposit"
      ? await apiCall<Detail>("/api/capital/investor/deposit", { amountCents: amount, idempotencyKey: depositKey, source: route })
      : await apiCall<Detail>("/api/capital/investor/withdraw", kind === "all"
        ? { all: true, idempotencyKey: newIdempotencyKey(), destination: route }
        : { amountCents: amount, idempotencyKey: withdrawKey, destination: route });
    setBusy(null);
    if (!res || res.status >= 400) {
      toast({ title: kind === "deposit" ? "Deposit not recorded" : "Withdrawal not recorded",
        description: [res?.data?.detail, ...(res?.data?.reasons ?? [])].filter(Boolean).join(" ") || "Can't reach the server." });
      return;
    }
    toast({ title: kind === "deposit" ? "Deposit recorded (simulated)" : "Withdrawal recorded (simulated)", variant: "success" });
    setDeposit("");
    setWithdraw("");
    onChanged();
    banking.refresh();
  };

  return (
    <div className="space-y-4">
      <PoolStats pool={pool} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><PiggyBank className="size-4" /> Your position</CardTitle>
            <CardDescription>Pool shares priced at the pool&apos;s value. Yield and write-offs are shared pro rata.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Value</dt><dd className="text-xl font-semibold">{usd(position?.valueCents ?? 0)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Gain / loss</dt>
                <dd className={`text-xl font-semibold ${(position?.gainCents ?? 0) < 0 ? "text-destructive" : ""}`}>{usd(position?.gainCents ?? 0)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Deposited</dt><dd>{usd(position?.depositedCents ?? 0)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Withdrawn</dt><dd>{usd(position?.withdrawnCents ?? 0)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-muted-foreground">Shares</dt>
                <dd className="tabular-nums">{(position?.shares ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 })}</dd></div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Deposit or withdraw</CardTitle>
            <CardDescription>Simulated: recorded in the ledger, no funds move.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {blocked.length > 0 && (
              <ul className="list-disc space-y-1 rounded-md bg-muted p-3 pl-7 text-sm text-muted-foreground">
                {blocked.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="route">Money comes from and goes back to</Label>
              <Select id="route" value={route} onChange={(e) => setRoute(e.target.value as "wallet" | "external")}>
                <option value="external">Outside Autopilot (simulated deposit)</option>
                <option value="wallet">Autopilot USD balance{walletCents != null ? ` · ${usd(walletCents)} available` : ""}</option>
              </Select>
              {viaWallet && walletCents === 0 && (
                <p className="text-xs text-muted-foreground">Your Autopilot balance is empty: add money in Banking first.</p>
              )}
            </div>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void act("deposit"); }}>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="dep">Deposit (USD)</Label>
                <Input id="dep" inputMode="decimal" placeholder="1,000" value={deposit} onChange={(e) => setDeposit(e.target.value)}
                  disabled={blocked.length > 0} />
              </div>
              <Button type="submit" disabled={busy !== null || blocked.length > 0 || !deposit}>
                {busy === "deposit" ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />} Deposit
              </Button>
            </form>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void act("withdraw"); }}>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="wd">Withdraw (USD)</Label>
                <Input id="wd" inputMode="decimal" placeholder="500" value={withdraw} onChange={(e) => setWithdraw(e.target.value)} />
              </div>
              <Button type="submit" variant="outline" disabled={busy !== null || !withdraw}>
                {busy === "withdraw" && <Loader2 className="animate-spin" />} Withdraw
              </Button>
              <Button type="button" variant="ghost" disabled={busy !== null || !(position?.valueCents)} onClick={() => void act("all")}>
                {busy === "all" && <Loader2 className="animate-spin" />} All
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
