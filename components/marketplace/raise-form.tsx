"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, CheckCircle2, Circle, Loader2, PieChart, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { toCents, usd } from "@/lib/capital";
import {
  USE_LABEL, bps, errorText, useMarketOverview, useMyListings, useTrackRecord, type Listing, type ListingKind,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { Figure, Frame, GradeBadge, Loading, StatusPill, marketLinks } from "./common";

type Use = { key: number; category: string; amount: string; note: string };

export function RaiseForm({ base, verifyHref, accountsHref }: { base: string; verifyHref: string; accountsHref: string }) {
  const overview = useMarketOverview();
  const record = useTrackRecord();
  const mine = useMyListings();
  return (
    <Frame kind="market" links={marketLinks(base, { raise: true })} title="Raise funds"
      description="Borrow up to $10,000 for hiring, equipment or growth, or offer investors a share of your revenue. Your verified track record sets your terms.">
      {!overview.loaded || !record.loaded || !mine.loaded ? <Loading /> : !overview.data || !record.data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load your track record. Refresh to try again.</p>
      ) : (
        <Form base={base} verifyHref={verifyHref} accountsHref={accountsHref} policy={overview.data.policy}
          record={record.data} mine={mine.data ?? []} />
      )}
    </Frame>
  );
}

function Form({
  base, verifyHref, accountsHref, policy, record, mine,
}: {
  base: string; verifyHref: string; accountsHref: string;
  policy: NonNullable<ReturnType<typeof useMarketOverview>["data"]>["policy"];
  record: NonNullable<ReturnType<typeof useTrackRecord>["data"]>;
  mine: Listing[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [kind, setKind] = React.useState<ListingKind>("project_funding");
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [target, setTarget] = React.useState("5000");
  const [minInv, setMinInv] = React.useState("50");
  const [term, setTerm] = React.useState(String(policy.termMonths[1] ?? 6));
  const [share, setShare] = React.useState("8");
  const [period, setPeriod] = React.useState(String(policy.revPeriodMonths[1] ?? 12));
  const [uses, setUses] = React.useState<Use[]>([{ key: 1, category: "hiring", amount: "5000", note: "" }]);
  const [busy, setBusy] = React.useState<"draft" | "publish" | null>(null);

  const live = mine.find((l) => ["open", "disbursing", "refunding"].includes(l.status));
  const targetCents = toCents(target) ?? 0;
  const usesTotal = uses.reduce((n, u) => n + (toCents(u.amount) ?? 0), 0);
  const rate = policy.projectRateBps[record.grade];
  const totalRepay = targetCents + Math.floor((targetCents * rate) / 10_000);
  const months = Number(term);
  const fee = Math.floor((targetCents * policy.originationFeeBps) / 10_000);
  const shareBps = Math.round(Number(share) * 100);
  const capCents = Math.floor((targetCents * policy.revCapBps) / 10_000);
  const monthlyRevenue = Math.floor(record.trailingYearCents / 12);

  const checks = [
    { ok: record.kycStatus === "verified", label: "Identity verified", href: verifyHref, cta: "Verify" },
    { ok: record.verifiedOrders > 0, label: "At least one order verified by a marketplace API", href: accountsHref, cta: "Connect an account" },
    { ok: !live, label: "No other raise open", href: live ? `${base}/${live.id}` : base, cta: "View it" },
  ];
  const errors = [
    targetCents < policy.minRaiseCents || targetCents > policy.maxRaiseCents
      ? `Raise between ${usd(policy.minRaiseCents)} and ${usd(policy.maxRaiseCents)}.` : "",
    usesTotal > targetCents ? "Uses of funds add up to more than the target." : "",
    title.trim().length < 5 ? "Add a title (5+ characters)." : "",
    kind === "revenue_share" && (shareBps < policy.revShareMinBps || shareBps > policy.revShareMaxBps)
      ? `Revenue share must be ${bps(policy.revShareMinBps)}–${bps(policy.revShareMaxBps)}.` : "",
  ].filter(Boolean);

  const submit = async (publish: boolean) => {
    setBusy(publish ? "publish" : "draft");
    const res = await apiCall<Listing & { detail?: string }>("/api/marketplace/listings", {
      kind, title, summary, displayName, targetCents, minInvestmentCents: toCents(minInv) ?? 0,
      termMonths: kind === "project_funding" ? months : null,
      shareBps: kind === "revenue_share" ? shareBps : null, periodMonths: kind === "revenue_share" ? Number(period) : null,
      uses: uses.filter((u) => toCents(u.amount)).map((u) => ({ category: u.category, amountCents: toCents(u.amount), note: u.note })),
      publish,
    });
    setBusy(null);
    if (!res || res.status >= 400) {
      toast({ title: publish ? "Not published" : "Not saved", description: errorText(res?.data) });
      // A publish that failed after the draft was created leaves a draft: refresh the list via navigation.
      return;
    }
    toast({ title: publish ? "Your raise is live" : "Draft saved", variant: "success" });
    router.push(`${base}/${res.data.id}`);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        {mine.length > 0 && (
          <section className="panel p-0">
            <h3 className="border-b px-5 py-3 text-sm font-semibold">Your raises</h3>
            <ul className="divide-y">
              {mine.map((l) => (
                <li key={l.id}>
                  <Link href={`${base}/${l.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-accent/40">
                    <span className="min-w-0 truncate">{l.title}</span>
                    <span className="flex shrink-0 items-center gap-2"><span className="tabular-nums text-muted-foreground">{usd(l.status === "open" ? l.raisedCents : l.fundedCents)}</span><StatusPill status={l.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Type of raise">
          {([
            ["project_funding", Briefcase, "Project funding", `Borrow up to ${usd(policy.maxRaiseCents)} to hire developers, buy equipment or expand. Repay in monthly installments.`],
            ["revenue_share", PieChart, "Revenue sharing", `Investors receive a set % of your verified revenue for a set period, capped at ${policy.revCapBps / 10_000}× what they put in.`],
          ] as const).map(([k, Icon, label, desc]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={cn("rounded-2xl border p-4 text-left transition-colors", kind === k ? "border-primary bg-primary/10 ring-1 ring-primary/40" : "hover:border-primary/40")}>
              <Icon className="size-5 text-primary" />
              <p className="mt-2 font-semibold">{label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
            </button>
          ))}
        </section>

        <section className="panel space-y-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="r-title">Title</Label>
            <Input id="r-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Hire two React developers for a SaaS backlog" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-summary">What investors should know</Label>
            <Textarea id="r-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={600}
              placeholder="What you do, who your clients are, and how this money grows the business." />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="r-name">Show as</Label>
              <Input id="r-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="Your studio or name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="r-target">Raise (USD)</Label>
                <Input id="r-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-min">Min. ticket</Label>
                <Input id="r-min" inputMode="decimal" value={minInv} onChange={(e) => setMinInv(e.target.value)} />
              </div>
            </div>
          </div>
          {kind === "project_funding" ? (
            <div className="space-y-1.5">
              <Label htmlFor="r-term">Repay over</Label>
              <Select id="r-term" value={term} onChange={(e) => setTerm(e.target.value)}>
                {policy.termMonths.map((m) => <option key={m} value={m}>{m} months</option>)}
              </Select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="r-share">Revenue share (%)</Label>
                <Input id="r-share" inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-period">For</Label>
                <Select id="r-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
                  {policy.revPeriodMonths.map((m) => <option key={m} value={m}>{m} months</option>)}
                </Select>
              </div>
            </div>
          )}
        </section>

        <section className="panel space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">Use of funds</h3>
            <span className={cn("text-xs tabular-nums", usesTotal > targetCents ? "text-destructive" : "text-muted-foreground")}>{usd(usesTotal)} of {usd(targetCents)}</span>
          </div>
          {uses.map((u, i) => (
            <div key={u.key} className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] gap-2 sm:grid-cols-[10rem_7rem_minmax(0,1fr)_auto]">
              <Select aria-label="Category" value={u.category} onChange={(e) => setUses((cur) => cur.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}>
                {policy.useOfFunds.map((c) => <option key={c} value={c}>{USE_LABEL[c] ?? c}</option>)}
              </Select>
              <Input aria-label="Amount" inputMode="decimal" value={u.amount} onChange={(e) => setUses((cur) => cur.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
              <Input aria-label="Note" className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto" placeholder="Note (optional)" value={u.note} maxLength={120}
                onChange={(e) => setUses((cur) => cur.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove" className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto"
                onClick={() => setUses((cur) => cur.filter((_, j) => j !== i))} disabled={uses.length === 1}><Trash2 /></Button>
            </div>
          ))}
          {uses.length < 8 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setUses((cur) => [...cur, { key: Date.now(), category: "equipment", amount: "", note: "" }])}>
              <Plus /> Add a use
            </Button>
          )}
        </section>
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
        <section className="panel p-5">
          <div className="flex items-center gap-3">
            <GradeBadge grade={record.grade} size="lg" />
            <div className="min-w-0">
              <p className="font-semibold">Your risk grade</p>
              <p className="text-xs text-muted-foreground">{record.gradeNote}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Figure label="Verified completed" value={usd(record.completedValueCents)} />
            <Figure label="Last 12 months" value={usd(record.trailingYearCents)} />
          </div>
          <div className="mt-4 space-y-1.5 border-t pt-4 text-sm">
            {kind === "project_funding" ? (
              <>
                <Line label="You receive" value={usd(Math.max(0, targetCents - fee))} hint={`after ${bps(policy.originationFeeBps)} fee`} />
                <Line label="Investor return" value={bps(rate)} />
                <Line label="You repay" value={usd(totalRepay)} />
                <Line label="Monthly" value={months ? usd(Math.ceil(totalRepay / months)) : "—"} hint={`× ${months}`} />
              </>
            ) : (
              <>
                <Line label="You receive" value={usd(Math.max(0, targetCents - fee))} hint={`after ${bps(policy.originationFeeBps)} fee`} />
                <Line label="Investors get" value={`${share || 0}% for ${period} months`} />
                <Line label="Payments stop at" value={usd(capCents)} />
                <Line label="At last year's pace" value={`${usd(Math.floor((monthlyRevenue * shareBps) / 10_000))}/mo`} />
              </>
            )}
          </div>
        </section>
        <section className="panel space-y-2 p-5">
          <p className="text-sm font-semibold">Before you publish</p>
          {checks.map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">{c.ok ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}{c.label}</span>
              {!c.ok && <Link href={c.href} className="shrink-0 text-xs font-medium text-primary hover:underline">{c.cta}</Link>}
            </div>
          ))}
          {errors.length > 0 && <p role="alert" className="pt-1 text-xs text-destructive">{errors.join(" ")}</p>}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" disabled={busy !== null || errors.length > 0 || Boolean(live)} onClick={() => void submit(false)}>
              {busy === "draft" && <Loader2 className="animate-spin" />} Save draft
            </Button>
            <Button variant="gradient" className="flex-1" disabled={busy !== null || errors.length > 0 || !checks.every((c) => c.ok)} onClick={() => void submit(true)}>
              {busy === "publish" && <Loader2 className="animate-spin" />} Publish
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Raises stay open {policy.raiseDays} days. You can accept at {bps(policy.minCloseBps)} funded or more; otherwise investors are refunded.</p>
        </section>
      </aside>
    </div>
  );
}

function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}{hint && <span className="ml-1 text-xs font-normal text-muted-foreground">{hint}</span>}</span>
    </div>
  );
}
