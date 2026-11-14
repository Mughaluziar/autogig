"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiCall, apiFetch, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Preview = {
  blockers: string[];
  willDelete: Record<string, number>;
  willAnonymize: Record<string, number>;
  willRetain: Record<string, { n: number; until: string | null }>;
  retentionYears: number;
};

const LABELS: Record<string, string> = {
  users: "Your account", workspaces: "Dashboard data", settings: "Settings", notifications: "Notifications", activity: "Activity feed",
  automation_jobs: "Automation queue", campaigns: "Outreach campaigns", bids: "Saved bids", messages: "Messages and forwarded emails",
  proposals: "Proposals", upwork_leads: "Upwork leads", orders: "Tracked orders", order_accounts: "Connected marketplace accounts",
  order_events: "Order timeline", api_keys: "API keys", oauth_identities: "Social sign-in links", team_members: "Team memberships",
  team_invites: "Team invitations", waitlist: "Waitlist entries", beta_testers: "Beta sign-up", capital_profiles: "Verification profile (simulated)",
  bank_accounts: "Bank accounts (simulated)", token_wallets: "Wallet link", pool_specs: "Job specs you posted", pool_bids: "Pool bids",
  pool_contracts: "Contracts", pool_earnings: "Recorded payouts", pay_links: "Invoice pay links", billing: "Plan and purchase history",
  subscriptions: "Subscription state", capital_journal: "Simulated ledger entries", terms_acceptances: "Record of accepted Terms",
  data_requests: "Record of these requests",
};
const label = (k: string) => LABELS[k] ?? k.replace(/_/g, " ");

export function YourData() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const needsPassword = user?.hasPassword !== false;
  const [exportPw, setExportPw] = React.useState("");
  const [exportMsg, setExportMsg] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [delPw, setDelPw] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [delMsg, setDelMsg] = React.useState("");
  const [scheduled, setScheduled] = React.useState("");

  async function exportData() {
    setBusy("export"); setExportMsg("");
    try {
      const res = await apiFetch("/api/me/export", { method: "POST", body: JSON.stringify({ password: needsPassword ? exportPw : undefined }) });
      if (!res.ok) {
        const detail = ((await res.json().catch(() => ({}))) as { detail?: string }).detail;
        setExportMsg(detail ?? "The export failed. Try again.");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = "autopilot-export.json"; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setExportMsg("Your export was downloaded.");
      setExportPw("");
    } catch { setExportMsg("Can't reach the server. Try again."); }
    finally { setBusy(""); }
  }

  async function loadPreview() {
    setBusy("preview"); setDelMsg("");
    const data = await apiGet<Preview>("/api/me/deletion/preview");
    setBusy("");
    if (data) setPreview(data); else setDelMsg("Couldn't load the preview. Try again.");
  }

  async function scheduleDeletion() {
    setBusy("delete"); setDelMsg("");
    const res = await apiCall<{ scheduledFor?: string; detail?: unknown }>("/api/me/deletion",
      { password: needsPassword ? delPw : undefined, confirm });
    setBusy("");
    if (!res) { setDelMsg("Can't reach the server. Try again."); return; }
    if (res.status >= 400) {
      const d = res.data.detail as unknown;
      if (d && typeof d === "object" && "blockers" in (d as object)) setPreview((p) => ({ ...(p ?? ({} as Preview)), blockers: (d as { blockers: string[] }).blockers }));
      setDelMsg(typeof d === "string" ? d : (d as { message?: string })?.message ?? "Couldn't schedule the deletion.");
      return;
    }
    setScheduled(res.data.scheduledFor ?? "");
  }

  if (scheduled) {
    const when = new Date(scheduled).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    return (
      <Card data-testid="deletion-scheduled">
        <CardHeader><CardTitle>Deletion scheduled</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Your account will be deleted on <strong>{when}</strong>. You&apos;ve been signed out. Sign in before then to cancel it.</p>
          <Button onClick={() => { logout(); router.push("/login"); }}>Go to sign-in</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="size-5" /> Download your data</CardTitle>
          <CardDescription>A JSON file with the data Autopilot holds about you. It contains only your own records, never passwords or keys.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {needsPassword && (
            <div className="space-y-1.5">
              <Label htmlFor="export-pw">Current password</Label>
              <Input id="export-pw" type="password" autoComplete="current-password" value={exportPw} onChange={(e) => setExportPw(e.target.value)} />
            </div>
          )}
          {!needsPassword && <p className="text-xs text-muted-foreground">You use social sign-in: if your last sign-in was more than 10 minutes ago, sign in again first.</p>}
          <Button onClick={exportData} disabled={busy === "export" || (needsPassword && !exportPw)} data-testid="export-button">
            <Download className="size-4" /> {busy === "export" ? "Preparing…" : "Download my data"}
          </Button>
          {exportMsg && <p className="text-sm text-muted-foreground" role="status" data-testid="export-message">{exportMsg}</p>}
          <p className="text-xs text-muted-foreground">You can download your data up to 3 times an hour.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive"><Trash2 className="size-5" /> Delete your account</CardTitle>
          <CardDescription>
            Your personal data is deleted after a grace period during which you can change your mind. Records other people
            need (contracts and recorded payouts you share with them) are kept without your name for the retention period,
            then removed. See the <Link href="/legal/privacy" className="text-primary underline">Privacy Policy</Link> (draft).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!preview && <Button variant="outline" onClick={loadPreview} disabled={busy === "preview"} data-testid="deletion-preview">See exactly what would happen</Button>}
          {preview && (
            <div className="space-y-3 text-sm" data-testid="deletion-plan">
              {preview.blockers.length > 0 && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3" role="alert" data-testid="deletion-blockers">
                  <p className="font-medium">Your account can&apos;t be deleted yet:</p>
                  <ul className="mt-1 list-disc pl-5">{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              <Plan title="Deleted" rows={preview.willDelete} />
              <Plan title={`Kept without your name (about ${preview.retentionYears} years, then removed)`} rows={preview.willAnonymize} />
              <Plan title="Kept (no personal text)" rows={Object.fromEntries(Object.entries(preview.willRetain).map(([k, v]) => [k, v.n]))} />
            </div>
          )}
          {preview && preview.blockers.length === 0 && (
            <div className="space-y-3 border-t pt-4">
              {needsPassword && (
                <div className="space-y-1.5">
                  <Label htmlFor="del-pw">Current password</Label>
                  <Input id="del-pw" type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="del-confirm">Type DELETE MY ACCOUNT to confirm</Label>
                <Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              </div>
              <Button variant="destructive" onClick={scheduleDeletion}
                disabled={busy === "delete" || confirm.trim() !== "DELETE MY ACCOUNT" || (needsPassword && !delPw)} data-testid="deletion-submit">
                <Trash2 className="size-4" /> Schedule deletion
              </Button>
            </div>
          )}
          {delMsg && <p className="text-sm text-destructive" role="alert" data-testid="deletion-message">{delMsg}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Plan({ title, rows }: { title: string; rows: Record<string, number> }) {
  const entries = Object.entries(rows);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul className="mt-1 grid gap-x-4 sm:grid-cols-2 text-muted-foreground">
        {entries.map(([k, n]) => <li key={k}>{label(k)}: {n}</li>)}
      </ul>
    </div>
  );
}
