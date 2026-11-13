"use client";
import * as React from "react";
import { CheckCircle2, Circle, Download, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { apiCall, apiFetch, apiGet } from "@/lib/api";
import { explorerLink, formatTokens, formatUsdc, shortAddress, type Proposal, type TokenAdmin } from "@/lib/token";
import { formatRelative } from "@/lib/utils";

type Detail = { detail?: string; reasons?: string[] };

/** Platform owners: launch gate, chain sync and reconciliation, Safe proposals, alerts. */
export function TokenAdminPanel() {
  const { toast } = useToast();
  const [data, setData] = React.useState<TokenAdmin | null>(null);
  const [tick, setTick] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [evidence, setEvidence] = React.useState<Record<string, string>>({});
  const [notes, setNotes] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let cancelled = false;
    void apiGet<TokenAdmin>("/api/token/admin/overview").then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [tick]);
  const reload = () => setTick((t) => t + 1);

  const post = async (key: string, path: string, body: unknown, ok: string) => {
    setBusy(key);
    const res = await apiCall<Detail>(path, body);
    setBusy(null);
    if (!res || res.status >= 400) {
      toast({ title: "Not saved", description: [res?.data?.detail, ...(res?.data?.reasons ?? [])].filter(Boolean).join(" ") || "Can't reach the server." });
      return false;
    }
    toast({ title: ok, variant: "success" });
    reload();
    return true;
  };

  const download = async (p: Proposal) => {
    const res = await apiFetch(`/api/token/admin/proposals/${encodeURIComponent(p.id)}/safe-batch`);
    if (!res.ok) return toast({ title: "Download failed" });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `safe-batch-${p.kind}-${p.id.slice(0, 8)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!data) return <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>;
  const rec = data.reconcile;
  const addressRows = Object.entries(data.addresses) as [string, string | null][];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2 pb-2">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Token program <Badge variant={data.enabled ? "default" : "secondary"}>{data.enabled ? "On" : "Off"}</Badge>
              <Badge variant={data.chain.mainnet ? "destructive" : "warning"}>{data.chain.name}</Badge>
            </CardTitle>
            <CardDescription>
              Reads the chain every 5–10 minutes when the worker runs ({data.confirmations} confirmations). The server holds
              no keys: every on-chain change below is a Safe proposal your signers review and execute.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={busy === "sync" || !data.enabled}
            onClick={() => void post("sync", "/api/token/admin/sync", {}, "Synced")}>
            {busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.missingConfig.length > 0 && (
            <p className="text-destructive">Missing settings: {data.missingConfig.join(", ")}</p>
          )}
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {addressRows.map(([k, v]) => {
              const href = v ? explorerLink(data.chain, "address", v) : null;
              return (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono">{href ? <a className="text-primary" href={href} target="_blank" rel="noreferrer">{shortAddress(v)}</a> : shortAddress(v)}</dd>
                </div>
              );
            })}
          </dl>
          <p className="text-xs text-muted-foreground">
            Indexed to block {data.cursor?.block ?? "—"}{data.cursor && ` · ${formatRelative(data.cursor.at)}`} · lock-up {data.lockupDays} days
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {rec?.ok ? <ShieldCheck className="size-4 text-success" /> : <ShieldAlert className="size-4 text-warning" />} Reconciliation
          </CardTitle>
          <CardDescription>On-chain supply and every mirrored wallet balance must equal the ledger. Any difference pauses new subscriptions.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {!rec ? <p className="text-muted-foreground">Not run yet.</p> : (
            <div className="space-y-2">
              <p>
                <Badge variant={rec.ok ? "success" : "destructive"}>{rec.ok ? "Matches" : "Mismatch"}</Badge>{" "}
                at block {rec.block} · on-chain {formatTokens(rec.onchainSupply / 1e6)} · ledger {formatTokens(rec.ledgerSupply / 1e6)} tokens ·
                Safe holds {formatUsdc(rec.safeUsdcUnits)} USDC
              </p>
              {rec.unreconciled !== 0 && <p className="text-destructive">Unexpected mints/burns: {formatTokens(rec.unreconciled / 1e6)} tokens (see alerts).</p>}
              {rec.mismatches.map((m) => (
                <p key={m.address} className="font-mono text-xs text-destructive">{m.address}: ledger {m.ledger} vs chain {m.onchain}</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Safe proposals ({data.proposals.length})</CardTitle>
          <CardDescription>
            Download a batch and load it in the Safe app (Apps → Transaction Builder). Check each call before signing. The sync
            marks a proposal executed once its effect shows on-chain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.proposals.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting.</p> : (
            <ul className="divide-y">
              {data.proposals.map((p) => (
                <li key={p.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{p.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.transactions.map((t) => t.description).join(" + ")} · {formatRelative(p.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void download(p)}><Download /> Safe batch</Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null}
                      onClick={() => void post(p.id, `/api/token/admin/proposals/${encodeURIComponent(p.id)}`, { action: "rejected" }, "Rejected")}>
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Alerts ({data.alerts.length})</CardTitle>
          <CardDescription>Payments that matched no subscription, and mints or burns the platform didn&apos;t expect.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.alerts.length === 0 ? <p className="text-sm text-muted-foreground">No open alerts.</p> : (
            <ul className="divide-y">
              {data.alerts.map((a) => (
                <li key={a.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex items-center gap-2"><Badge variant="warning">{a.kind.replace(/_/g, " ")}</Badge> {formatRelative(a.createdAt)}</p>
                    <p className="mt-1 text-muted-foreground">{a.detail}</p>
                  </div>
                  <Input className="lg:max-w-56" placeholder="What you did (required)" value={notes[a.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} />
                  <Button size="sm" disabled={busy !== null || (notes[a.id] ?? "").trim().length < 3}
                    onClick={() => void post(a.id, `/api/token/admin/alerts/${encodeURIComponent(a.id)}/resolve`, { note: notes[a.id] }, "Resolved")}>
                    Resolve
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Launch gate <Badge variant={data.gate.passed ? "success" : "warning"}>{data.gate.items.filter((i) => i.done).length}/{data.gate.items.length}</Badge>
            <Badge variant={data.gate.mainnetEnabled ? "destructive" : "secondary"}>TOKEN_MAINNET_ENABLED={String(data.gate.mainnetEnabled)}</Badge>
          </CardTitle>
          <CardDescription>
            Mainnet stays closed until every item is recorded with evidence and the mainnet switch is on. Record only decisions
            that have actually been made by counsel, auditors or the signers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {data.gate.items.map((item) => (
              <li key={item.key} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    {item.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />} {item.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                  {item.done && <p className="mt-1 text-xs">Evidence: {item.evidence} · {item.recordedBy} · {formatRelative(item.recordedAt)}</p>}
                </div>
                {item.done ? (
                  <Button size="sm" variant="ghost" disabled={busy !== null}
                    onClick={() => void post(item.key, `/api/token/admin/gate/${item.key}`, { done: false, evidence: "" }, "Reopened")}>
                    Reopen
                  </Button>
                ) : (
                  <>
                    <Input className="lg:max-w-72" placeholder="Evidence: document, report link, decision" value={evidence[item.key] ?? ""}
                      onChange={(e) => setEvidence((v) => ({ ...v, [item.key]: e.target.value }))} />
                    <Button size="sm" disabled={busy !== null || (evidence[item.key] ?? "").trim().length < 10}
                      onClick={() => void post(item.key, `/api/token/admin/gate/${item.key}`, { done: true, evidence: evidence[item.key] }, "Recorded")}>
                      Record
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
