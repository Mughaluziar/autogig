"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, CreditCard, Gift, Loader2, Lock, Snowflake, Sparkles, Undo2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey, toCents, usd } from "@/lib/capital";
import {
  CARD_CATEGORY_LABEL, CHANNEL_LABEL, useCards, type CardChannel, type CardOverview, type CardTransaction, type DebitCard,
} from "@/lib/banking";
import { errorText, shortDate } from "@/lib/marketplace";
import {
  CARD_COUNTDOWN_DAYS, CARD_LAUNCH_AT, FOUNDING_PERKS, QUIZ, buildOffer, type Offer, type QuizAnswers,
} from "@/lib/landing";
import { isEmail, joinWaitlist } from "@/components/marketing/landing/waitlist";
import { cn } from "@/lib/utils";
import { Figure, Frame } from "@/components/marketplace/common";
import { bankingLinks } from "./links";

function useNow() {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Same fixed launch date as the landing page (lib/landing.ts), so both count down together. */
export function CardCountdown({ compact, onDark }: { compact?: boolean; onDark?: boolean }) {
  const now = useNow();
  const end = Date.parse(CARD_LAUNCH_AT);
  const start = end - CARD_COUNTDOWN_DAYS * 86_400_000;
  const ms = now == null || Number.isNaN(end) ? null : Math.max(0, end - now);
  const cells: [string, number | null][] = [
    ["Days", ms == null ? null : Math.floor(ms / 86_400_000)],
    ["Hrs", ms == null ? null : Math.floor(ms / 3_600_000) % 24],
    ["Min", ms == null ? null : Math.floor(ms / 60_000) % 60],
    ["Sec", ms == null ? null : Math.floor(ms / 1000) % 60],
  ];
  const day = now == null ? null : Math.min(CARD_COUNTDOWN_DAYS, Math.max(1, Math.ceil((now - start) / 86_400_000)));
  const launch = Number.isNaN(end) ? "" : new Date(end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (ms === 0) return <p className="font-semibold">Rolling out now, waitlist members first.</p>;
  return (
    <div>
      <div className={cn("grid grid-cols-4", compact ? "gap-1.5" : "gap-2")} role="timer" aria-label={launch ? `Cards launch ${launch}` : "Cards launch countdown"}>
        {cells.map(([label, v]) => (
          <div key={label} className={cn("rounded-lg px-1.5 py-2 text-center", onDark ? "bg-white/10" : "border bg-card")}>
            <p className={cn("font-extrabold tabular-nums", compact ? "text-lg" : "text-2xl sm:text-3xl", !onDark && "gradient-text")} aria-hidden>
              {v == null ? "--" : String(v).padStart(2, "0")}
            </p>
            <p className={cn("text-[10px] uppercase tracking-wider", onDark ? "text-white/60" : "text-muted-foreground")}>{label}</p>
          </div>
        ))}
      </div>
      {!compact && day != null && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500" style={{ width: `${(day / CARD_COUNTDOWN_DAYS) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">Day {day} of {CARD_COUNTDOWN_DAYS} · planned launch {launch}</p>
        </div>
      )}
    </div>
  );
}

function CardArt({ kind, card }: { kind: "debit" | "credit"; card?: DebitCard | null }) {
  const off = card && card.status !== "active";
  return (
    <div role={card ? "img" : undefined} aria-label={card ? `Virtual debit card ending ${card.last4}, ${card.status}` : undefined}
      aria-hidden={card ? undefined : true}
      className={cn("relative aspect-[1.586] w-full max-w-xs overflow-hidden rounded-2xl p-4 text-white shadow-2xl ring-1 ring-white/10",
        kind === "debit" ? "bg-gradient-to-br from-cyan-400 via-primary to-purple-600" : "bg-gradient-to-br from-zinc-900 via-purple-900 to-fuchsia-700",
        off && "grayscale")}>
      <div className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <p className="text-sm font-bold">Autopilot</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/80">{card ? "Virtual debit · simulated" : kind}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-9 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 opacity-90" />
          {card?.status === "frozen" && <span className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold"><Snowflake className="size-3" /> Frozen</span>}
        </div>
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-white/90">•••• •••• •••• {card?.last4 ?? "2027"}</p>
          {card && <p className="mt-1 flex justify-between font-mono text-[10px] text-white/80"><span className="truncate">{card.nameOnCard}</span><span>{card.expires}</span></p>}
        </div>
      </div>
    </div>
  );
}

export function CardsView({ base }: { base: string }) {
  const { user } = useAuth();
  return (
    <Frame kind="banking" links={bankingLinks(base, { full: true })} title="Autopilot Cards"
      description="A virtual debit card on your Autopilot USD balance, and a credit card with limits informed by your platform earnings.">
      <div className="space-y-5">
        <DebitCardManager base={base} />
        <section className="panel p-5 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Credit card launch countdown</p>
              <h2 className="mt-1 text-xl font-bold">Waitlist members get cards first</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {FOUNDING_PERKS.map((p) => <li key={p} className="flex items-center gap-2"><Gift className="size-3.5 text-primary" /> {p}</li>)}
              </ul>
            </div>
            <div className="w-full md:max-w-sm"><CardCountdown /></div>
          </div>
        </section>
        <div className="grid gap-5 lg:grid-cols-2">
          <CreditCard_ email={user?.email ?? ""} name={user?.name ?? ""} />
          <DebitWaitlist email={user?.email ?? ""} name={user?.name ?? ""} />
        </div>
        <p className="text-xs text-muted-foreground">
          The virtual debit card is a simulation: no card number exists, nothing can be bought with it, and purchases are recorded
          only in your Autopilot ledger. Joining a waitlist records your interest only: no application, no credit check, no
          effect on your credit score. Real cards will be issued by a licensed partner bank, subject to approval. Reward rates
          shown are planned targets; the issuing bank sets final rates, fees and limits at launch.
        </p>
      </div>
    </Frame>
  );
}

// --------------------------------------------------------------------------- //
// Virtual debit card (simulated)
// --------------------------------------------------------------------------- //
function DebitCardManager({ base }: { base: string }) {
  const { toast } = useToast();
  const { data, loaded, refresh } = useCards();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = React.useState(false);

  const issue = async () => {
    setBusy("issue");
    const res = await apiCall("/api/banking/cards");
    setBusy(null);
    if (!res || res.status >= 400) {
      if (res?.status === 403) setNeedsVerification(true);
      return toast({ title: "Card not issued", description: errorText(res?.data) });
    }
    toast({ title: "Virtual debit card ready", description: "Simulated: it spends your Autopilot USD balance in the ledger only.", variant: "success" });
    refresh();
  };

  if (!loaded) return <section className="panel p-6"><p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading your card…</p></section>;
  if (!data) return <section className="panel p-6 text-center text-sm text-muted-foreground">Couldn&apos;t load your card. <Button variant="link" onClick={refresh}>Retry</Button></section>;

  if (!data.card) {
    return (
      <section className="panel flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
        <CardArt kind="debit" />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">Autopilot Debit <Badge variant="warning">Simulated</Badge></h2>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            <li>Spends your Autopilot USD balance the moment money lands there</li>
            <li>Freeze it instantly, switch online or ATM use on and off, set per-purchase and daily limits</li>
            <li>Every purchase and refund appears in Transactions and your statement</li>
          </ul>
          <Button className="mt-4" variant="gradient" disabled={busy !== null} onClick={() => void issue()}>
            {busy === "issue" && <Loader2 className="animate-spin" />} <CreditCard /> Get a virtual debit card
          </Button>
          {needsVerification && (
            <p className="mt-2 text-xs text-muted-foreground">Cards need verified identity: <Link href="/dashboard/capital" className="font-medium text-primary hover:underline">verify in Capital</Link>.</p>
          )}
        </div>
      </section>
    );
  }
  return <CardPanel data={data} card={data.card} refresh={refresh} base={base} />;
}

function CardPanel({ data, card, refresh, base }: { data: CardOverview; card: DebitCard; refresh: () => void; base: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const status = async (action: "freeze" | "unfreeze" | "cancel") => {
    if (action === "cancel" && !window.confirm(`Cancel card ••${card.last4}? This can't be undone; you can get a new card afterwards.`)) return;
    setBusy(action);
    const res = await apiCall(`/api/banking/cards/${encodeURIComponent(card.id)}/status`, { action });
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Card not updated", description: errorText(res?.data) });
    toast({ title: action === "freeze" ? "Card frozen" : action === "unfreeze" ? "Card unfrozen" : "Card cancelled", variant: "success" });
    refresh();
  };
  const usedPct = Math.min(100, Math.round((card.spentTodayCents / Math.max(1, card.dailyLimitCents)) * 100));
  return (
    <div className="space-y-5">
      <section className="panel grid gap-5 p-5 sm:p-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        <CardArt kind="debit" card={card} />
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">Virtual debit ••{card.last4}</h2>
            <Badge variant={card.status === "active" ? "success" : "warning"}>{card.status === "active" ? "Active" : "Frozen"}</Badge>
            <Badge variant="warning">Simulated</Badge>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Figure label="Spends from (USD balance)" value={usd(data.balances.usdCents)} />
            <Figure label="Spent today" value={usd(card.spentTodayCents)} hint={`of ${usd(card.dailyLimitCents)} daily limit`} />
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Daily limit used" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500" style={{ width: `${usedPct}%` }} />
          </div>
          <div className="flex flex-wrap gap-2">
            {card.status === "active" ? (
              <Button variant="outline" disabled={busy !== null} onClick={() => void status("freeze")}>{busy === "freeze" ? <Loader2 className="animate-spin" /> : <Snowflake />} Freeze</Button>
            ) : (
              <Button disabled={busy !== null} onClick={() => void status("unfreeze")}>{busy === "unfreeze" ? <Loader2 className="animate-spin" /> : <Lock />} Unfreeze</Button>
            )}
            <Button variant="ghost" disabled={busy !== null} onClick={() => void status("cancel")}>{busy === "cancel" ? <Loader2 className="animate-spin" /> : <XCircle />} Cancel card</Button>
            <Button variant="ghost" asChild><Link href={`${base}/transfers?kind=deposit`}>Add money</Link></Button>
          </div>
        </div>
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <CardControls key={`${card.id}:${card.perTransactionLimitCents}:${card.dailyLimitCents}:${card.onlineEnabled}:${card.atmEnabled}`}
          card={card} limits={data.limits} onSaved={refresh} />
        <SimulatePurchase card={card} data={data} onDone={refresh} />
      </div>
      <CardTransactions txns={data.transactions} onChanged={refresh} />
    </div>
  );
}

function CardControls({ card, limits, onSaved }: { card: DebitCard; limits: CardOverview["limits"]; onSaved: () => void }) {
  const { toast } = useToast();
  const [per, setPer] = React.useState((card.perTransactionLimitCents / 100).toFixed(0));
  const [daily, setDaily] = React.useState((card.dailyLimitCents / 100).toFixed(0));
  const [online, setOnline] = React.useState(card.onlineEnabled);
  const [atm, setAtm] = React.useState(card.atmEnabled);
  const [busy, setBusy] = React.useState(false);
  const perC = toCents(per) ?? 0;
  const dailyC = toCents(daily) ?? 0;
  const problem = perC < limits.minLimitCents || perC > limits.maxPerTransactionCents ? `Per-purchase limit: ${usd(limits.minLimitCents)} to ${usd(limits.maxPerTransactionCents)}.`
    : dailyC < limits.minLimitCents || dailyC > limits.maxDailyCents ? `Daily limit: ${usd(limits.minLimitCents)} to ${usd(limits.maxDailyCents)}.`
    : perC > dailyC ? "The per-purchase limit can't be higher than the daily limit." : "";
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiCall(`/api/banking/cards/${encodeURIComponent(card.id)}/controls`, {
      perTransactionLimitCents: perC, dailyLimitCents: dailyC, onlineEnabled: online, atmEnabled: atm });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Controls not saved", description: errorText(res?.data) });
    toast({ title: "Card controls saved", variant: "success" });
    onSaved();
  };
  return (
    <form onSubmit={save} className="panel space-y-4 p-5">
      <p className="font-semibold">Controls</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cc-per">Per purchase (USD)</Label>
          <Input id="cc-per" inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-daily">Daily (USD)</Label>
          <Input id="cc-daily" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <Label htmlFor="cc-online" className="font-normal">Online purchases</Label>
        <Switch id="cc-online" checked={online} onCheckedChange={setOnline} />
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <Label htmlFor="cc-atm" className="font-normal">ATM withdrawals</Label>
        <Switch id="cc-atm" checked={atm} onCheckedChange={setAtm} />
      </div>
      {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
      <Button type="submit" variant="outline" disabled={busy || Boolean(problem)}>{busy && <Loader2 className="animate-spin" />} Save controls</Button>
    </form>
  );
}

function SimulatePurchase({ card, data, onDone }: { card: DebitCard; data: CardOverview; onDone: () => void }) {
  const { toast } = useToast();
  const [merchant, setMerchant] = React.useState("");
  const [category, setCategory] = React.useState("software");
  const [channel, setChannel] = React.useState<CardChannel>("online");
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<CardTransaction | null>(null);
  const key = React.useMemo(() => newIdempotencyKey(), [merchant, category, channel, amount]); // eslint-disable-line react-hooks/exhaustive-deps
  const cents = toCents(amount) ?? 0;
  const atm = channel === "atm";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiCall<{ transaction: CardTransaction }>(`/api/banking/cards/${encodeURIComponent(card.id)}/simulate`, {
      merchant: atm ? "ATM" : merchant.trim(), category: atm ? "cash" : category, channel, amountCents: cents, idempotencyKey: key });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Purchase not simulated", description: errorText(res?.data) });
    setResult(res.data.transaction);
    if (res.data.transaction.status === "approved") setAmount("");
    onDone();
  };
  return (
    <form onSubmit={submit} className="panel space-y-4 p-5">
      <div>
        <p className="font-semibold">Try a purchase</p>
        <p className="text-xs text-muted-foreground">Simulates what a merchant&apos;s card terminal would ask: the same checks run, and an approval moves money in your ledger only.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sp-ch">Where</Label>
          <Select id="sp-ch" value={channel} onChange={(e) => setChannel(e.target.value as CardChannel)}>
            {data.channels.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-cat">Category</Label>
          <Select id="sp-cat" value={atm ? "cash" : category} disabled={atm} onChange={(e) => setCategory(e.target.value)}>
            {data.categories.filter((c) => atm || c !== "cash").map((c) => <option key={c} value={c}>{CARD_CATEGORY_LABEL[c] ?? c}</option>)}
          </Select>
        </div>
      </div>
      {!atm && (
        <div className="space-y-1.5">
          <Label htmlFor="sp-m">Merchant</Label>
          <Input id="sp-m" value={merchant} maxLength={40} onChange={(e) => setMerchant(e.target.value)} placeholder="Figma" />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="sp-amt">Amount (USD)</Label>
        <Input id="sp-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </div>
      {result && (
        <p role="status" className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
          result.status === "approved" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
          {result.status === "approved" ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
          {result.status === "approved" ? `Approved: ${usd(result.amountCents)} at ${result.merchant}` : `Declined: ${result.declineText ?? "declined"}`}
        </p>
      )}
      <Button type="submit" variant="gradient" className="w-full" disabled={busy || !cents || (!atm && merchant.trim().length < 2)}>
        {busy && <Loader2 className="animate-spin" />} Simulate {atm ? "ATM withdrawal" : "purchase"}{cents ? ` · ${usd(cents)}` : ""}
      </Button>
    </form>
  );
}

function CardTransactions({ txns, onChanged }: { txns: CardTransaction[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const refund = async (t: CardTransaction) => {
    setBusy(t.id);
    const res = await apiCall(`/api/banking/cards/transactions/${encodeURIComponent(t.id)}/refund`);
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Refund not simulated", description: errorText(res?.data) });
    toast({ title: "Refund received", description: `${usd(t.amountCents)} back in your USD balance (simulated).`, variant: "success" });
    onChanged();
  };
  return (
    <section className="panel min-w-0 p-0">
      <h3 className="border-b px-5 py-4 font-semibold">Card activity</h3>
      {txns.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">No card activity yet. Try a purchase above.</p>
      ) : (
        <ul className="divide-y">
          {txns.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.merchant}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {shortDate(t.createdAt)} · {CHANNEL_LABEL[t.channel]} · {CARD_CATEGORY_LABEL[t.category] ?? t.category} · ••{t.last4}
                  {t.status === "declined" && t.declineText ? ` · ${t.declineText}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="text-right">
                  <p className={cn("text-sm font-semibold tabular-nums", t.status !== "approved" && "text-muted-foreground", t.status === "declined" && "line-through")}>−{usd(t.amountCents)}</p>
                  <Badge variant={t.status === "approved" ? "success" : t.status === "refunded" ? "secondary" : "destructive"}>
                    {t.status === "approved" ? "Approved" : t.status === "refunded" ? "Refunded" : "Declined"}
                  </Badge>
                </div>
                {t.status === "approved" && t.channel !== "atm" && (
                  <Button size="sm" variant="ghost" title="Simulate a merchant refund" disabled={busy !== null} onClick={() => void refund(t)}>
                    {busy === t.id ? <Loader2 className="animate-spin" /> : <Undo2 />}<span className="sr-only sm:not-sr-only">Refund</span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The debit card's place in the launch waitlist (for a real, partner-issued card). */
function DebitWaitlist({ email: initial, name }: { email: string; name: string }) {
  const [email, setEmail] = React.useState(initial);
  const [state, setState] = React.useState<"idle" | "busy" | "done">("idle");
  const [msg, setMsg] = React.useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) { setMsg("Enter a valid email address."); return; }
    setState("busy"); setMsg("");
    const r = await joinWaitlist({ email, name, product: "debit-card", answers: { payout: "autopilot-balance" } });
    if (!r.ok) { setState("idle"); setMsg(r.error); return; }
    setState("done");
    setMsg(r.demo ? "Demo mode: nothing was sent." : r.already ? "You're already on the list." : "You're on the list. We'll email you on launch day.");
  };
  return (
    <section className="panel flex flex-col gap-4 p-5 sm:p-6">
      <CardArt kind="debit" />
      <div>
        <h3 className="text-lg font-bold">Autopilot Debit (physical card)</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>A real card from a licensed partner bank, when it launches</li>
          <li>Spend USD or USDC from one card</li>
          <li>Instant early-payment and marketplace funds, no transfer wait</li>
        </ul>
      </div>
      {state === "done" ? (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-success/15 px-3 py-2.5 text-sm font-medium text-success"><CheckCircle2 className="size-4" />{msg}</p>
      ) : (
        <form onSubmit={submit} className="mt-auto space-y-2" noValidate>
          <Label htmlFor="debit-email" className="sr-only">Email</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="debit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@work.com" className="min-w-0 sm:flex-1" />
            <Button type="submit" variant="outline" disabled={state === "busy"}>{state === "busy" && <Loader2 className="animate-spin" />} Reserve debit</Button>
          </div>
          {msg && <p role="alert" className="text-xs text-destructive">{msg}</p>}
        </form>
      )}
    </section>
  );
}

const EMPTY: QuizAnswers = { role: "", revenue: "", spend: [], rewards: "" };
const STEPS = ["role", "revenue", "spend", "rewards"] as const;
const PROMPTS: Record<(typeof STEPS)[number], string> = {
  role: "How do you work?", revenue: "Monthly revenue across platforms", spend: "Where do you spend most? (up to 2)", rewards: "How do you want rewards?",
};

function CreditCard_({ email: initial, name }: { email: string; name: string }) {
  const [step, setStep] = React.useState(0);
  const [a, setA] = React.useState<QuizAnswers>(EMPTY);
  const [offer, setOffer] = React.useState<Offer | null>(null);
  const [email, setEmail] = React.useState(initial);
  const [state, setState] = React.useState<"idle" | "busy" | "done">("idle");
  const [msg, setMsg] = React.useState("");
  const key = STEPS[step];
  const options = key ? (QUIZ[key] as { id: string; label: string; hint?: string }[]) : [];
  const answered = key === "spend" ? a.spend.length > 0 : key ? Boolean(a[key]) : true;

  const pick = (id: string) => {
    if (key === "spend") {
      setA((cur) => ({ ...cur, spend: cur.spend.includes(id) ? cur.spend.filter((s) => s !== id) : [...cur.spend, id].slice(-2) }));
    } else if (key) {
      setA((cur) => ({ ...cur, [key]: id }));
    }
  };
  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else setOffer(buildOffer(a));
  };
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offer) return;
    if (!isEmail(email)) { setMsg("Enter a valid email address."); return; }
    setState("busy"); setMsg("");
    const r = await joinWaitlist({ email, name, product: "credit-card",
      answers: { role: a.role, revenue: a.revenue, spend: a.spend, rewards: a.rewards, offer: offer.id } });
    if (!r.ok) { setState("idle"); setMsg(r.error); return; }
    setState("done");
    setMsg(r.demo ? "Demo mode: nothing was sent." : r.already ? "You're already on the list. Your offer is saved." : "Reserved. Your offer is saved for launch day.");
  };

  return (
    <section className="panel flex flex-col gap-4 p-5 sm:p-6">
      <CardArt kind="credit" />
      <div>
        <h3 className="flex items-center gap-2 text-lg font-bold">Autopilot Credit <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">Personalized</span></h3>
        <p className="mt-1 text-sm text-muted-foreground">Answer four questions to see the offer we&apos;re building for you.</p>
      </div>
      {!offer ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{PROMPTS[key]}</span>
            <span>{step + 1} / {STEPS.length}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((o) => {
              const active = key === "spend" ? a.spend.includes(o.id) : a[key as Exclude<typeof key, "spend">] === o.id;
              return (
                <button key={o.id} type="button" aria-pressed={active} onClick={() => pick(o.id)}
                  className={cn("rounded-xl border px-3 py-2.5 text-left text-sm transition-colors", active ? "border-primary bg-primary/10" : "hover:border-primary/40")}>
                  <span className="font-medium">{o.label}</span>
                  {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft /> Back</Button>}
            <Button className="flex-1" variant="gradient" disabled={!answered} onClick={next}>
              {step < STEPS.length - 1 ? <>Next <ArrowRight /></> : <><Sparkles /> See my offer</>}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-primary/40 bg-primary/[0.07] p-4">
            <p className="flex items-center gap-2 font-semibold"><CreditCard className="size-4 text-primary" /> {offer.card}</p>
            <p className="mt-1 text-sm text-muted-foreground">{offer.tagline}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {offer.rewards.map((r) => (
                <li key={r.category} className="flex justify-between gap-2"><span>{r.category}</span><span className="font-semibold">{r.pct}% planned</span></li>
              ))}
            </ul>
            <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
              {offer.highlights.map((h) => <li key={h} className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" /> {h}</li>)}
            </ul>
          </div>
          {state === "done" ? (
            <p role="status" className="flex items-center gap-2 rounded-lg bg-success/15 px-3 py-2.5 text-sm font-medium text-success"><CheckCircle2 className="size-4" />{msg}</p>
          ) : (
            <form onSubmit={join} className="space-y-2" noValidate>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@work.com" className="min-w-0 sm:flex-1" />
                <Button type="submit" variant="gradient" disabled={state === "busy"}>{state === "busy" && <Loader2 className="animate-spin" />} Reserve this offer</Button>
              </div>
              {msg && <p role="alert" className="text-xs text-destructive">{msg}</p>}
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setOffer(null); setStep(0); }}>Change my answers</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
