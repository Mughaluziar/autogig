"use client";
import * as React from "react";
import { AlertTriangle, Loader2, Plug, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { API_URL, apiCall, apiGet } from "@/lib/api";
import { startUpworkConnect, takeUpworkReturn, type UpworkConnections as Report } from "@/lib/upwork";
import { formatRelative } from "@/lib/utils";

/**
 * The user's Upwork accounts, connected directly over OAuth. Job search uses
 * the newest active one; order tracking adds accounts from the Orders page.
 */
export function UpworkConnections() {
  const { toast } = useToast();
  const [report, setReport] = React.useState<Report | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await apiGet<Report>("/api/upwork/connections");
    if (res) setReport(res);
  }, []);

  React.useEffect(() => {
    if (!API_URL) return;
    const back = takeUpworkReturn();
    if (back) {
      toast(back.ok
        ? { title: "Upwork connected", description: "Job search now uses this account. Add it on the Orders page to track its orders.", variant: "success" }
        : { title: "Upwork not connected", description: back.message });
    }
    void load();
  }, [load, toast]);

  if (!API_URL || !report) return null;
  const { canConnect, reason, connections } = report;
  if (!canConnect && connections.length === 0) {
    return (
      <Card className="mt-6">
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <Plug className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div><p className="font-medium">Upwork</p><p className="text-muted-foreground">{reason ?? "Upwork connections aren't available yet."}</p></div>
        </CardContent>
      </Card>
    );
  }

  const connect = async () => {
    setBusy("new");
    const error = await startUpworkConnect("/dashboard/accounts");
    setBusy(null);
    toast({ title: "Couldn't connect Upwork", description: error });
  };

  const disconnect = async (id: string, handle: string) => {
    if (!window.confirm(`Disconnect Upwork account ${handle || ""}? Its stored sign-in is deleted, and order accounts using it stop syncing until you connect it again.`)) return;
    setBusy(id);
    const res = await apiCall<{ accountsAffected?: number; detail?: string }>(`/api/upwork/connections/${encodeURIComponent(id)}`, {}, "DELETE");
    setBusy(null);
    if (!res || res.status >= 400) {
      toast({ title: "Couldn't disconnect", description: res?.data?.detail ?? "Can't reach the server." });
      return;
    }
    toast({ title: "Upwork account disconnected", description: res.data.accountsAffected ? `${res.data.accountsAffected} order account(s) paused.` : undefined });
    void load();
  };

  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Upwork</CardTitle>
          <CardDescription>Sign in on Upwork to search jobs and track orders through Upwork&apos;s official API. Your Upwork password never touches this app, and the access it grants is stored encrypted.</CardDescription>
        </div>
        <Button size="sm" variant="gradient" disabled={!canConnect || !!busy} onClick={() => void connect()}>
          {busy === "new" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />} Connect Upwork
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!canConnect && reason && <p className="flex items-start gap-2 text-xs text-muted-foreground"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />{reason}</p>}
        {connections.length === 0 && <p className="text-sm text-muted-foreground">No Upwork account connected yet.</p>}
        {connections.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{c.name || c.handle || "Upwork account"}{c.handle && c.name ? <span className="font-normal text-muted-foreground"> · {c.handle}</span> : null}</p>
              <p className="text-xs text-muted-foreground">Connected {c.connectedAt ? formatRelative(c.connectedAt) : ""}</p>
            </div>
            {c.status === "active" ? <Badge variant="success">Connected</Badge> : <Badge variant="warning">Reconnect needed</Badge>}
            {c.status !== "active" && (
              <Button size="sm" variant="outline" disabled={!canConnect || !!busy} onClick={() => void connect()}>
                <Plug className="size-4" /> Reconnect
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void disconnect(c.id, c.handle)} aria-label={`Disconnect ${c.handle || "Upwork account"}`}>
              {busy === c.id ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />} Disconnect
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
