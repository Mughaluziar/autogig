"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeftRight, Copy, Download, Loader2, Plus, Send, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { usd } from "@/lib/capital";
import { isWalletAddress, shortAddress, useBankingOverview, type CryptoAddress, type Transfer } from "@/lib/banking";
import { errorText } from "@/lib/marketplace";
import { CHAIN_NAMES, connect, useWallets, type DiscoveredWallet } from "@/lib/wallets";
import { Figure, Frame, Loading } from "@/components/marketplace/common";
import { bankingLinks } from "./links";
import { TransferRow } from "./overview";

const CRYPTO_KINDS: Transfer["kind"][] = ["to_usdc", "to_usd", "crypto_send", "crypto_receive"];

/** USDC balance, the user's own linked wallets on Base, and crypto activity. Wallet connection is read-only:
 *  the browser wallet only shares its public address; nothing here signs or sends a transaction. */
export function CryptoView({ base, full }: { base: string; full: boolean }) {
  const { data, loaded, refresh } = useBankingOverview();
  return (
    <Frame kind="banking" links={bankingLinks(base, { full })} title="Crypto wallet"
      description="Your USDC balance on Base, the wallets you've linked as your own, and every USDC movement.">
      {!loaded ? <Loading /> : !data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load your wallet. Refresh to try again.</p>
      ) : (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-sky-500/20 via-primary/10 to-transparent p-5 sm:p-6">
            <p className="text-sm text-muted-foreground">USDC balance</p>
            <p className="mt-1 text-4xl font-extrabold tabular-nums tracking-tight">{usd(data.balances.usdcCents)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{data.limits.network} · 1 USDC is shown as $1.00</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button asChild><Link href={`${base}/transfers?kind=crypto_receive`}><Download /> Receive</Link></Button>
              <Button variant="outline" asChild><Link href={`${base}/transfers?kind=crypto_send`}><Send /> Send</Link></Button>
              <Button variant="outline" asChild><Link href={`${base}/transfers?kind=to_usdc`}><ArrowLeftRight /> USD → USDC</Link></Button>
              <Button variant="outline" asChild><Link href={`${base}/transfers?kind=to_usd`}><ArrowLeftRight /> USDC → USD</Link></Button>
            </div>
          </section>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <LinkedWallets wallets={data.cryptoAddresses ?? []} onChanged={refresh} />
            <section className="panel min-w-0 p-0">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h3 className="font-semibold">USDC activity</h3>
                <Link href={`${base}/transactions`} className="text-xs font-medium text-primary hover:underline">All transactions</Link>
              </div>
              {data.transfers.filter((t) => CRYPTO_KINDS.includes(t.kind)).length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">No USDC activity yet.</p>
              ) : (
                <ul className="divide-y">{data.transfers.filter((t) => CRYPTO_KINDS.includes(t.kind)).slice(0, 10).map((t) => <TransferRow key={t.id} t={t} />)}</ul>
              )}
            </section>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Simulated settlement: no blockchain is contacted and Autopilot never issues a deposit address. Linking a wallet stores only
            its public address; Autopilot never asks for a private key, seed phrase or signature here.
          </p>
        </div>
      )}
    </Frame>
  );
}

function LinkedWallets({ wallets, onChanged }: { wallets: CryptoAddress[]; onChanged: () => void }) {
  const { toast } = useToast();
  const browser = useWallets();
  const [label, setLabel] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [source, setSource] = React.useState<"manual" | "browser_wallet">("manual");
  const [chain, setChain] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const ok = isWalletAddress(address);

  const fromBrowser = async (w: DiscoveredWallet) => {
    setBusy(`connect:${w.id}`);
    try {
      const account = await connect(w);
      setAddress(account.address);
      setSource("browser_wallet");
      if (!label) setLabel(w.name);
      setChain(account.chainId ? CHAIN_NAMES[account.chainId] ?? `chain ${account.chainId}` : null);
    } catch (err) {
      toast({ title: "Wallet didn't connect", description: err instanceof Error ? err.message : "The wallet declined the request." });
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("add");
    const res = await apiCall("/api/banking/crypto/addresses", { label: label.trim(), address: address.trim(), source });
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Wallet not linked", description: errorText(res?.data) });
    toast({ title: "Wallet linked", variant: "success" });
    setLabel(""); setAddress(""); setSource("manual"); setChain(null);
    onChanged();
  };

  const remove = async (w: CryptoAddress) => {
    setBusy(`remove:${w.id}`);
    const res = await apiCall(`/api/banking/crypto/addresses/${encodeURIComponent(w.id)}`, undefined, "DELETE");
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Wallet not removed", description: errorText(res?.data) });
    onChanged();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Address copied", variant: "success" });
    } catch {
      toast({ title: "Couldn't copy", description: "Select the address and copy it by hand." });
    }
  };

  return (
    <section className="panel min-w-0 p-0">
      <h3 className="border-b px-5 py-4 font-semibold">Your linked wallets</h3>
      {wallets.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-muted-foreground"><Wallet className="mx-auto mb-2 size-5" />Link a wallet you control to receive and send USDC.</p>
      ) : (
        <ul className="divide-y">
          {wallets.map((w) => (
            <li key={w.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{w.label}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{shortAddress(w.address)} · {w.source === "browser_wallet" ? "from browser wallet" : "entered by hand"}</p>
              </div>
              <Button size="icon" variant="ghost" aria-label={`Copy ${w.label} address`} onClick={() => void copy(w.address)}><Copy /></Button>
              <Button size="icon" variant="ghost" aria-label={`Remove ${w.label}`} disabled={busy !== null} onClick={() => void remove(w)}>
                {busy === `remove:${w.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="space-y-3 border-t p-5">
        <p className="text-sm font-semibold">Link a wallet</p>
        {browser.wallets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {browser.wallets.map((w) => (
              <Button key={w.id} type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void fromBrowser(w)}>
                {busy === `connect:${w.id}` ? <Loader2 className="animate-spin" /> : <Wallet />}
                Use {w.name}
              </Button>
            ))}
          </div>
        )}
        {browser.searched && browser.wallets.length === 0 && (
          <p className="text-xs text-muted-foreground">No browser wallet found. Paste the address instead.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="cw-label">Name</Label>
            <Input id="cw-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="My MetaMask" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cw-addr">Address on Base</Label>
            <Input id="cw-addr" value={address} spellCheck={false} autoComplete="off" className="font-mono text-xs"
              onChange={(e) => { setAddress(e.target.value); setSource("manual"); setChain(null); }} placeholder="0x…" />
          </div>
        </div>
        {chain && chain !== "Base" && (
          <p className="text-xs text-warning">Your wallet is on {chain}. Autopilot uses Base; the same address works there, but switch networks in your wallet before moving real funds.</p>
        )}
        {address && !ok && <p role="alert" className="text-xs text-destructive">Enter a 0x… address (42 characters).</p>}
        <Button type="submit" variant="gradient" disabled={!ok || busy !== null}>{busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />} Link wallet</Button>
      </form>
    </section>
  );
}
