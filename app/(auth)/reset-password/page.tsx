"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { API_URL, apiCall } from "@/lib/api";

const MIN_LENGTH = 8;

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const token = params.get("token") ?? "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!token) { setError("This page needs the link from your reset email."); return; }
    if (password.length < MIN_LENGTH) { setError(`Use at least ${MIN_LENGTH} characters.`); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    if (!API_URL) { setError("Password reset needs the backend, which isn't connected in this demo build."); return; }
    setBusy(true);
    const res = await apiCall<{ detail?: string }>("/api/auth/reset-password", { token, password });
    setBusy(false);
    if (!res) { setError("Can't reach the server. Try again in a moment."); return; }
    if (res.status >= 400) { setError(res.data?.detail ?? "Couldn't update the password."); return; }
    toast({ title: "Password updated", description: "You can now sign in.", variant: "success" });
    router.push("/login");
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Set a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose a strong password for your account.</p>
      </div>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" autoComplete="new-password" required minLength={MIN_LENGTH}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input id="confirm" type="password" autoComplete="new-password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="gradient" className="w-full" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Link expired?{" "}
        <Link href="/forgot-password" className="font-medium text-primary hover:underline">Request a new one</Link>
        {" · "}
        <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetForm />
    </React.Suspense>
  );
}
