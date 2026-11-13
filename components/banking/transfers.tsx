"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { newIdempotencyKey, toCents, usd } from "@/lib/capital";
import { TRANSFER_LABEL, useBankingOverview, type TransferKind } from "@/lib/banking";
import { errorText, useApi, type Balances } from "@/lib/marketplace";
import type { Transfer } from "@/lib/banking";
import { cn } from "@/lib/utils";
import { Figure, Frame, Loading } from "@/components/marketplace/common";
import { bankingLinks } from "./links";
import { TransferRow } from "./overview";

const KINDS: { kind: TransferKind; icon: typeof Send; short: string }[] = [
  { kind: "deposit", icon: ArrowDownLeft, short: "Add" },
  { kind: "withdraw", icon: ArrowUpRight, short: "Withdraw" },
  { kind: "to_usdc", icon: ArrowLeftRight, short: "To USDC" },
  { kind: "to_usd", icon: ArrowLeftRight, short: "To USD" },
  { kind: "crypto_send", icon: Send, short: "Send USDC" },
];

export function TransfersView({ base, full }: { base: string; full: boolean }) {
  const overview = useBankingOverview();
  const history = useApi<Transfer[]>("/api/banking/transfers");
  const [kind, setKind] = React.useState<TransferKind>("deposit");
  // ?kind= preselects the transfer type (links from Overview, Marketplace, Get money).
  React.useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("kind");
    if (k && KINDS.some((x) => x.kind === k)) setKind(k as TransferKind);
  }, []);
  const refresh = () => { overview.refresh(); history.refresh(); };
  return (
    <Frame kind="banking" links={bankingLinks(base, { full })} title="Move money"
      description="Add money from your bank, withdraw, convert between USD and USDC, or send USDC to your own wallet.">
      {!overview.loaded ? <Loading /> : !overview.data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load your balances. Refresh to try again.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5" role="tablist" aria-label="Transfer type">
              {KINDS.map(({ kind: k, icon: Icon, short }) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium transition-colors",
                    kind === k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                  <Icon className="size-4" /> {short}
                </button>
              ))}
            </div>
            <TransferForm key={kind} kind={kind} base={base} balances={overview.data.balances}
              accounts={overview.data.accounts.filter((a) => a.status === "verified")}
              pendingAccounts={overview.data.accounts.some((a) => a.status === "pending")}
              limits={overview.data.limits} onDone={refresh} />
          </div>
          <section className="panel min-w-0 p-0">
            <h3 className="border-b px-5 py-4 font-semibold">History</h3>
            {!history.loaded ? <Loading /> : (history.data ?? []).length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">No transfers yet.</p>
            ) : (
              <ul className="divide-y">{(history.data ?? []).slice(0, 50).map((t) => <TransferRow key={t.id} t={t} />)}</ul>
            )}
          </section>
        </div>
      )}
    </Frame>
  );
}

function TransferForm({
  kind, base, balances, accounts, pendingAccounts, limits, onDone,
}: {
  kind: TransferKind; base: string; balances: Balances;
  accounts: { id: string; nickname: string; last4: string }[]; pendingAccounts: boolean;
  limits: { minTransferCents: number; maxTransferCents: number; network: string }; onDone: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState("");
  const [bank, setBank] = React.useState(accounts[0]?.id ?? "");
  const [address, setAddress] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const key = React.useMemo(() => newIdempotencyKey(), [amount, kind, bank, address]); // eslint-disable-line react-hooks/exhaustive-deps
  const cents = toCents(amount) ?? 0;
  const needsBank = kind === "deposit" || kind === "withdraw";
  const source = kind === "deposit" ? null : kind === "withdraw" || kind === "to_usdc" ? balances.usdCents : balances.usdcCents;
  const addressOk = /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  const problems = [
    cents && cents < limits.minTransferCents ? `The minimum is ${usd(limits.minTransferCents)}.` : "",
    cents > limits.maxTransferCents ? `The maximum is ${usd(limits.maxTransferCents)} per transfer.` : "",
    source != null && cents > source ? `You have ${usd(source)} available.` : "",
    kind === "crypto_send" && address && !addressOk ? "Enter a 0x… address (42 characters)." : "",
  ].filter(Boolean);

  if (needsBank && accounts.length === 0) {
    return (
      <section className="panel p-6 text-center">
        <p className="font-semibold">Link a verified bank account first</p>
        <p className="mt-1 text-sm text-muted-foreground">{pendingAccounts ? "Finish verifying your account with the two deposit amounts." : "It takes a minute."}</p>
        <Button className="mt-4" variant="gradient" asChild><Link href={`${base}/accounts`}>{pendingAccounts ? "Verify account" : "Link a bank account"}</Link></Button>
      </section>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiCall("/api/banking/transfers", {
      kind, amountCents: cents, idempotencyKey: key, bankAccountId: needsBank ? bank : null,
      address: kind === "crypto_send" ? address.trim() : null,
    });
    setBusy(false);
    if (!res || res.status >= 400) {
      toast({ title: "Transfer not made", description: errorText(res?.data) });
      return;
    }
    setDone(`${TRANSFER_LABEL[kind]}: ${usd(cents)} (simulated)`);
    setAmount("");
    onDone();
  };

  return (
    <form onSubmit={submit} className="panel space-y-4 p-5">
      <p className="font-semibold">{TRANSFER_LABEL[kind]}</p>
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-3">
        <Figure label="USD balance" value={usd(balances.usdCents)} />
        <Figure label="USDC balance" value={usd(balances.usdcCents)} />
      </div>
      {needsBank && (
        <div className="space-y-1.5">
          <Label htmlFor="xf-bank">{kind === "deposit" ? "From" : "To"}</Label>
          <Select id="xf-bank" value={bank} onChange={(e) => setBank(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname} ••{a.last4}</option>)}
          </Select>
        </div>
      )}
      {kind === "crypto_send" && (
        <div className="space-y-1.5">
          <Label htmlFor="xf-addr">Your wallet address ({limits.network})</Label>
          <Input id="xf-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">Send only to a wallet you control on Base. Simulated: no on-chain transaction is made.</p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="xf-amt">Amount ({kind === "to_usd" || kind === "crypto_send" ? "USDC" : "USD"})</Label>
        <div className="flex gap-2">
          <Input id="xf-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="text-lg font-semibold" />
          {source != null && source > 0 && <Button type="button" variant="outline" onClick={() => setAmount((Math.min(source, limits.maxTransferCents) / 100).toFixed(2))}>Max</Button>}
        </div>
      </div>
      {problems.length > 0 && <p role="alert" className="text-xs text-destructive">{problems.join(" ")}</p>}
      {done && <p role="status" className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success"><CheckCircle2 className="size-4" /> {done}</p>}
      <Button type="submit" variant="gradient" className="w-full" disabled={busy || !cents || problems.length > 0 || (kind === "crypto_send" && !addressOk) || (needsBank && !bank)}>
        {busy && <Loader2 className="animate-spin" />} {TRANSFER_LABEL[kind]}{cents ? ` · ${usd(cents)}` : ""}
      </Button>
      <p className="text-[11px] text-muted-foreground">Simulated settlement: recorded in your ledger instantly; no bank or blockchain is contacted.</p>
    </form>
  );
}
