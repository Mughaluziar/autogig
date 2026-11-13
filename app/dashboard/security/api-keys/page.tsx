"use client";
import * as React from "react";
import { AlertTriangle, Check, Copy, KeyRound, Plus, Terminal, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { SectionNav } from "@/components/security/section-nav";
import { BackendNotice, LoadError } from "@/components/security/backend-notice";
import { ConfirmDialog, type Confirm } from "@/components/security/confirm-dialog";
import { SERVER_FEATURES, detailOf, send, useApi } from "@/components/security/use-api";
import { SECURITY_LINKS, staleKeys, type ApiKey } from "@/components/security/security";
import { API_URL } from "@/lib/api";
import { cn, formatRelative } from "@/lib/utils";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "Never");
const STATUS: Record<ApiKey["status"], "success" | "secondary" | "destructive"> = { active: "success", revoked: "secondary", expired: "destructive" };

export default function ApiKeysPage() {
  const { toast } = useToast();
  const { data, loading, error, reload } = useApi<ApiKey[]>("/api/api-keys");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [secret, setSecret] = React.useState<{ name: string; value: string } | null>(null);
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [showInactive, setShowInactive] = React.useState(false);

  const keys = data ?? [];
  const active = keys.filter((k) => k.status === "active");
  const stale = new Set(staleKeys(keys).map((k) => k.id));
  const shown = showInactive ? keys : active;

  const revoke = (k: ApiKey) =>
    setConfirm({
      title: `Revoke "${k.name}"?`,
      body: "Anything using this key stops working straight away. This can't be undone.",
      confirmLabel: "Revoke key",
      action: async () => {
        const res = await send(`/api/api-keys/${k.id}`, "DELETE");
        toast(res.ok ? { title: "Key revoked", variant: "success" } : { title: "Couldn't revoke", description: detailOf(res.data) });
        reload();
      },
    });

  return (
    <>
      <PageHeader
        title="API keys"
        description="Connect your own scripts, Zapier or a spreadsheet to Autopilot. Each key acts as you."
        actions={SERVER_FEATURES && <Button variant="gradient" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Create key</Button>}
      />
      <SectionNav links={SECURITY_LINKS} />

      {!SERVER_FEATURES ? (
        <BackendNotice feature="API keys" />
      ) : error ? (
        <LoadError message={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="h-48 animate-pulse rounded-2xl bg-muted/60" />
      ) : (
        <div className="space-y-6">
          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
              <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="size-4 text-primary" /> Your keys <span className="text-sm font-normal text-muted-foreground">{active.length} active</span></h2>
              {keys.length > active.length && (
                <button onClick={() => setShowInactive((v) => !v)} className="text-xs font-medium text-primary hover:underline">
                  {showInactive ? "Hide" : "Show"} revoked and expired ({keys.length - active.length})
                </button>
              )}
            </header>
            {shown.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <KeyRound className="size-8 text-muted-foreground" />
                <p className="mt-3 font-medium">No active keys</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">Create a key to pull your jobs, invoices or orders into another tool. Start read-only; add write access only if a tool needs to make changes.</p>
                <Button className="mt-4" variant="outline" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Create your first key</Button>
              </div>
            ) : (
              <ul className="divide-y">
                {shown.map((k) => (
                  <li key={k.id} className={cn("flex flex-col gap-3 px-4 py-3.5 sm:px-5 md:flex-row md:items-center", k.status !== "active" && "opacity-60")}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{k.name}</p>
                        <Badge variant={STATUS[k.status]} className="capitalize">{k.status}</Badge>
                        <Badge variant={k.scopes.includes("write") ? "warning" : "secondary"}>{k.scopes.includes("write") ? "Read & write" : "Read only"}</Badge>
                        {stale.has(k.id) && <Badge variant="outline">Unused 30+ days</Badge>}
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{k.prefix}…</p>
                    </div>
                    <dl className="grid grid-cols-3 gap-3 text-xs md:w-[360px]">
                      <div><dt className="text-muted-foreground">Created</dt><dd className="font-medium">{fmt(k.createdAt)}</dd></div>
                      <div><dt className="text-muted-foreground">Last used</dt><dd className="font-medium">{k.lastUsedAt ? formatRelative(k.lastUsedAt) : "Never"}</dd></div>
                      <div><dt className="text-muted-foreground">{k.status === "revoked" ? "Revoked" : "Expires"}</dt><dd className={cn("font-medium", !k.expiresAt && k.status === "active" && "text-warning")}>{k.status === "revoked" ? fmt(k.revokedAt) : fmt(k.expiresAt)}</dd></div>
                    </dl>
                    {k.status === "active" && (
                      <Button size="sm" variant="ghost" className="self-start text-destructive md:self-auto" onClick={() => revoke(k)}>
                        <Trash2 className="size-4" /> Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel p-4 sm:p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Terminal className="size-4 text-primary" /> Using a key</h2>
            <p className="mt-1 text-sm text-muted-foreground">Send it as a bearer token. Requests run as your account and see only your data.</p>
            <pre className="mt-3 overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed"><code>{`curl ${API_URL || "https://your-api"}/api/radar/saved \\
  -H "Authorization: Bearer apk_your_key"`}</code></pre>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>• <span className="text-foreground">Read only</span> keys can make GET requests. <span className="text-foreground">Read &amp; write</span> keys can also create and change things.</li>
              <li>• Keys can&apos;t create other keys, change your password or sign-in, or manage your team.</li>
              <li>• Treat a key like a password. If one leaks, revoke it here and create a new one.</li>
            </ul>
          </section>
        </div>
      )}

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(name, value) => {
          setSecret({ name, value });
          reload();
        }}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function CreateKeyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (name: string, secret: string) => void }) {
  const [name, setName] = React.useState("");
  const [access, setAccess] = React.useState<"read" | "write">("read");
  const [expiry, setExpiry] = React.useState("90");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setAccess("read");
      setExpiry("90");
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await send<{ secret: string }>("/api/api-keys", "POST", {
      name, scopes: access === "write" ? ["read", "write"] : ["read"], expiresInDays: expiry === "never" ? null : Number(expiry),
    });
    setBusy(false);
    if (!res.ok || !res.data) return setError(detailOf(res.data, "Couldn't create the key."));
    onOpenChange(false);
    onCreated(name.trim(), res.data.secret);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Create an API key</DialogTitle>
          <DialogDescription>Name it after where you&apos;ll use it, so you know what breaks if you revoke it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="key-name">Name</Label>
            <Input id="key-name" required maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Zapier — invoices" />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Access</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([["read", "Read only", "View data. Safest choice."], ["write", "Read & write", "Also create and change things."]] as const).map(([v, label, hint]) => (
                <label key={v} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3", access === v ? "border-primary bg-primary/5" : "hover:bg-accent/50")}>
                  <input type="radio" name="access" checked={access === v} onChange={() => setAccess(v)} className="mt-1 accent-[hsl(var(--primary))]" />
                  <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="key-expiry">Expires</Label>
            <Select id="key-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In 1 year</option>
              <option value="never">Never (not recommended)</option>
            </Select>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="flex-col-reverse sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="gradient" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create key"}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function SecretDialog({ secret, onClose }: { secret: { name: string; value: string } | null; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => setCopied(false), [secret]);
  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      setCopied(true);
    } catch { /* clipboard blocked — the field is selectable */ }
  };
  return (
    <Dialog open={!!secret} onOpenChange={(v) => !v && onClose()}>
      {secret && (
        <>
          <DialogHeader>
            <DialogTitle>Copy your key now</DialogTitle>
            <DialogDescription>&ldquo;{secret.name}&rdquo; is ready. We only store a fingerprint of it, so this is the only time you&apos;ll see it.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={secret.value} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="API key" />
            <Button variant="outline" size="icon" onClick={copy} aria-label="Copy API key">{copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}</Button>
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            Store it in a password manager or your tool&apos;s secret settings. Never paste it into a public place.
          </p>
          <DialogFooter>
            <Button variant="gradient" onClick={onClose}>{copied ? "Done" : "I've saved it"}</Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
