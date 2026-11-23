"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import { pct, toCents, usd } from "@/lib/capital";
import { AGREEMENT_LABELS, APP_LABELS, documentUrl, useCredit, type CreditApplication } from "@/lib/credit";
import { apiUrl } from "@/lib/api";
import { Gate, SimNotice, Stat, dateOnly } from "@/components/credit/common";

type Detail = { detail?: string };

export function CreditAdmin() {
  const { treasury: t, adminApps, adminAgreements, audit, loaded, denied, failed, refresh } = useCredit({ admin: true });
  const { toast } = useToast();
  const [reviewing, setReviewing] = React.useState<CreditApplication | null>(null);
  const [busy, setBusy] = React.useState(false);
  const runJobs = async () => {
    setBusy(true);
    const res = await apiCall<Detail & Record<string, number>>("/api/credit/admin/run-jobs");
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Jobs did not run", description: res?.data?.detail ?? "Can't reach the server." });
    toast({ title: "Jobs finished", description: `${res.data.late} late, ${res.data.defaulted} defaulted, ${res.data.expiredOffers} offers expired.`, variant: "success" });
    refresh();
  };
  return (
    <Gate loaded={loaded} denied={denied} failed={failed} retry={refresh}>
      {t && (
        <div className="space-y-6">
          <SimNotice>Treasury figures are demo-ledger balances. They are kept apart from any real company account and must never be reported as real funds.</SimNotice>
          <section aria-label="Treasury" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Contributions" value={usd(t.contributionsCents)} />
            <Stat label="Available" value={usd(t.availableCents)} hint={`${usd(t.committedCents)} committed to open offers`} />
            <Stat label="Outstanding credit" value={usd(t.outstandingCents)} hint={`${t.agreements?.active ?? 0} active · ${t.agreements?.late ?? 0} late`} />
            <Stat label="Repayments received" value={usd(t.repaymentsCents)} />
            <Stat label="Fees" value={usd(t.feesCents)} />
            <Stat label="Defaults and losses" value={usd(t.lossesCents)} tone={t.lossesCents > 0 ? "bad" : undefined} hint={`${t.agreements?.defaulted ?? 0} defaulted`} />
            <Stat label="Disbursed in total" value={usd(t.disbursedCents)} />
            <Stat label="Ledger check" value={t.ledgerCheck ? "Balanced" : "MISMATCH"} tone={t.ledgerCheck ? "good" : "bad"} hint="Cash and credit agree with the journal" />
          </section>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void runJobs()}>{busy && <Loader2 className="animate-spin" />} Run late / default checks</Button>
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Applications</CardTitle><CardDescription>Review, assign a risk grade, and make an offer or decline. You cannot review your own.</CardDescription></CardHeader>
            <CardContent>
              {adminApps.length === 0 ? <p className="text-sm text-muted-foreground">No applications yet.</p> : (
                <ul className="divide-y">
                  {adminApps.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{a.title}</p>
                        <p className="text-muted-foreground">{a.applicantName || a.applicantEmail} · {usd(a.requestedCents)} · {dateOnly(a.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={APP_LABELS[a.status].variant}>{APP_LABELS[a.status].label}</Badge>
                        {a.status === "submitted" && <Button size="sm" onClick={() => setReviewing(a)}>Review</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Agreements</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              {adminAgreements.length === 0 ? <p className="text-sm text-muted-foreground">No agreements yet.</p> : (
                <table className="w-full min-w-[520px] text-left text-sm">
                  <caption className="sr-only">Credit agreements</caption>
                  <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="py-1">Project</th><th scope="col">Grade</th><th scope="col" className="text-right">Principal</th><th scope="col" className="text-right">Owed</th><th scope="col">Status</th></tr></thead>
                  <tbody>{adminAgreements.map((a) => (
                    <tr key={a.id} className="border-t"><td className="py-1.5">{a.title}</td><td>{a.grade}</td><td className="text-right tabular-nums">{usd(a.principalCents)}</td><td className="text-right tabular-nums">{usd(a.openCents)}</td>
                      <td><Badge variant={AGREEMENT_LABELS[a.status].variant}>{AGREEMENT_LABELS[a.status].label}</Badge></td></tr>
                  ))}</tbody>
                </table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Audit history</CardTitle><CardDescription>Append-only. Newest first.</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              {audit.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
                <table className="w-full min-w-[520px] text-left text-xs">
                  <caption className="sr-only">Audit history</caption>
                  <thead className="text-muted-foreground"><tr><th scope="col" className="py-1">When</th><th scope="col">Action</th><th scope="col">Role</th><th scope="col">Subject</th></tr></thead>
                  <tbody>{audit.slice(0, 60).map((r) => (
                    <tr key={r.id} className="border-t"><td className="py-1">{new Date(r.createdAt).toLocaleString()}</td><td>{r.action.replace(/_/g, " ")}</td><td>{r.actorRole}</td><td className="font-mono">{r.subjectId.slice(0, 8)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </CardContent>
          </Card>
          {reviewing && <ReviewDialog app={reviewing} available={t.availableCents} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); refresh(); }} />}
        </div>
      )}
    </Gate>
  );
}

function ReviewDialog({ app, available, onClose, onDone }: { app: CreditApplication; available: number; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [grade, setGrade] = React.useState("B");
  const [fee, setFee] = React.useState("10");
  const [installments, setInstallments] = React.useState(String(app.preferredInstallments));
  const [amount, setAmount] = React.useState((Math.min(app.requestedCents, available) / 100).toFixed(2));
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const cents = toCents(amount);
  const feePct = Number(fee);
  const feeBps = Math.round(feePct * 100);
  const valid = cents != null && cents <= Math.min(app.requestedCents, available) && Number.isFinite(feePct) && feeBps >= 100 && feeBps <= 2000;
  const decide = async (approve: boolean) => {
    setBusy(true);
    const res = await apiCall<Detail>(`/api/credit/admin/applications/${encodeURIComponent(app.id)}/decision`,
      approve ? { approve, grade, feeBps, installments: Number(installments), principalCents: cents, note } : { approve, note });
    setBusy(false);
    if (!res || res.status >= 400) return toast({ title: "Decision not saved", description: res?.data?.detail ?? "Can't reach the server." });
    toast({ title: approve ? "Offer sent (simulated)" : "Application declined", variant: "success" });
    onDone();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Review application</DialogTitle>
        <DialogDescription>{app.title} · requested {usd(app.requestedCents)} · {usd(available)} available in the demo pool</DialogDescription>
      </DialogHeader>
      <div className="max-h-[50vh] space-y-3 overflow-y-auto text-sm">
        <p className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3">{app.description}</p>
        {app.documents.length > 0 && (
          <div>
            <p className="mb-1 font-medium">Private documents</p>
            <ul className="list-disc pl-5">{app.documents.map((d) => <li key={d.id}>{d.label} ({d.ext.toUpperCase()}, {Math.max(1, Math.round(d.size / 1024))} KB){" "}
              <a className="text-primary underline" href={apiUrl(documentUrl(d.id))} download>Download</a></li>)}</ul>
            <p className="mt-1 text-xs text-muted-foreground">Files are not scanned for malware in this prototype: open them only in a sandboxed viewer. Each download is logged.</p>
          </div>
        )}
        <p className="text-muted-foreground">
          Verification: {app.signals?.kycStatus} · repaid before: {app.signals?.agreementsRepaid} · defaulted before: {app.signals?.agreementsDefaulted} · open now: {app.signals?.agreementsOpen}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="rv-amount">Offer amount (USD)</Label><Input id="rv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="rv-fee">Flat fee (%)</Label><Input id="rv-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
            {cents != null && valid && <p className="text-xs text-muted-foreground">Fee {usd(Math.floor(cents * feeBps / 10000))} ({pct(feeBps)})</p>}</div>
          <div className="space-y-1.5"><Label htmlFor="rv-grade">Risk grade</Label><Select id="rv-grade" value={grade} onChange={(e) => setGrade(e.target.value)}>{"ABCDE".split("").map((g) => <option key={g}>{g}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="rv-inst">Installments</Label><Select id="rv-inst" value={installments} onChange={(e) => setInstallments(e.target.value)}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</Select></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="rv-note">Note (kept in the record)</Label><Textarea id="rv-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>Decline</Button>
        <Button disabled={busy || !valid} onClick={() => void decide(true)}>{busy && <Loader2 className="animate-spin" />} Send offer</Button>
      </DialogFooter>
    </Dialog>
  );
}
