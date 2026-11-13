"use client";
import * as React from "react";
import { BadgeCheck, Clock, Landmark, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { validRouting, type BankAccount } from "@/lib/banking";
import { errorText, useApi } from "@/lib/marketplace";
import { Frame, Loading } from "@/components/marketplace/common";
import { bankingLinks } from "./links";

export function BankAccountsView({ base, full }: { base: string; full: boolean }) {
  const { data, loaded, refresh } = useApi<BankAccount[]>("/api/banking/accounts");
  const [adding, setAdding] = React.useState(false);
  const accounts = data ?? [];
  return (
    <Frame kind="banking" links={bankingLinks(base, { full })} title="Bank accounts"
      description="Link a checking or savings account in your name to add money and withdraw.">
      {!loaded ? <Loading /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            {accounts.length === 0 && !adding && (
              <div className="flex flex-col items-center rounded-2xl border border-dashed p-10 text-center">
                <span className="mb-3 rounded-full bg-primary/10 p-3 text-primary"><Landmark className="size-6" /></span>
                <h3 className="font-semibold">No bank linked yet</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">Link an account to fund investments, repay agreements and cash out.</p>
                <Button className="mt-4" variant="gradient" onClick={() => setAdding(true)}><Plus /> Link a bank account</Button>
              </div>
            )}
            {accounts.map((a) => <AccountCard key={a.id} account={a} onChanged={refresh} />)}
            {accounts.length > 0 && !adding && accounts.length < 5 && (
              <Button variant="outline" onClick={() => setAdding(true)}><Plus /> Link another account</Button>
            )}
            {adding && <AddAccount onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}
          </div>
          <aside className="panel h-fit space-y-3 p-5 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">How verification works</p>
            <p>We send two small deposits to the account. Enter the two amounts to prove it&apos;s yours.</p>
            <p>While settlement is simulated, no deposit reaches your bank, so the two amounts are shown on this page instead.</p>
            <p>We keep only your routing number and the last four digits of your account number.</p>
          </aside>
        </div>
      )}
    </Frame>
  );
}

function AccountCard({ account: a, onChanged }: { account: BankAccount; onChanged: () => void }) {
  const { toast } = useToast();
  const [amounts, setAmounts] = React.useState(["", ""]);
  const [busy, setBusy] = React.useState<"verify" | "remove" | null>(null);
  const verify = async () => {
    setBusy("verify");
    const res = await apiCall(`/api/banking/accounts/${a.id}/verify`, {
      amounts: amounts.map((v) => Math.round(Number(v.replace(/[$\s]/g, "")) * 100)),
    });
    setBusy(null);
    if (!res || res.status >= 400) {
      toast({ title: "Not verified", description: errorText(res?.data) });
      return;
    }
    toast({ title: "Bank account verified", variant: "success" });
    onChanged();
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${a.nickname}?`)) return;
    setBusy("remove");
    const res = await apiCall(`/api/banking/accounts/${a.id}`, {}, "DELETE");
    setBusy(null);
    if (!res || res.status >= 400) {
      toast({ title: "Not removed", description: errorText(res?.data) });
      return;
    }
    onChanged();
  };
  return (
    <section className="panel p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Landmark className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{a.nickname}</p>
          <p className="text-xs capitalize text-muted-foreground">{a.kind} ••{a.last4} · routing ••{a.routingLast4} · {a.holder}</p>
        </div>
        {a.status === "verified"
          ? <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success"><BadgeCheck className="size-4" /> Verified</span>
          : <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-warning"><Clock className="size-4" /> Pending</span>}
      </div>
      {a.status === "pending" && (
        <div className="mt-4 space-y-3 rounded-xl bg-muted/50 p-4">
          {a.simulatedDeposits && (
            <p className="text-xs text-muted-foreground">
              Simulated: your bank would show deposits of{" "}
              <span className="font-semibold text-foreground">{a.simulatedDeposits.map((c) => `$${(c / 100).toFixed(2)}`).join(" and ")}</span>.
            </p>
          )}
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-1">
                <Label htmlFor={`md-${a.id}-${i}`} className="text-xs">Deposit {i + 1}</Label>
                <Input id={`md-${a.id}-${i}`} inputMode="decimal" placeholder="0.00" value={amounts[i]}
                  onChange={(e) => setAmounts((cur) => cur.map((v, j) => (j === i ? e.target.value : v)))} />
              </div>
            ))}
            <Button onClick={() => void verify()} disabled={busy !== null || amounts.some((v) => !v)}>
              {busy === "verify" && <Loader2 className="animate-spin" />} Verify
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void remove()} disabled={busy !== null}>
          <Trash2 /> Remove
        </Button>
      </div>
    </section>
  );
}

function AddAccount({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({ holder: "", nickname: "", routing: "", accountNumber: "", confirm: "", kind: "checking" });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const routingOk = validRouting(form.routing.replace(/\D/g, ""));
  const acct = form.accountNumber.replace(/\D/g, "");
  const errors = [
    form.routing && !routingOk ? "That routing number isn't valid." : "",
    form.accountNumber && (acct.length < 4 || acct.length > 17) ? "Account numbers are 4–17 digits." : "",
    form.confirm && form.confirm.replace(/\D/g, "") !== acct ? "Account numbers don't match." : "",
  ].filter(Boolean);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiCall("/api/banking/accounts", {
      holder: form.holder, nickname: form.nickname, routing: form.routing, accountNumber: form.accountNumber, kind: form.kind,
    });
    setBusy(false);
    if (!res || res.status >= 400) {
      toast({ title: "Not linked", description: errorText(res?.data) });
      return;
    }
    toast({ title: "Account added", description: "Enter the two deposit amounts to verify it.", variant: "success" });
    onDone();
  };
  return (
    <form onSubmit={submit} className="panel space-y-4 p-5">
      <p className="font-semibold">Link a bank account</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="ba-holder">Account holder</Label>
          <Input id="ba-holder" autoComplete="name" value={form.holder} onChange={set("holder")} required minLength={3} /></div>
        <div className="space-y-1.5"><Label htmlFor="ba-nick">Nickname (optional)</Label>
          <Input id="ba-nick" value={form.nickname} onChange={set("nickname")} maxLength={40} placeholder="Business checking" /></div>
        <div className="space-y-1.5"><Label htmlFor="ba-routing">Routing number</Label>
          <Input id="ba-routing" inputMode="numeric" value={form.routing} onChange={set("routing")} maxLength={9} required placeholder="9 digits" /></div>
        <div className="space-y-1.5"><Label htmlFor="ba-kind">Type</Label>
          <Select id="ba-kind" value={form.kind} onChange={set("kind")}><option value="checking">Checking</option><option value="savings">Savings</option></Select></div>
        <div className="space-y-1.5"><Label htmlFor="ba-acct">Account number</Label>
          <Input id="ba-acct" inputMode="numeric" autoComplete="off" value={form.accountNumber} onChange={set("accountNumber")} required /></div>
        <div className="space-y-1.5"><Label htmlFor="ba-confirm">Confirm account number</Label>
          <Input id="ba-confirm" inputMode="numeric" autoComplete="off" value={form.confirm} onChange={set("confirm")} required /></div>
      </div>
      {errors.length > 0 && <p role="alert" className="text-xs text-destructive">{errors.join(" ")}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="gradient" className="flex-1" disabled={busy || errors.length > 0 || !routingOk || !form.holder || !form.confirm}>
          {busy && <Loader2 className="animate-spin" />} Link account
        </Button>
      </div>
    </form>
  );
}
