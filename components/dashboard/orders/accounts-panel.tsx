"use client";
import * as React from "react";
import Nango from "@nangohq/frontend";
import { AlertTriangle, Copy, Loader2, Mail, Plug, Plus, RefreshCw, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { useToast } from "@/components/ui/toast";
import { API_URL, apiCall } from "@/lib/api";
import { startUpworkConnect } from "@/lib/upwork";
import type { OrderAccount, PlatformCapability } from "@/lib/orders";
import { formatRelative } from "@/lib/utils";

type Detail = { detail?: string };

function syncLine(a: OrderAccount): string {
  if (a.connection === "email") return "Orders arrive by forwarded notification email.";
  if (a.status === "needs_reauth") return "The platform rejected this account's access. Reconnect it.";
  if (a.lastSyncStatus === "error") return `Last sync failed${a.consecutiveFailures > 1 ? ` ${a.consecutiveFailures} times in a row` : ""}: ${a.lastSyncError ?? "unknown error"}`;
  return a.lastSyncAt ? `Synced ${formatRelative(a.lastSyncAt)}` : "Waiting for first sync";
}

export function AccountsPanel({
  accounts, capabilities, onChanged,
}: {
  accounts: OrderAccount[];
  capabilities: PlatformCapability[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const fail = (title: string, res: { data: unknown } | null) =>
    toast({ title, description: (res?.data as Detail | undefined)?.detail ?? "Can't reach the server." });

  const sync = async (a: OrderAccount) => {
    setBusy(a.id);
    const res = await apiCall<{ status: string; created?: number; changed?: number; reason?: string; error?: string }>(
      `/api/orders/accounts/${encodeURIComponent(a.id)}/sync`, {});
    setBusy(null);
    if (!res || res.status >= 400) return fail("Sync failed", res);
    const r = res.data;
    toast({
      title: r.status === "ok" ? "Sync complete" : r.status === "skipped" ? "Nothing to sync" : "Sync failed",
      description: r.status === "ok" ? `${r.created ?? 0} new, ${r.changed ?? 0} updated.` : r.reason ?? r.error,
      variant: r.status === "ok" ? "success" : undefined,
    });
    onChanged();
  };

  const disconnect = async (a: OrderAccount) => {
    if (!window.confirm(`Disconnect ${a.label}? Its orders stay in the dashboard, but they stop syncing and its forwarding address stops working.`)) return;
    setBusy(a.id);
    const res = await apiCall(`/api/orders/accounts/${encodeURIComponent(a.id)}`, {}, "DELETE");
    setBusy(null);
    if (!res || res.status >= 400) return fail("Couldn't disconnect", res);
    toast({ title: "Account disconnected" });
    onChanged();
  };

  const copy = (text: string) =>
    navigator.clipboard.writeText(text)
      .then(() => toast({ title: "Address copied", description: "Set it as a forwarding address for this account's notification emails." }))
      .catch(() => toast({ title: "Copy blocked by browser" }));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus /> Add account</Button>
      </div>
      {accounts.length === 0 ? (
        <EmptyState icon={<Plug className="size-6" />} title="No accounts connected"
          description="Connect each marketplace account you take orders on. You can add several accounts on the same platform." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.label}</p>
                    <p className="text-xs text-muted-foreground">{a.platform}{a.handle ? ` · ${a.handle}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Badge variant={a.connection === "email" ? "secondary" : "default"}>{a.connection === "email" ? "Email only" : "API"}</Badge>
                    {a.status === "needs_reauth" && <Badge variant="destructive">Reconnect</Badge>}
                  </div>
                </div>
                <p className={`flex items-start gap-1.5 text-sm ${a.lastSyncStatus === "error" || a.status === "needs_reauth" ? "text-destructive" : "text-muted-foreground"}`}>
                  {(a.lastSyncStatus === "error" || a.status === "needs_reauth") && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                  {syncLine(a)}
                </p>
                {a.inboundAddress && (
                  <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5">
                    <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={a.inboundAddress}>{a.inboundAddress}</span>
                    <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="Copy forwarding address" onClick={() => copy(a.inboundAddress!)}>
                      <Copy />
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {a.connection !== "email" && (
                    <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => void sync(a)}>
                      {busy === a.id ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => void disconnect(a)}>
                    <Unlink /> Disconnect
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {open && <AddAccountDialog capabilities={capabilities} onClose={() => setOpen(false)} onAdded={() => { setOpen(false); onChanged(); }} />}
    </div>
  );
}

function AddAccountDialog({
  capabilities, onClose, onAdded,
}: {
  capabilities: PlatformCapability[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [platform, setPlatform] = React.useState(capabilities[0]?.platform ?? "");
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const cap = capabilities.find((c) => c.platform === platform);
  const canEmail = Boolean(cap?.detection.includes("email"));

  const save = async (mode: "api" | "email", connectionId?: string) => {
    const res = await apiCall<OrderAccount & Detail>("/api/orders/accounts", { platform, label, mode, connectionId });
    setBusy(false);
    if (!res || res.status >= 400) {
      toast({ title: "Account not added", description: res?.data?.detail ?? "Can't reach the server." });
      return;
    }
    toast({
      title: `${res.data.label} added`,
      description: mode === "api" ? "Existing orders are importing now." : res.data.inboundAddress
        ? "Forward this account's notification emails to the address on its card."
        : "Inbound email isn't configured on the server yet, so no forwarding address was created.",
      variant: "success",
    });
    onAdded();
  };

  const connectApi = async () => {
    if (!cap) return;
    if (!API_URL) {
      toast({ title: "Sample data", description: "Connect the backend to add real accounts." });
      return;
    }
    setBusy(true);
    // The platform's own token is configured on the server: nothing to authorize here.
    if (cap.connection === "platform_token") return save("api");
    // Upwork signs in on upwork.com; the orders page adds the account when the browser returns.
    if (cap.connection === "upwork_oauth") {
      const error = await startUpworkConnect("/dashboard/orders", { label });
      setBusy(false);
      toast({ title: "Couldn't connect Upwork", description: error });
      return;
    }
    if (!cap.integrationId) return setBusy(false);
    const res = await apiCall<{ sessionToken: string } & Detail>("/api/integrations/nango/session", { integration_id: cap.integrationId });
    if (!res || res.status >= 400 || !res.data.sessionToken) {
      setBusy(false);
      toast({ title: "Connection unavailable", description: res?.data?.detail ?? "The server did not start a connection session." });
      return;
    }
    try {
      new Nango({ connectSessionToken: res.data.sessionToken }).openConnectUI({
        sessionToken: res.data.sessionToken,
        detectClosedAuthWindow: true,
        onEvent: async (event) => {
          if (event.type === "close") setBusy(false);
          if (event.type === "error") {
            setBusy(false);
            toast({ title: "Connection failed", description: event.payload.errorMessage });
          }
          // Each Connect run creates a new connection, so a second account on
          // the same platform gets its own credentials.
          if (event.type === "connect") await save("api", event.payload.connectionId);
        },
      }).open();
    } catch {
      setBusy(false);
      toast({ title: "Could not open the connection window" });
    }
  };

  const addEmailOnly = async () => {
    if (!API_URL) {
      toast({ title: "Sample data", description: "Connect the backend to add real accounts." });
      return;
    }
    setBusy(true);
    await save("email");
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Add a marketplace account</DialogTitle>
        <DialogDescription>Add every account you take orders on, including several on the same platform.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="acct-platform">Platform</Label>
          <Select id="acct-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {capabilities.map((c) => <option key={c.platform} value={c.platform}>{c.platform}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acct-label">Name (optional)</Label>
          <Input id="acct-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder={`e.g. ${platform} agency account`} />
        </div>
        {cap && (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            {cap.connection !== "email" && (
              <p>{cap.canConnectApi
                ? "Connecting through the API lets orders be detected automatically and verified against the platform."
                : "API connection isn't approved in this environment yet, so orders from this account can't be verified."}</p>
            )}
            {canEmail && !cap.canConnectApi && (
              <p className="text-muted-foreground">
                Email-only: forward this account&apos;s notifications to its own address to detect orders.
                {cap.verification === "none" ? " These orders can't be verified, because the platform has no verification API." : " They stay pending until the account is connected through the API."}
              </p>
            )}
          </div>
        )}
      </div>
      <DialogFooter className="flex-wrap">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {canEmail && (
          <Button variant={cap?.canConnectApi ? "outline" : "default"} disabled={busy} onClick={() => void addEmailOnly()}>
            {busy && !cap?.canConnectApi ? <Loader2 className="animate-spin" /> : <Mail />} Add email-only
          </Button>
        )}
        {cap?.canConnectApi && (
          <Button disabled={busy} onClick={() => void connectApi()}>
            {busy ? <Loader2 className="animate-spin" /> : <Plug />} Connect via API
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
