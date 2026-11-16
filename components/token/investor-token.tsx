"use client";
import * as React from "react";
import { AlertTriangle, ArrowDownToLine, Coins, ExternalLink, Link2, Loader2, Lock, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { newIdempotencyKey, toCents, usd } from "@/lib/capital";
import {
  SUBSCRIPTION_LABELS, WALLET_LABELS, explorerLink, formatTokens, formatUsdc, requestAccount, shortAddress, signMessage,
  type Subscription, type TokenMe,
} from "@/lib/token";
import { useWallets } from "@/lib/wallets";
import { formatRelative } from "@/lib/utils";

type Detail = { detail?: string; reasons?: string[] };
const describe = (res: { data?: Detail } | null) =>
  [res?.data?.detail, ...(res?.data?.reasons ?? [])].filter(Boolean).join(" ") || "Can't reach the server.";

export function TestnetBanner({ me }: { me: TokenMe }) {
  return (
    <div role="note" className="mb-4 flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <p>
        <span className="font-medium">{me.chain.mainnet ? "Live network." : `Test network (${me.chain.name}).`}</span>{" "}
        {me.chain.mainnet
          ? "Token subscriptions move real funds."
          : "Tokens and USDC here have no value. Nothing on this page is an offer to sell securities; the token sale opens only after legal approval, an independent audit and the owner's sign-off."}
      </p>
    </div>
  );
}

export function WalletCard({ me, onChanged }: { me: TokenMe; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const wallet = me.wallet;
  const { wallets } = useWallets();
  const [chosenId, setChosenId] = React.useState("");
  const chosen = wallets.find((w) => w.id === (chosenId || wallets[0]?.id)) ?? null;

  const link = async () => {
    setBusy(true);
    try {
      const address = await requestAccount(chosen?.provider);
      const challenge = await apiCall<Detail & { message?: string }>("/api/token/wallets/challenge", { address });
      if (!challenge || challenge.status >= 400 || !challenge.data.message) throw new Error(describe(challenge));
      const signature = await signMessage(address, challenge.data.message, chosen?.provider);
      const res = await apiCall<Detail>("/api/token/wallets", { address, signature });
      if (!res || res.status >= 400) throw new Error(describe(res));
      toast({ title: "Wallet linked", variant: "success" });
      onChanged();
    } catch (err) {
      toast({ title: "Wallet not linked", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Wallet className="size-4" /> Wallet</CardTitle>
        <CardDescription>
          The token can only be held by wallets the treasury has registered. Linking asks your wallet to sign a message; it
          never sends a transaction or moves funds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {wallet ? (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{shortAddress(wallet.address)}</span>
              <Badge variant={wallet.status === "registered" ? "success" : "warning"}>{WALLET_LABELS[wallet.status]}</Badge>
            </p>
            {wallet.status === "linked" && me.reasons.length > 0 && (
              <p className="text-muted-foreground">Finish investor verification on the Portfolio page, then the treasury registers this wallet.</p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">No wallet linked yet.</p>
        )}
        {(!wallet || wallet.status === "linked") && wallets.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="wallet-choice">Wallet</Label>
            <Select id="wallet-choice" value={chosen?.id ?? ""} onChange={(e) => setChosenId(e.target.value)}>
              {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>
        )}
        {(!wallet || wallet.status === "linked") && (
          <Button size="sm" variant={wallet ? "outline" : "default"} disabled={busy} onClick={() => void link()}>
            {busy ? <Loader2 className="animate-spin" /> : <Link2 />} {wallet ? "Link a different wallet" : "Link wallet"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function HoldingCard({ me }: { me: TokenMe }) {
  const h = me.holding;
  const drift = h.onchainTokens != null && h.onchainTokens !== h.tokens;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Coins className="size-4" /> Your tokens</CardTitle>
        <CardDescription>One token is one pool share, priced at the pool&apos;s value. New tokens are locked for {me.lockupDays} days.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Value</dt><dd className="text-xl font-semibold">{usd(h.valueCents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Tokens (ledger)</dt><dd className="text-xl font-semibold tabular-nums">{formatTokens(h.tokens)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Being minted</dt><dd className="tabular-nums">{formatTokens(h.pendingTokens)}</dd></div>
          <div>
            <dt className="text-xs text-muted-foreground">On-chain</dt>
            <dd className={`tabular-nums ${drift ? "text-destructive" : ""}`}>{formatTokens(h.onchainTokens)}</dd>
          </div>
        </dl>
        {h.reconciledAt && <p className="mt-3 text-xs text-muted-foreground">Checked against the chain {formatRelative(h.reconciledAt)}.</p>}
      </CardContent>
    </Card>
  );
}

function PaymentInstructions({ sub, me }: { sub: Subscription; me: TokenMe }) {
  const safeLink = explorerLink(me.chain, "address", sub.payTo);
  return (
    <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs">
      <p className="font-medium">Send exactly {formatUsdc(sub.usdcUnits)} USDC on {me.chain.name}</p>
      <p>From your linked wallet <span className="font-mono">{shortAddress(sub.wallet)}</span></p>
      <p className="break-all">To the treasury Safe <span className="font-mono">{sub.payTo}</span>
        {safeLink && <a className="ml-1 inline-flex items-center text-primary" href={safeLink} target="_blank" rel="noreferrer"><ExternalLink className="size-3" /></a>}
      </p>
      <p className="break-all">USDC contract <span className="font-mono">{sub.usdc}</span></p>
      <p className="text-muted-foreground">A different amount or wallet won&apos;t match and has to be refunded by hand. Expires {formatRelative(sub.expiresAt)}.</p>
    </div>
  );
}

export function SubscribeCard({ me, onChanged }: { me: TokenMe; onChanged: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const idem = React.useMemo(() => newIdempotencyKey(), [amount]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocked = [
    ...me.reasons,
    ...(!me.wallet ? ["Link a wallet first."] : me.wallet.status !== "registered" ? ["Your wallet isn't registered on-chain yet."] : []),
    ...(me.pausedReason ? [me.pausedReason] : []),
  ];
  const open = me.subscriptions.find((s) => s.status === "awaiting_payment");

  const submit = async () => {
    const cents = toCents(amount);
    if (cents == null) return toast({ title: "Enter an amount in dollars" });
    setBusy("subscribe");
    const res = await apiCall<Detail>("/api/token/subscriptions", { amountCents: cents, idempotencyKey: idem });
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Subscription not opened", description: describe(res) });
    toast({ title: "Subscription opened", description: "Send the exact USDC amount shown to complete it.", variant: "success" });
    setAmount("");
    onChanged();
  };

  const cancel = async (id: string) => {
    setBusy(id);
    const res = await apiCall<Detail>(`/api/token/subscriptions/${encodeURIComponent(id)}/cancel`, {});
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Not cancelled", description: describe(res) });
    onChanged();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="size-4" /> Subscribe</CardTitle>
        <CardDescription>
          Pay USDC from your registered wallet to the treasury Safe. After the payment confirms, the treasury signers mint
          tokens at the pool&apos;s current share price.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {blocked.length > 0 && (
          <ul className="list-disc space-y-1 rounded-md bg-muted p-3 pl-7 text-sm text-muted-foreground">
            {blocked.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        {open ? (
          <div className="space-y-2">
            <PaymentInstructions sub={open} me={me} />
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void cancel(open.id)}>
              {busy === open.id && <Loader2 className="animate-spin" />} Cancel subscription
            </Button>
          </div>
        ) : (
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="sub-amount">Amount (USD)</Label>
              <Input id="sub-amount" inputMode="decimal" placeholder="1,000" value={amount} disabled={blocked.length > 0}
                onChange={(e) => setAmount(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy !== null || blocked.length > 0 || !amount}>
              {busy === "subscribe" && <Loader2 className="animate-spin" />} Subscribe
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function SubscriptionList({ me }: { me: TokenMe }) {
  if (me.subscriptions.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Subscriptions</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {me.subscriptions.map((s) => {
            const tx = s.payment?.tx ? explorerLink(me.chain, "tx", s.payment.tx) : null;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="font-medium tabular-nums">{usd(s.amountCents)}</span>
                <Badge variant={SUBSCRIPTION_LABELS[s.status].variant}>{SUBSCRIPTION_LABELS[s.status].label}</Badge>
                {s.shareUnits != null && <span className="text-muted-foreground">{formatTokens(s.shareUnits / 10 ** 6)} tokens</span>}
                {s.lockupUntil && s.status === "minted" && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /> until {new Date(s.lockupUntil).toLocaleDateString()}</span>
                )}
                {tx && <a className="inline-flex items-center gap-1 text-xs text-primary" href={tx} target="_blank" rel="noreferrer">payment <ExternalLink className="size-3" /></a>}
                <span className="ml-auto text-xs text-muted-foreground">{formatRelative(s.createdAt)}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
