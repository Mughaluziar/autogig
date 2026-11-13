"use client";
import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { SectionNav } from "@/components/security/section-nav";
import { BackendNotice } from "@/components/security/backend-notice";
import { SERVER_FEATURES, detailOf, send, useApi } from "@/components/security/use-api";
import { SECURITY_LINKS, type Me } from "@/components/security/security";
import { cn } from "@/lib/utils";

const RULES: { id: string; label: string; test: (p: string) => boolean }[] = [
  { id: "len", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { id: "long", label: "12+ characters is much stronger", test: (p) => p.length >= 12 },
  { id: "mix", label: "Upper and lower case letters", test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { id: "num", label: "A number or symbol", test: (p) => /[\d\W_]/.test(p) },
];

function strength(p: string) {
  if (!p) return { score: 0, label: "", tone: "bg-muted" };
  const passed = RULES.filter((r) => r.test(p)).length;
  if (p.length < 8) return { score: 1, label: "Too short", tone: "bg-destructive" };
  if (passed <= 2) return { score: 2, label: "Weak", tone: "bg-warning" };
  if (passed === 3) return { score: 3, label: "Good", tone: "bg-primary" };
  return { score: 4, label: "Strong", tone: "bg-success" };
}

export default function PasswordPage() {
  const { toast } = useToast();
  const me = useApi<Me>("/api/auth/me");
  const hasPassword = me.data?.user.hasPassword !== false;
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const s = strength(next);
  const mismatch = confirm.length > 0 && confirm !== next;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    setError(null);
    const res = await send("/api/auth/change-password", "POST", { currentPassword: current, newPassword: next });
    setBusy(false);
    if (!res.ok) return setError(detailOf(res.data, "Couldn't change your password."));
    setCurrent("");
    setNext("");
    setConfirm("");
    toast({ title: hasPassword ? "Password changed" : "Password set", description: "Use it the next time you sign in.", variant: "success" });
    me.reload();
  };

  return (
    <>
      <PageHeader title={hasPassword ? "Change password" : "Set a password"} description="A long, unique password is the single best protection for your account." />
      <SectionNav links={SECURITY_LINKS} />

      {!SERVER_FEATURES ? (
        <BackendNotice feature="Changing your password" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <form onSubmit={submit} className="panel space-y-4 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><LockKeyhole className="size-5" /></span>
              <div>
                <h2 className="font-semibold">{hasPassword ? "Update your password" : "Add a password to your account"}</h2>
                <p className="text-sm text-muted-foreground">{hasPassword ? "You'll stay signed in on this device." : "You signed up with a social account. A password gives you a second way in."}</p>
              </div>
            </div>
            {hasPassword && (
              <div className="space-y-1.5">
                <Label htmlFor="current">Current password</Label>
                <Input id="current" type={show ? "text" : "password"} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="new">New password</Label>
                <button type="button" onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                  {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {show ? "Hide" : "Show"}
                </button>
              </div>
              <Input id="new" type={show ? "text" : "password"} autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
              <div className="flex items-center gap-2 pt-1" aria-live="polite">
                <div className="grid flex-1 grid-cols-4 gap-1">
                  {[1, 2, 3, 4].map((i) => <span key={i} className={cn("h-1.5 rounded-full", i <= s.score ? s.tone : "bg-muted")} />)}
                </div>
                <span className="w-16 text-right text-xs text-muted-foreground">{s.label}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input id="confirm" type={show ? "text" : "password"} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
              {mismatch && <p className="text-xs text-destructive">Doesn&apos;t match the new password.</p>}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button asChild variant="ghost"><Link href="/forgot-password">Forgot your current password?</Link></Button>
              <Button type="submit" variant="gradient" disabled={busy || next.length < 8 || mismatch || (hasPassword && !current)}>
                {busy ? "Saving…" : hasPassword ? "Change password" : "Set password"}
              </Button>
            </div>
          </form>

          <aside className="panel h-fit p-4 sm:p-5">
            <h2 className="text-sm font-semibold">A strong password</h2>
            <ul className="mt-3 space-y-2">
              {RULES.map((r) => {
                const ok = r.test(next);
                return (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    {ok ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                    <span className={ok ? "" : "text-muted-foreground"}>{r.label}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">Tip: three or four random words (&ldquo;copper lantern river atlas&rdquo;) are long, strong and easy to remember. A password manager is even better.</p>
          </aside>
        </div>
      )}
    </>
  );
}
