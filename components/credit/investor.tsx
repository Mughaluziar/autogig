"use client";
import * as React from "react";
import { Link2, Loader2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { newIdempotencyKey, pct, toCents, usd } from "@/lib/capital";
import { AGREEMENT_LABELS, WITHDRAWAL_LABELS, useCredit, type CreditOverview, type Statement } from "@/lib/credit";
import { CHAIN_NAMES, connect, useWallets } from "@/lib/wallets";
import { Gate, SimNotice, Stat, dateOnly } from "@/components/credit/common";

export function CreditInvestor() {
  const { overview, statement, allocations, loaded, denied, failed, refresh } = useCredit({ investor: true });
  return (
    <Gate loaded={loaded} denied={denied} failed={failed} retry={refresh}>
      {overview && (
        <div className="space-y-6">
          <SimNotice>Contributions here are demo records. Statements show how the pool&apos;s simulated results would be shared, not what anyone will earn.</SimNotice>
          <PoolOverview overview={overview} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ContributeCard overview={overview} onDone={refresh} />
            <StatementCard statement={statement} />
          </div>
          {statement && statement.contributedCents > 0 && <WithdrawCard statement={statement} onDone={refresh} />}
          <Allocations rows={allocations} />
          <History statement={statement} />
          <div className="grid gap-4 lg:grid-cols-2">
            <RiskCard overview={overview} />
            <WalletInfoCard />
          </div>
        </div>
      )}
    </Gate>
  );
}

function PoolOverview({ overview }: { overview: CreditOverview }) {
  const p = overview.pool;
  return (
    <section aria-label="Funding pool overview" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Stat label="Simulated contributions" value={usd(p.contributionsCents)} />
      <Stat label="Available to allocate" value={usd(p.availableCents)} hint={`${usd(p.committedCents)} reserved for open offers`} />
      <Stat label="Out as project credit" value={usd(p.outstandingCents)} />
      <Stat label="Fees recorded" value={usd(p.feesCents)} hint="Simulated" />
      <Stat label="Defaults written off" value={usd(p.lossesCents)} tone={p.lossesCents > 0 ? "bad" : undefined} hint="Losses are part of lending" />
      <Stat label="Cash in the demo pool" value={usd(p.cashCents)} />
    </section>
  );
}

function ContributeCard({ overview, onDone }: { overview: CreditOverview; onDone: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState("");
  const [risk, setRisk] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [key, setKey] = React.useState(newIdempotencyKey);
  const { minContributionCents: min, maxContributionCents: max } = overview.limits;
  const cents = toCents(amount);
  const ok = cents != null && cents >= min && cents <= max;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiCall<{ detail?: string }>("/api/credit/contributions", { amountCents: cents, idempotencyKey: key, acceptRisk: risk });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Contribution not recorded", description: res?.data?.detail ?? "Can't reach the server." });
    toast({ title: "Demo contribution recorded", description: "No real money moved.", variant: "success" });
    setAmount(""); setRisk(false); setKey(newIdempotencyKey());
    onDone();
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Add a demo contribution</CardTitle>
        <CardDescription>Between {usd(min)} and {usd(max)}. Simulated funds only. You can ask for contributions back below; the platform pays requests when the pool has uncommitted cash.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} className="space-y-3" aria-label="Demo contribution">
          <div className="space-y-1.5">
            <Label htmlFor="contrib-amount">Amount (USD)</Label>
            <Input id="contrib-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250.00" aria-invalid={amount !== "" && !ok} />
            {amount !== "" && !ok && <p role="alert" className="text-xs text-destructive">Enter an amount between {usd(min)} and {usd(max)}.</p>}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={risk} onCheckedChange={setRisk} className="mt-0.5" />
            I understand this is a simulation, nothing is guaranteed, and simulated results can be negative.
          </label>
          <Button type="submit" disabled={busy || !ok || !risk}>{busy && <Loader2 className="animate-spin" />} Record contribution</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function StatementCard({ statement }: { statement: Statement | null }) {
  const net = statement?.simulatedNetCents ?? 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Simulated statement</CardTitle>
        <CardDescription>{statement?.notice}</CardDescription>
      </CardHeader>
      <CardContent>
        {!statement || statement.contributedCents === 0 ? <p className="text-sm text-muted-foreground">Record a demo contribution to see a statement.</p> : (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">You contributed</dt><dd className="text-right tabular-nums">{usd(statement.contributedCents)}</dd>
            {statement.withdrawnCents > 0 && (<>
              <dt className="text-muted-foreground">Withdrawn</dt><dd className="text-right tabular-nums">−{usd(statement.withdrawnCents)}</dd>
            </>)}
            <dt className="text-muted-foreground">Share of the demo pool</dt><dd className="text-right tabular-nums">{pct(statement.shareBps)}</dd>
            <dt className="text-muted-foreground">Attributed fees</dt><dd className="text-right tabular-nums">{usd(statement.attributedFeesCents)}</dd>
            <dt className="text-muted-foreground">Attributed losses</dt><dd className="text-right tabular-nums">{usd(statement.attributedLossesCents)}</dd>
            <dt className="font-medium">Simulated net result</dt>
            <dd className={`text-right font-semibold tabular-nums ${net < 0 ? "text-destructive" : ""}`}>{usd(net)}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Allocations({ rows }: { rows: ReturnType<typeof useCredit>["allocations"] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Where the demo pool was allocated</CardTitle>
        <CardDescription>Every credit funded from the pool, without names. Status updates as simulated repayments arrive.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing has been allocated yet.</p> : (
          <table className="w-full min-w-[480px] text-left text-sm">
            <caption className="sr-only">Funding allocations</caption>
            <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="py-1">Reference</th><th scope="col">Funded</th><th scope="col">Grade</th><th scope="col" className="text-right">Amount</th><th scope="col" className="text-right">Principal repaid</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.reference} className="border-t">
                  <td className="py-1.5 font-mono text-xs">{r.reference}</td><td>{dateOnly(r.fundedAt)}</td><td>{r.grade}</td>
                  <td className="text-right tabular-nums">{usd(r.principalCents)}</td><td className="text-right tabular-nums">{usd(r.repaidCents)}</td>
                  <td><Badge variant={AGREEMENT_LABELS[r.status].variant}>{AGREEMENT_LABELS[r.status].label}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function WithdrawCard({ statement, onDone }: { statement: Statement; onDone: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [key, setKey] = React.useState(newIdempotencyKey);
  const cents = toCents(amount);
  const ok = cents != null && cents >= 1_000 && cents <= statement.withdrawableCents;
  const waiting = statement.withdrawals.filter((w) => w.status === "requested" || w.status === "paying");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("ask");
    const res = await apiCall<{ detail?: string }>("/api/credit/withdrawals", { amountCents: cents, idempotencyKey: key, note });
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Request not sent", description: res?.data?.detail ?? "Can't reach the server." });
    toast({ title: "Withdrawal requested", description: "The platform reviews it and pays it when the pool has uncommitted cash. Simulated.", variant: "success" });
    setAmount(""); setNote(""); setKey(newIdempotencyKey());
    onDone();
  };
  const cancel = async (id: string) => {
    setBusy(id);
    const res = await apiCall<{ detail?: string }>(`/api/credit/withdrawals/${encodeURIComponent(id)}/cancel`);
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Request not cancelled", description: res?.data?.detail ?? "Can't reach the server." });
    onDone();
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Ask for contributions back</CardTitle>
        <CardDescription>
          Up to {usd(statement.withdrawableCents)}: your net contributions, less your share of any written-off credit and requests already
          waiting. Attributed fees are an illustration and are not paid out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {waiting.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {waiting.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="tabular-nums">{usd(w.amountCents)} · {dateOnly(w.createdAt)}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={WITHDRAWAL_LABELS[w.status].variant}>{WITHDRAWAL_LABELS[w.status].label}</Badge>
                  {w.status === "requested" && (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void cancel(w.id)}>
                      {busy === w.id && <Loader2 className="animate-spin" />} Cancel
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="wd-amt">Amount (USD)</Label>
            <Input id="wd-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" disabled={statement.withdrawableCents < 1_000} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wd-note">Note (optional)</Label>
            <Input id="wd-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Why you need it back" />
          </div>
          <Button type="submit" variant="outline" disabled={busy !== null || !ok}>{busy === "ask" && <Loader2 className="animate-spin" />} Request</Button>
        </form>
        {cents != null && cents > statement.withdrawableCents && <p role="alert" className="text-xs text-destructive">That&apos;s more than you can ask for now ({usd(statement.withdrawableCents)}).</p>}
      </CardContent>
    </Card>
  );
}

function History({ statement }: { statement: Statement | null }) {
  const rows = [
    ...(statement?.contributions ?? []).map((c) => ({ id: c.id, at: c.createdAt, label: "Demo contribution", cents: c.amountCents, status: null as string | null })),
    ...(statement?.withdrawals ?? []).map((w) => ({ id: w.id, at: w.paidAt ?? w.createdAt, label: "Withdrawal", cents: -w.amountCents, status: w.status as string })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Transaction history</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No transactions yet.</p> : (
          <ul className="divide-y text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 py-2">
                <span>{r.label} · {dateOnly(r.at)}{r.status && r.status !== "paid" ? ` · ${WITHDRAWAL_LABELS[r.status as keyof typeof WITHDRAWAL_LABELS]?.label ?? r.status}` : ""}</span>
                <span className={`tabular-nums ${r.status === "declined" || r.status === "cancelled" ? "text-muted-foreground line-through" : r.status && r.status !== "paid" ? "text-muted-foreground" : ""}`}>{r.cents < 0 ? "−" : ""}{usd(Math.abs(r.cents))}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RiskCard({ overview }: { overview: CreditOverview }) {
  const l = overview.limits;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Risk disclosures</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>This is a demonstration. Real versions of anything shown here would be regulated lending or investment activity and would need legal approval first.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Borrowers can pay late or default; unpaid principal is written off after {l.defaultAfterDays} days, and simulated results can be negative.</li>
          <li>Fees shown are flat amounts per credit, not annual rates, and are not a promise of any return.</li>
          <li>The pool is small and concentrated: one default can change the result a lot.</li>
          <li>There is no deposit insurance and no guarantee. The platform&apos;s protection fund is a separate simulation, not insurance.</li>
          <li>The AutoGig token is not issued. Nothing here is an offer to sell it.</li>
        </ul>
      </CardContent>
    </Card>
  );
}

/** Read-only wallet connection: shows the address and network. Nothing is signed, sent, stored or sent to the server. */
function WalletInfoCard() {
  const { wallets, searched } = useWallets();
  const { toast } = useToast();
  const [chosen, setChosen] = React.useState("");
  const [account, setAccount] = React.useState<{ address: string; chainId: number | null } | null>(null);
  const wallet = wallets.find((w) => w.id === (chosen || wallets[0]?.id)) ?? null;
  const go = async () => {
    if (!wallet) return;
    try { setAccount(await connect(wallet)); } catch (err) {
      toast({ title: "Wallet not connected", description: err instanceof Error ? err.message : "The wallet refused the request." });
    }
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Wallet className="size-4" /> Wallet (read-only)</CardTitle>
        <CardDescription>Connect a browser wallet to see its address. The page never asks for a transaction, a recovery phrase or a private key, and stores nothing.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {account ? (
          <p data-testid="wallet-address">
            <span className="font-mono">{account.address.slice(0, 6)}…{account.address.slice(-4)}</span>{" "}
            <Badge variant="secondary">{account.chainId != null ? (CHAIN_NAMES[account.chainId] ?? `Chain ${account.chainId}`) : "Unknown network"}</Badge>
          </p>
        ) : wallets.length === 0 ? (
          <p className="text-muted-foreground">{searched ? "No browser wallet found. Install an Ethereum-compatible wallet extension (for example MetaMask, Coinbase Wallet or Rabby) and reload. Mobile wallets via QR code are not enabled yet." : "Looking for wallets…"}</p>
        ) : (
          <div className="space-y-2">
            {wallets.length > 1 && (
              <>
                <Label htmlFor="wallet-pick">Wallet</Label>
                <Select id="wallet-pick" value={wallet?.id ?? ""} onChange={(e) => setChosen(e.target.value)}>{wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
              </>
            )}
            <Button size="sm" onClick={() => void go()}><Link2 /> Connect {wallet?.name ?? "wallet"}</Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">AutoGig token: <strong>not issued</strong>. A token would need legal approval, an independent security audit and the owner&apos;s sign-off first.</p>
      </CardContent>
    </Card>
  );
}
