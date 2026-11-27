"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CheckCircle2, Download, Loader2, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { newIdempotencyKey, toCents, usd } from "@/lib/capital";
import { TRANSFER_LABEL, isWalletAddress, shortAddress, useBankingOverview, type CryptoAddress, type TransferKind } from "@/lib/banking";
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
  { kind: "crypto_receive", icon: Download, short: "Receive USDC" },
  { kind: "internal_send", icon: Users, short: "Pay member" },
];
const USDC_FORM: TransferKind[] = ["to_usd", "crypto_send", "crypto_receive"];
const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

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
      description="Add money from your bank, withdraw, convert between USD and USDC, move USDC to and from your own wallets, or pay another Autopilot member.">
      {!overview.loaded ? <Loading /> : !overview.data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load your balances. Refresh to try again.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7" role="tablist" aria-label="Transfer type">
              {KINDS.map(({ kind: k, icon: Icon, short }) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium transition-colors",
                    kind === k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                  <Icon className="size-4" /> <span className="text-center leading-tight">{short}</span>
                </button>
              ))}
            </div>
            <TransferForm key={kind} kind={kind} base={base} balances={overview.data.balances}
              accounts={overview.data.accounts.filter((a) => a.status === "verified")}
              pendingAccounts={overview.data.accounts.some((a) => a.status === "pending")}
              wallets={overview.data.cryptoAddresses ?? []}
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
  kind, base, balances, accounts, pendingAccounts, wallets, limits, onDone,
}: {
  kind: TransferKind; base: string; balances: Balances;
  accounts: { id: string; nickname: string; last4: string }[]; pendingAccounts: boolean; wallets: CryptoAddress[];
  limits: { minTransferCents: number; maxTransferCents: number; network: string }; onDone: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState("");
  const [bank, setBank] = React.useState(accounts[0]?.id ?? "");
  const [address, setAddress] = React.useState("");
  // A linked wallet, or "" to type another address (sends only; receipts always name a linked wallet).
  const [walletId, setWalletId] = React.useState(wallets[0]?.id ?? "");
  const [recipient, setRecipient] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const key = React.useMemo(() => newIdempotencyKey(), [amount, kind, bank, address, walletId, recipient, note]); // eslint-disable-line react-hooks/exhaustive-deps
  const cents = toCents(amount) ?? 0;
  const needsBank = kind === "deposit" || kind === "withdraw";
  const source = kind === "deposit" || kind === "crypto_receive" ? null
    : kind === "withdraw" || kind === "to_usdc" || kind === "internal_send" ? balances.usdCents : balances.usdcCents;
  const addressOk = isWalletAddress(address);
  const typedAddress = kind === "crypto_send" && !walletId;
  const recipientOk = isEmail(recipient);
  const problems = [
    cents && cents < limits.minTransferCents ? `The minimum is ${usd(limits.minTransferCents)}.` : "",
    cents > limits.maxTransferCents ? `The maximum is ${usd(limits.maxTransferCents)} per transfer.` : "",
    source != null && cents > source ? `You have ${usd(source)} available.` : "",
    typedAddress && address && !addressOk ? "Enter a 0x… address (42 characters)." : "",
    kind === "internal_send" && recipient && !recipientOk ? "Enter the member's email address." : "",
  ].filter(Boolean);
  const ready = kind === "crypto_send" ? (walletId ? true : addressOk)
    : kind === "crypto_receive" ? Boolean(walletId)
    : kind === "internal_send" ? recipientOk
    : needsBank ? Boolean(bank) : true;

  if (kind === "crypto_receive" && wallets.length === 0) {
    return (
      <section className="panel p-6 text-center">
        <p className="font-semibold">Link one of your wallets first</p>
        <p className="mt-1 text-sm text-muted-foreground">USDC can only come in from a wallet you&apos;ve linked as your own.</p>
        <Button className="mt-4" variant="gradient" asChild><Link href={`${base}/crypto`}>Link a wallet</Link></Button>
      </section>
    );
  }

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
      address: typedAddress ? address.trim() : null,
      cryptoAddressId: (kind === "crypto_send" || kind === "crypto_receive") && walletId ? walletId : null,
      recipientEmail: kind === "internal_send" ? recipient.trim() : null,
      note: kind === "internal_send" && note.trim() ? note.trim() : null,
    });
    setBusy(false);
    if (!res || res.status >= 400) {
      toast({ title: "Transfer not made", description: errorText(res?.data) });
      return;
    }
    setDone(`${TRANSFER_LABEL[kind]}: ${usd(cents)}${kind === "internal_send" ? ` to ${recipient.trim()}` : ""} (simulated)`);
    setAmount("");
    setNote("");
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
      {(kind === "crypto_send" || kind === "crypto_receive") && wallets.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="xf-wallet">{kind === "crypto_send" ? "To" : "From"} ({limits.network})</Label>
          <Select id="xf-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            {wallets.map((w) => <option key={w.id} value={w.id}>{w.label} · {shortAddress(w.address)}</option>)}
            {kind === "crypto_send" && <option value="">Another address…</option>}
          </Select>
          <p className="text-xs text-muted-foreground">
            <Link href={`${base}/crypto`} className="font-medium text-primary hover:underline">Manage linked wallets</Link>
          </p>
        </div>
      )}
      {typedAddress && (
        <div className="space-y-1.5">
          <Label htmlFor="xf-addr">Your wallet address ({limits.network})</Label>
          <Input id="xf-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">Send only to a wallet you control on Base. Simulated: no on-chain transaction is made.</p>
        </div>
      )}
      {kind === "crypto_receive" && (
        <p className="text-xs text-muted-foreground">Simulated: records USDC arriving from your linked wallet. No address is issued and nothing is read from the chain; never send real funds anywhere for this.</p>
      )}
      {kind === "internal_send" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="xf-to">Member&apos;s email</Label>
            <Input id="xf-to" type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="name@company.com" autoComplete="off" />
            <p className="text-xs text-muted-foreground">Both of you need verified identity. They&apos;ll see your name and email.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="xf-note">Note (optional)</Label>
            <Input id="xf-note" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="Milestone 2 for the dashboard build" />
          </div>
        </>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="xf-amt">Amount ({USDC_FORM.includes(kind) ? "USDC" : "USD"})</Label>
        <div className="flex gap-2">
          <Input id="xf-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="text-lg font-semibold" />
          {source != null && source > 0 && <Button type="button" variant="outline" onClick={() => setAmount((Math.min(source, limits.maxTransferCents) / 100).toFixed(2))}>Max</Button>}
        </div>
      </div>
      {problems.length > 0 && <p role="alert" className="text-xs text-destructive">{problems.join(" ")}</p>}
      {done && <p role="status" className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success"><CheckCircle2 className="size-4" /> {done}</p>}
      <Button type="submit" variant="gradient" className="w-full" disabled={busy || !cents || problems.length > 0 || !ready}>
        {busy && <Loader2 className="animate-spin" />} {TRANSFER_LABEL[kind]}{cents ? ` · ${usd(cents)}` : ""}
      </Button>
      <p className="text-[11px] text-muted-foreground">Simulated settlement: recorded in your ledger instantly; no bank or blockchain is contacted.</p>
    </form>
  );
}
