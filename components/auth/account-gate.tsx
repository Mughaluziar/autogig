"use client";
import * as React from "react";
import Link from "next/link";
import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { apiCall, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Versions = { terms: string; privacy: string; required: boolean };

function Panel({ icon: Icon, title, testid, children }: { icon: typeof FileText; title: string; testid: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6" data-testid={testid}>
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="size-6" /></span>
        <h1 className="text-xl font-bold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

/**
 * Stops the app for two account states the server reports: deletion scheduled (the account is locked until it is
 * cancelled) and Terms/Privacy not accepted in their current version. The server records the acceptance with the
 * version and time; nothing here is a substitute for that record.
 */
export function AccountGate({ children }: { children: React.ReactNode }) {
  const { user, demoMode, login, logout } = useAuth();
  const [versions, setVersions] = React.useState<Versions | null>(null);
  const [agree, setAgree] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const needsTerms = !demoMode && !!user?.needsTermsAcceptance;

  React.useEffect(() => {
    if (needsTerms) void apiGet<Versions>("/api/legal/versions").then(setVersions);
  }, [needsTerms]);

  if (!demoMode && user?.deletionScheduledFor) {
    const when = new Date(user.deletionScheduledFor).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    return (
      <Panel icon={Trash2} title="Your account is scheduled for deletion" testid="deletion-pending">
        <p className="mt-2 text-sm text-muted-foreground">
          Your account and personal data will be deleted on <strong>{when}</strong>. Until then it is locked. If you didn&apos;t
          mean to do this, cancel the deletion and everything stays as it was.
        </p>
        {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
        <div className="mt-6 flex gap-3">
          <Button
            className="flex-1" disabled={busy}
            onClick={async () => {
              setBusy(true); setError("");
              const res = await apiCall("/api/me/deletion", {}, "DELETE");
              setBusy(false);
              if (res && res.status < 400) login(user.role, { ...user, deletionScheduledFor: null });
              else setError("Couldn't cancel the deletion. Try again.");
            }}
          >Cancel deletion</Button>
          <Button variant="outline" className="flex-1" onClick={logout}>Sign out</Button>
        </div>
      </Panel>
    );
  }

  if (needsTerms && user) {
    return (
      <Panel icon={FileText} title="Please review our Terms and Privacy Policy" testid="terms-gate">
        <p className="mt-2 text-sm text-muted-foreground">
          To keep using Autopilot, please confirm you agree to the current{" "}
          <Link href="/legal/terms" target="_blank" className="text-primary hover:underline">Terms of Service</Link> and{" "}
          <Link href="/legal/privacy" target="_blank" className="text-primary hover:underline">Privacy Policy</Link>.
          {versions && <span className="mt-1 block text-xs">Versions: {versions.terms} / {versions.privacy}</span>}
        </p>
        <div className="mt-4 flex items-start gap-2">
          <Checkbox id="gate-agree" checked={agree} onCheckedChange={setAgree} />
          <Label htmlFor="gate-agree" className="text-sm font-normal text-muted-foreground">I have read and agree to both documents.</Label>
        </div>
        {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
        <div className="mt-6 flex gap-3">
          <Button
            className="flex-1" disabled={!agree || !versions || busy}
            onClick={async () => {
              if (!versions) return;
              setBusy(true); setError("");
              const res = await apiCall("/api/me/terms/accept", { terms: versions.terms, privacy: versions.privacy });
              setBusy(false);
              if (res && res.status < 400) login(user.role, { ...user, needsTermsAcceptance: false });
              else setError("Couldn't record your acceptance. Reload the page and try again.");
            }}
          >Accept and continue</Button>
          <Button variant="outline" onClick={logout}>Sign out</Button>
        </div>
      </Panel>
    );
  }
  return <>{children}</>;
}
