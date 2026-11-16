"use client";
import * as React from "react";
import { Loader2, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { apiCall, apiGet } from "@/lib/api";
import { usd, type CapitalProfile, type Claim } from "@/lib/capital";
import { formatRelative } from "@/lib/utils";

type PendingProfile = CapitalProfile & { userId: string };
type Journal = { balances: { USD?: Record<string, number> }; entries: { seq: number; kind: string; memo: string; at: string; settlement: string }[] };
type Detail = { detail?: string };

/** Platform owners: review identities and claims, run jobs, inspect the ledger. */
export function OperatorPanel({ onChanged }: { onChanged: () => void }) {
  const { toast } = useToast();
  const [profiles, setProfiles] = React.useState<PendingProfile[]>([]);
  const [claims, setClaims] = React.useState<Claim[]>([]);
  const [journal, setJournal] = React.useState<Journal | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiGet<PendingProfile[]>("/api/capital/admin/verifications"),
      apiGet<Claim[]>("/api/capital/admin/claims"),
      apiGet<Journal>("/api/capital/admin/journal?limit=30"),
    ]).then(([p, c, j]) => {
      if (cancelled) return;
      setProfiles(p ?? []);
      setClaims(c ?? []);
      setJournal(j);
    });
    return () => { cancelled = true; };
  }, [tick]);

  const review = async (kind: "verifications" | "claims", id: string, approve: boolean) => {
    setBusy(`${kind}:${id}`);
    const res = await apiCall<Detail>(`/api/capital/admin/${kind}/${encodeURIComponent(id)}`, { approve, note: notes[id] ?? "" });
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Review not saved", description: res?.data?.detail ?? "Can't reach the server." });
    toast({ title: approve ? "Approved" : "Rejected", variant: approve ? "success" : undefined });
    setTick((t) => t + 1);
    onChanged();
  };

  const runJobs = async () => {
    setBusy("jobs");
    const res = await apiCall<Record<string, number>>("/api/capital/admin/run-jobs", {});
    setBusy(null);
    if (!res || res.status >= 400) return toast({ title: "Jobs failed" });
    toast({ title: "Jobs run", description: Object.entries(res.data).map(([k, v]) => `${k}: ${v}`).join(", ") });
    setTick((t) => t + 1);
    onChanged();
  };

  const usdBalances = Object.entries(journal?.balances.USD ?? {}).filter(([, v]) => v !== 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-base">Scheduled jobs</CardTitle>
            <CardDescription>Ages early payments, opens claims on platform-reported losses, expires quotes and cover, and finishes interrupted ledger steps. Runs every 15 minutes when the worker is configured.</CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={busy === "jobs"} onClick={() => void runJobs()}>
            {busy === "jobs" ? <Loader2 className="animate-spin" /> : <Play />} Run now
          </Button>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Identity reviews ({profiles.length})</CardTitle>
          <CardDescription>Operator review stands in for a regulated identity provider while settlement is simulated.</CardDescription>
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to review.</p> : (
            <ul className="divide-y">
              {profiles.map((p) => (
                <li key={p.userId} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{p.kyc.legalName} · {p.kyc.country}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.roles.join(" & ")}{p.investor.accredited && ` · accredited (${p.investor.basis})`} · submitted {formatRelative(p.kyc.submittedAt)}
                    </p>
                  </div>
                  <Input className="lg:max-w-56" placeholder="Note (optional)" value={notes[p.userId] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [p.userId]: e.target.value }))} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy !== null} onClick={() => void review("verifications", p.userId, true)}>Approve</Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void review("verifications", p.userId, false)}>Reject</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Protection claims ({claims.length})</CardTitle>
          <CardDescription>Approval re-checks the platform-reported loss and pays up to the fund&apos;s balance.</CardDescription>
        </CardHeader>
        <CardContent>
          {claims.length === 0 ? <p className="text-sm text-muted-foreground">No open claims.</p> : (
            <ul className="divide-y">
              {claims.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {c.orderTitle ?? c.orderId} <Badge variant="warning">{c.status}</Badge> <span>{usd(c.amountCents)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{c.platform} · {c.kind === "advance" ? "early payment" : "standalone"} · {c.reason}</p>
                  </div>
                  <Input className="lg:max-w-56" placeholder="Note (optional)" value={notes[c.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy !== null || c.status !== "eligible"} onClick={() => void review("claims", c.id, true)}>Approve & pay</Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void review("claims", c.id, false)}>Deny</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ledger</CardTitle>
          <CardDescription>Double-entry and append-only. Every entry is marked simulated.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <dl className="space-y-1 text-sm">
            {usdBalances.map(([account, cents]) => (
              <div key={account} className="flex justify-between gap-2"><dt className="font-mono text-xs">{account}</dt><dd className="tabular-nums">{usd(cents)}</dd></div>
            ))}
          </dl>
          <ol className="space-y-1 text-xs">
            {(journal?.entries ?? []).map((e) => (
              <li key={e.seq} className="flex gap-2"><span className="font-mono text-muted-foreground">#{e.seq}</span><span className="min-w-0 flex-1 truncate">{e.memo}</span><span className="text-muted-foreground">{formatRelative(e.at)}</span></li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
