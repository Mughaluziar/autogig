"use client";
import * as React from "react";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { newIdempotencyKey, pct, toCents, usd } from "@/lib/capital";
import { AGREEMENT_LABELS, APP_LABELS, useCredit, type CreditAgreement, type CreditApplication, type CreditOverview } from "@/lib/credit";
import { Gate, SimNotice, Stat, dateOnly } from "@/components/credit/common";

type Detail = { detail?: string };
const message = (res: { data?: unknown } | null) => (res?.data as Detail | undefined)?.detail || "Can't reach the server.";

export function CreditBorrower({ verifyHref }: { verifyHref: string }) {
  const { overview, applications, agreements, loaded, denied, refresh } = useCredit({ borrower: true });
  return (
    <Gate loaded={loaded} denied={denied}>
      {overview && (
        <div className="space-y-6">
          <SimNotice>Credit offers here are examples reviewed by hand. Repayments are records in a demo ledger.</SimNotice>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Open applications" value={applications.filter((a) => a.status === "submitted" || a.status === "offered").length} />
            <Stat label="Active agreements" value={agreements.filter((a) => a.status === "active" || a.status === "late").length} />
            <Stat label="Still owed (simulated)" value={usd(agreements.filter((a) => a.status === "active" || a.status === "late").reduce((s, a) => s + a.openCents, 0))} />
          </div>
          <ApplyCard overview={overview} applications={applications} agreements={agreements} verifyHref={verifyHref} onDone={refresh} />
          <ApplicationList apps={applications} onChanged={refresh} />
          <AgreementList agreements={agreements} onChanged={refresh} />
        </div>
      )}
    </Gate>
  );
}

function ApplyCard({ overview, applications, agreements, verifyHref, onDone }: {
  overview: CreditOverview; applications: CreditApplication[]; agreements: CreditAgreement[]; verifyHref: string; onDone: () => void;
}) {
  const { toast } = useToast();
  const { limits, eligibility } = overview;
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [installments, setInstallments] = React.useState("3");
  const [docs, setDocs] = React.useState<{ label: string; url: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const cents = toCents(amount);
  const open = applications.some((a) => a.status === "submitted" || a.status === "offered") || agreements.some((a) => a.status === "active" || a.status === "late");
  const rangeOk = cents != null && cents >= limits.minRequestCents && cents <= limits.maxRequestCents;
  const docsOk = docs.every((d) => d.label.trim() && /^https:\/\/\S+$/.test(d.url.trim()));
  const valid = title.trim().length >= 3 && description.trim().length >= 20 && rangeOk && docsOk;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiCall<Detail>("/api/credit/applications", {
      title: title.trim(), description: description.trim(), requestedCents: cents, installments: Number(installments),
      documents: docs.map((d) => ({ label: d.label.trim(), url: d.url.trim() })),
    });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Application not sent", description: message(res) });
    toast({ title: "Application sent for review (simulated)", variant: "success" });
    setTitle(""); setDescription(""); setAmount(""); setDocs([]);
    onDone();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Request project credit</CardTitle>
        <CardDescription>
          Describe the project you need to start. The platform owner reviews it, assigns a risk grade and may make an offer.
          Between {usd(limits.minRequestCents)} and {usd(limits.maxRequestCents)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {eligibility.reasons.length > 0 ? (
          <div role="status" className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
            {eligibility.reasons.map((r) => <p key={r}>{r}</p>)}
            <Link className="font-medium text-primary underline-offset-4 hover:underline" href={verifyHref}>Open verification</Link>
          </div>
        ) : open ? (
          <p className="text-sm text-muted-foreground">You already have an open application or an unpaid agreement. Finish it before applying again.</p>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="Credit application">
            <div className="space-y-1.5">
              <Label htmlFor="credit-title">Project title</Label>
              <Input id="credit-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-desc">What you will deliver and what the money is for</Label>
              <Textarea id="credit-desc" rows={4} value={description} maxLength={3000} onChange={(e) => setDescription(e.target.value)} required aria-describedby="credit-desc-hint" />
              <p id="credit-desc-hint" className="text-xs text-muted-foreground">At least 20 characters. Do not paste passwords, ID numbers or bank details.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="credit-amount">Amount requested (USD)</Label>
                <Input id="credit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,000.00" required aria-invalid={amount !== "" && !rangeOk} />
                {amount !== "" && !rangeOk && <p role="alert" className="text-xs text-destructive">Enter an amount between {usd(limits.minRequestCents)} and {usd(limits.maxRequestCents)}.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="credit-installments">Preferred installments</Label>
                <Select id="credit-installments" value={installments} onChange={(e) => setInstallments(e.target.value)}>
                  {Array.from({ length: limits.maxInstallments }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} × every {limits.installmentDays} days</option>)}
                </Select>
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Supporting documents (links, optional)</legend>
              <p className="text-xs text-muted-foreground">This prototype stores links, not files. Use an https link you control (a signed brief, a contract, a portfolio).</p>
              {docs.map((d, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                  <Input aria-label={`Document ${i + 1} label`} placeholder="Label" value={d.label} maxLength={80} onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                  <Input aria-label={`Document ${i + 1} link`} placeholder="https://…" value={d.url} maxLength={500} onChange={(e) => setDocs(docs.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove document ${i + 1}`} onClick={() => setDocs(docs.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              ))}
              {docs.length < 5 && <Button type="button" variant="outline" size="sm" onClick={() => setDocs([...docs, { label: "", url: "" }])}><Plus /> Add a link</Button>}
              {!docsOk && <p role="alert" className="text-xs text-destructive">Each link needs a label and must start with https://</p>}
            </fieldset>
            <Button type="submit" disabled={busy || !valid}>{busy && <Loader2 className="animate-spin" />} Send application</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ApplicationList({ apps, onChanged }: { apps: CreditApplication[]; onChanged: () => void }) {
  const [offerFor, setOfferFor] = React.useState<CreditApplication | null>(null);
  const { toast } = useToast();
  const act = async (id: string, action: "reject" | "withdraw") => {
    const res = await apiCall<Detail>(`/api/credit/applications/${encodeURIComponent(id)}/${action}`);
    if (!res || res.status >= 400) return toast({ title: "Not done", description: message(res) });
    onChanged();
  };
  return (
    <>
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Your applications</CardTitle></CardHeader>
      <CardContent>
        {apps.length === 0 ? <p className="text-sm text-muted-foreground">No applications yet.</p> : (
          <ul className="divide-y">
            {apps.map((a) => {
              const label = APP_LABELS[a.status];
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.title}</p>
                    <p className="text-muted-foreground">Requested {usd(a.requestedCents)} · {dateOnly(a.createdAt)}</p>
                    {a.status === "declined" && a.decision?.note && <p className="text-muted-foreground">Reviewer note: {a.decision.note}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={label.variant}>{label.label}</Badge>
                    {a.status === "offered" && <Button size="sm" onClick={() => setOfferFor(a)}>View offer</Button>}
                    {(a.status === "submitted" || a.status === "offered") && <Button size="sm" variant="ghost" onClick={() => void act(a.id, "withdraw")}>Withdraw</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
    {/* Outside the Card: its backdrop blur would otherwise become the containing block of the fixed dialog. */}
    {offerFor && <OfferDialog app={offerFor} onClose={() => setOfferFor(null)} onDone={() => { setOfferFor(null); onChanged(); }} onReject={() => { void act(offerFor.id, "reject"); setOfferFor(null); }} />}
    </>
  );
}

function OfferDialog({ app, onClose, onDone, onReject }: { app: CreditApplication; onClose: () => void; onDone: () => void; onReject: () => void }) {
  const { toast } = useToast();
  const [agree, setAgree] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const o = app.offer!;
  const accept = async () => {
    setBusy(true);
    const res = await apiCall<Detail>(`/api/credit/applications/${encodeURIComponent(app.id)}/accept`, { acceptTerms: agree });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Offer not accepted", description: message(res) });
    toast({ title: "Offer accepted (simulated)", description: "No real money moved. Your repayment schedule is below.", variant: "success" });
    onDone();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Credit offer</DialogTitle>
        <DialogDescription>{app.title} · valid until {dateOnly(o.expiresAt)}</DialogDescription>
      </DialogHeader>
      <dl className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm">
        <dt className="text-muted-foreground">Offered (simulated)</dt><dd className="text-right font-medium">{usd(o.principalCents)}</dd>
        <dt className="text-muted-foreground">Risk grade</dt><dd className="text-right">{o.grade}</dd>
        <dt className="text-muted-foreground">Flat fee ({pct(o.feeBps)})</dt><dd className="text-right">{usd(o.feeTotalCents)}</dd>
        <dt className="text-muted-foreground">Total to repay</dt><dd className="text-right font-semibold">{usd(o.totalRepayableCents)}</dd>
        <dt className="text-muted-foreground">Installments</dt><dd className="text-right">{o.installments} × every {o.installmentDays} days</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        The fee is a flat amount, not an annual rate. Missing a due date marks the agreement late; 60 days after a missed installment it
        is recorded as a default and the unpaid principal is written off in the demo ledger. This is a simulation: nothing is lent.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={agree} onCheckedChange={setAgree} className="mt-0.5" />
        I understand this is a simulation and agree to repay {usd(o.totalRepayableCents)} in the demo ledger.
      </label>
      <DialogFooter>
        <Button variant="ghost" onClick={onReject}>Reject offer</Button>
        <Button disabled={busy || !agree} onClick={() => void accept()}>{busy && <Loader2 className="animate-spin" />} Accept offer</Button>
      </DialogFooter>
    </Dialog>
  );
}

function AgreementList({ agreements, onChanged }: { agreements: CreditAgreement[]; onChanged: () => void }) {
  const [repaying, setRepaying] = React.useState<CreditAgreement | null>(null);
  return (
    <>
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Agreements and repayments</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {agreements.length === 0 ? <p className="text-sm text-muted-foreground">No agreements yet.</p> : agreements.map((a) => {
          const label = AGREEMENT_LABELS[a.status];
          const open = a.status === "active" || a.status === "late";
          return (
            <div key={a.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-muted-foreground">{usd(a.principalCents)} + {usd(a.feeTotalCents)} fee · still owed {usd(a.openCents)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={label.variant}>{label.label}</Badge>
                  {open && <Button size="sm" onClick={() => setRepaying(a)}>Record repayment</Button>}
                </div>
              </div>
              {a.status === "defaulted" && <p className="mt-2 text-destructive">Defaulted: {usd(a.writtenOffCents)} of principal was written off in the demo ledger.</p>}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-xs">
                  <caption className="sr-only">Repayment schedule</caption>
                  <thead className="text-muted-foreground"><tr><th scope="col" className="py-1">#</th><th scope="col">Due</th><th scope="col" className="text-right">Principal</th><th scope="col" className="text-right">Fee</th><th scope="col" className="text-right">Left</th></tr></thead>
                  <tbody>
                    {a.schedule.map((i) => {
                      const left = i.principalCents + i.feeCents - i.principalPaidCents - i.feePaidCents;
                      return (
                        <tr key={i.n} className="border-t">
                          <td className="py-1">{i.n}</td><td>{dateOnly(i.dueAt)}</td>
                          <td className="text-right tabular-nums">{usd(i.principalCents)}</td><td className="text-right tabular-nums">{usd(i.feeCents)}</td>
                          <td className="text-right tabular-nums">{left === 0 ? "Paid" : usd(left)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
    {repaying && <RepayDialog agreement={repaying} onClose={() => setRepaying(null)} onDone={() => { setRepaying(null); onChanged(); }} />}
    </>
  );
}

function RepayDialog({ agreement, onClose, onDone }: { agreement: CreditAgreement; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = React.useState((agreement.openCents / 100).toFixed(2));
  const [busy, setBusy] = React.useState(false);
  const [key] = React.useState(newIdempotencyKey);      // one key per dialog: a double click cannot pay twice
  const cents = toCents(amount);
  const ok = cents != null && cents <= agreement.openCents;
  const go = async () => {
    setBusy(true);
    const res = await apiCall<Detail & { status?: string }>(`/api/credit/agreements/${encodeURIComponent(agreement.id)}/repay`, { amountCents: cents, idempotencyKey: key });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Repayment not recorded", description: message(res) });
    toast({ title: res.data.status === "repaid" ? "Fully repaid (simulated)" : "Repayment recorded (simulated)", variant: "success" });
    onDone();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Record a repayment</DialogTitle>
        <DialogDescription>{agreement.title} · {usd(agreement.openCents)} left. This records an entry in the demo ledger; no real payment is made.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="credit-repay">Amount (USD)</Label>
        <Input id="credit-repay" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!ok} />
        <p className="text-xs text-muted-foreground">Payments go to the oldest installment first, fee before principal.</p>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !ok} onClick={() => void go()}>{busy && <Loader2 className="animate-spin" />} Record repayment</Button>
      </DialogFooter>
    </Dialog>
  );
}
