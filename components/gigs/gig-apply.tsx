"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, ClipboardCopy, Crown, ExternalLink, Gavel, Plus, Send, Trash2, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { PaywallDialog } from "@/components/dashboard/paywall";
import { cn } from "@/lib/utils";
import { BASE, gigBudget, hostOf, listingHref, money } from "@/components/radar/radar-data";
import { useAutoApply, useCredits, useListing, usePipeline, useProposal, useSkills } from "@/components/radar/use-radar";
import { AutoApplyPanel, Composer, StepHeading, copyText } from "@/components/radar/apply-parts";
import { DetailSkeleton, NotFound } from "@/components/radar/job-detail";
import { MatchBar, platformDot } from "./gig-card";

type Milestone = { title: string; amount: string };
const DELIVERY = [1, 3, 5, 7, 14, 21, 30, 60];
const round2 = (n: number) => Math.round(n * 100) / 100;

export function GigApply({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { listing, loading } = useListing(id);
  const { skills } = useSkills();
  const pipe = usePipeline();
  const proposal = useProposal(listing, skills);
  const { isPro, bidCredits } = useCredits();
  const [paywall, setPaywall] = React.useState(false);

  const [rateType, setRateType] = React.useState<"fixed" | "hourly">("fixed");
  const [amount, setAmount] = React.useState("");
  const [hours, setHours] = React.useState("");
  const [useMilestones, setUseMilestones] = React.useState(false);
  const [milestones, setMilestones] = React.useState<Milestone[]>([]);
  const [delivery, setDelivery] = React.useState(7);
  const [opened, setOpened] = React.useState(false);
  const app = listing ? pipe.tracked(listing.id) : undefined;
  const msRows = () => (useMilestones ? milestones.map((m) => ({ title: m.title.trim(), amount: Number(m.amount) || 0 })) : []);

  // Start from the saved bid, else from the client's budget.
  const loaded = React.useRef("");
  React.useEffect(() => {
    if (!listing || !pipe.hydrated || loaded.current === listing.id) return;
    loaded.current = listing.id;
    const rt = app?.rateType ?? (listing.rateType === "hourly" ? "hourly" : "fixed");
    setRateType(rt);
    const start = app?.bidAmount ?? listing.budget ?? null;
    if (start) setAmount(String(start));
    if (app?.deliveryDays) setDelivery(app.deliveryDays);
    if (app?.milestones?.length) {
      setUseMilestones(true);
      setMilestones(app.milestones.map((m) => ({ title: m.title, amount: String(m.amount) })));
    }
  }, [listing, app, pipe.hydrated]);

  const auto = useAutoApply(listing, () => ({
    instructions: `Submit this proposal${amount ? ` with a ${rateType} bid of ${amount} ${listing?.currency ?? "USD"}` : ""}: ${proposal.text}`,
    fields: { proposal: proposal.text, bidAmount: Number(amount) || null, rateType, deliveryDays: delivery, milestones: msRows() },
  }));

  // Paywall when the server says no credits are left.
  React.useEffect(() => {
    if (auto.outOfCredits) setPaywall(true);
  }, [auto.outOfCredits]);

  if (!listing) return loading ? <DetailSkeleton /> : <NotFound kind="gig" />;

  const cur = listing.currency || "USD";
  const bid = Number(amount) || 0;
  const { amount: budgetLabel, unit } = gigBudget(listing);
  const msTotal = round2(milestones.reduce((n, m) => n + (Number(m.amount) || 0), 0));
  const msOk = !useMilestones || (milestones.length > 0 && Math.abs(msTotal - bid) < 0.01 && milestones.every((m) => m.title.trim() && Number(m.amount) > 0));
  const host = hostOf(listing.url) || listing.source;
  const sent = app && !["Saved", "Drafted"].includes(app.stage);

  const budgetNote = (() => {
    if (!bid || !listing.budget) return null;
    if (listing.rateType && listing.rateType !== rateType) return { tone: "warn", text: `The client posted this as ${listing.rateType === "hourly" ? "an hourly" : "a fixed-price"} job.` };
    const lo = listing.budgetMin ?? 0;
    if (bid > listing.budget) return { tone: "warn", text: `${Math.round(((bid - listing.budget) / listing.budget) * 100)}% above the client's top budget — explain why it's worth it.` };
    if (lo && bid < lo) return { tone: "warn", text: "Below the client's range — low bids can read as low quality." };
    return { tone: "ok", text: "Within the client's budget." };
  })();

  const toggleMilestones = (on: boolean) => {
    setUseMilestones(on);
    if (on && milestones.length === 0) {
      const half = bid ? round2(bid / 2) : 0;
      setMilestones([
        { title: "First working version", amount: half ? String(half) : "" },
        { title: "Final delivery and revisions", amount: half ? String(round2(bid - half)) : "" },
      ]);
    }
  };

  const saveBid = (stage: "Drafted" | "Applied") => {
    const row = pipe.track(listing, stage, proposal.text);
    if (row) pipe.patch(row.id, { bidAmount: bid || undefined, rateType, deliveryDays: delivery, milestones: msRows() });
  };

  const summary = () => [
    proposal.text.trim(),
    "",
    rateType === "hourly" ? `Rate: ${money(bid, cur)}/hr${hours ? ` · about ${hours} hrs/week` : ""}` : `Price: ${money(bid, cur)} fixed`,
    `Delivery: ${delivery} day${delivery === 1 ? "" : "s"}`,
    ...(useMilestones ? ["Milestones:", ...milestones.map((m, i) => `${i + 1}. ${m.title} — ${money(Number(m.amount), cur)}`)] : []),
  ].join("\n").trim();

  const copyAndOpen = async () => {
    saveBid("Drafted");
    const ok = await copyText(summary());
    window.open(listing.url, "_blank", "noopener");
    setOpened(true);
    toast(ok ? { title: "Proposal copied", description: `Paste it into the bid form on ${host}.` }
      : { title: `Opened ${host}`, description: "Your browser blocked the clipboard — copy the proposal text yourself." });
  };

  const markSent = () => {
    if (!bid) return toast({ title: "Add your price first" });
    if (!msOk) return toast({ title: "Milestones don't add up", description: `They total ${money(msTotal, cur)}; your bid is ${money(bid, cur)}.` });
    saveBid("Applied");
    toast({ title: "Bid tracked", description: "It's on your board under Bid sent.", variant: "success" });
    router.push(`${BASE.gig}/bids`);
  };

  const prepareAuto = () => {
    if (!isPro && bidCredits <= 0) return setPaywall(true);
    if (!bid) return toast({ title: "Add your price first" });
    saveBid("Drafted");
    void auto.prepare();
  };

  return (
    <div className="space-y-5 pb-24 lg:pb-0">
      <Link href={listingHref("gig", listing.id)} className="inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 shrink-0" /> <span className="truncate">{listing.title}</span>
      </Link>

      <header className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-card to-fuchsia-500/10 p-5">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className={cn("size-2 rounded-full", platformDot(listing.source))} /> {listing.source}
          {sent && <span className="rounded-full bg-success/15 px-2 py-0.5 text-success">Bid sent</span>}
        </p>
        <h1 className="mt-2 text-xl font-extrabold leading-tight tracking-tight md:text-2xl">Your bid: {listing.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span><span className="text-muted-foreground">Client budget </span><span className="font-semibold">{budgetLabel ? `${budgetLabel}${unit === "/hr" ? "/hr" : ""}` : "not listed"}</span></span>
          {typeof listing.proposals === "number" && <span><span className="text-muted-foreground">Competing bids </span><span className="font-semibold">{listing.proposals}</span></span>}
          <MatchBar score={listing.matchScore} className="w-44" />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-5">
          <section className="panel space-y-4 p-5">
            <StepHeading n={1} title="Proposal" sub="Lead with the client's problem, show you've done it before, end with a question." />
            <Composer listing={listing} label="Proposal" text={proposal.text} setText={proposal.setText}
              generate={(tone) => void proposal.generate(tone)} generating={proposal.generating}
              save={() => { saveBid("Drafted"); void proposal.save(); }} saving={proposal.saving}
              placeholder="Hi — I've built exactly this kind of …" />
          </section>

          <section className="panel space-y-4 p-5">
            <StepHeading n={2} title="Your price" sub="Bid what the work is worth; the client compares value, not just price." />
            <div className="inline-flex rounded-xl bg-muted p-1 text-sm font-medium">
              {(["fixed", "hourly"] as const).map((r) => (
                <button key={r} onClick={() => setRateType(r)} aria-pressed={rateType === r}
                  className={cn("rounded-lg px-4 py-1.5 transition-colors", rateType === r ? "bg-background shadow-sm" : "text-muted-foreground")}>
                  {r === "fixed" ? "Fixed price" : "Hourly"}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bid-amount">{rateType === "hourly" ? `Hourly rate (${cur})` : `Total price (${cur})`}</Label>
                <Input id="bid-amount" type="number" inputMode="decimal" min={0} step="0.01" value={amount}
                  onChange={(e) => setAmount(e.target.value)} className="h-12 text-lg font-semibold" placeholder="0" />
              </div>
              {rateType === "hourly" && (
                <div className="space-y-1.5">
                  <Label htmlFor="bid-hours">Hours per week (estimate)</Label>
                  <Input id="bid-hours" type="number" inputMode="numeric" min={1} max={80} value={hours}
                    onChange={(e) => setHours(e.target.value)} className="h-12" placeholder="20" />
                </div>
              )}
            </div>
            {budgetNote && (
              <p className={cn("flex items-start gap-1.5 text-xs", budgetNote.tone === "ok" ? "text-success" : "text-warning")}>
                {budgetNote.tone === "ok" ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <AlertTriangle className="mt-px size-3.5 shrink-0" />}
                {budgetNote.text}
              </p>
            )}

            {rateType === "fixed" && (
              <div className="rounded-xl border p-4">
                <label className="flex items-center gap-3">
                  <span className="flex-1">
                    <span className="block text-sm font-medium">Split into milestones</span>
                    <span className="block text-xs text-muted-foreground">Get paid as you deliver, and show the client a clear plan.</span>
                  </span>
                  <Switch checked={useMilestones} onCheckedChange={toggleMilestones} />
                </label>
                {useMilestones && (
                  <div className="mt-4 space-y-2">
                    {milestones.map((m, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{i + 1}</span>
                        <Input value={m.title} placeholder="What you'll deliver" aria-label={`Milestone ${i + 1} title`} className="min-w-0 flex-1"
                          onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                        <Input value={m.amount} type="number" inputMode="decimal" min={0} placeholder="0" aria-label={`Milestone ${i + 1} amount`} className="w-24 shrink-0"
                          onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                        <button aria-label="Remove milestone" className="shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => setMilestones(milestones.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-1">
                      <Button size="sm" variant="ghost" onClick={() => setMilestones([...milestones, { title: "", amount: "" }])}><Plus /> Add milestone</Button>
                      <p className={cn("text-xs tabular-nums", msOk ? "text-success" : "text-warning")}>
                        {money(msTotal, cur) || "0"} of {money(bid, cur) || "your price"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="panel space-y-4 p-5">
            <StepHeading n={3} title="Delivery time" sub="Be realistic — late delivery costs more than a longer estimate." />
            <div className="flex flex-wrap gap-1.5">
              {DELIVERY.map((d) => (
                <button key={d} onClick={() => setDelivery(d)} aria-pressed={delivery === d}
                  className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors",
                    delivery === d ? "border-primary bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:border-primary/40")}>
                  {d < 7 ? `${d} day${d === 1 ? "" : "s"}` : d === 7 ? "1 week" : d % 7 === 0 ? `${d / 7} weeks` : `${d} days`}
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside>
          <div className="space-y-4 lg:sticky lg:top-0">
            <section className="panel space-y-4 p-5">
              <p className="text-sm font-semibold">Bid summary</p>
              <dl className="space-y-2 text-sm">
                <Row k={rateType === "hourly" ? "Rate" : "Price"} v={bid ? `${money(bid, cur)}${rateType === "hourly" ? "/hr" : ""}` : "—"} strong />
                {rateType === "hourly" && hours && <Row k="Est. weekly" v={money(bid * Number(hours), cur) || "—"} />}
                {useMilestones && <Row k="Milestones" v={`${milestones.length}`} />}
                <Row k="Delivery" v={<span className="flex items-center gap-1"><CalendarClock className="size-3.5" /> {delivery} day{delivery === 1 ? "" : "s"}</span>} />
                <Row k="Proposal" v={proposal.text.trim() ? `${proposal.text.trim().split(/\s+/).length} words` : "not written"} />
              </dl>
              <div className="space-y-2">
                <Button variant="gradient" className="w-full" onClick={() => void copyAndOpen()} disabled={!proposal.text.trim() || !bid}>
                  <ClipboardCopy /> Copy &amp; open {host}
                </Button>
                <Button variant={opened ? "default" : "outline"} className="w-full" onClick={markSent}>
                  <Send /> I&apos;ve sent it — track my bid
                </Button>
              </div>
              <button onClick={() => !isPro && setPaywall(true)} disabled={isPro}
                className="flex w-full items-center gap-2 rounded-xl bg-muted/50 p-2.5 text-left text-xs">
                {isPro ? <Crown className="size-4 text-warning" /> : <Zap className="size-4 text-primary" />}
                <span className="flex-1">{isPro ? "Pro — unlimited bids" : <><span className="font-semibold">{bidCredits}</span> bid credit{bidCredits === 1 ? "" : "s"} left</>}</span>
                {!isPro && <span className="font-medium text-primary">Top up</span>}
              </button>
              <p className="text-[11px] text-muted-foreground">Sending it yourself is always free. A credit is spent only when auto-apply actually submits the bid for you.</p>
            </section>

            <AutoApplyPanel job={auto.job} busy={auto.busy} onPrepare={prepareAuto} onApprove={() => void auto.approve()}
              onCancel={() => void auto.cancel()} disabled={!proposal.text.trim()}
              note="Autopilot fills the bid form for you and stops before submitting. Without a connected browser worker it runs as a labelled simulation and sends nothing." />
          </div>
        </aside>
      </div>

      {/* Phone action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-card/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">Your bid</p>
            <p className="truncate font-bold">{bid ? `${money(bid, cur)}${rateType === "hourly" ? "/hr" : ""}` : "Set a price"}</p>
          </div>
          <Button variant="gradient" onClick={() => (opened ? markSent() : void copyAndOpen())} disabled={!proposal.text.trim() || !bid}>
            {opened ? <><Gavel /> Track bid</> : <><ExternalLink /> Copy &amp; open</>}
          </Button>
        </div>
      </div>

      <PaywallDialog open={paywall} onOpenChange={(v) => { setPaywall(v); if (!v) auto.setOutOfCredits(false); }} kind="bids" />
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("text-right", strong && "text-lg font-bold")}>{v}</dd>
    </div>
  );
}
