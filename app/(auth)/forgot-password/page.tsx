"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_URL, apiCall } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [sent, setSent] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [devLink, setDevLink] = React.useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!API_URL) { setError("Password reset needs the backend, which isn't connected in this demo build."); return; }
    setBusy(true);
    const res = await apiCall<{ devResetLink?: string; detail?: string }>("/api/auth/forgot-password", { email: email.trim() });
    setBusy(false);
    if (!res) { setError("Can't reach the server. Try again in a moment."); return; }
    if (res.status === 429) { setError("Too many attempts. Wait a minute and try again."); return; }
    if (res.status >= 400) { setError(res.data?.detail ?? "Something went wrong. Try again."); return; }
    setDevLink(res.data?.devResetLink ?? "");
    setSent(true);
  };

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
          <MailCheck className="size-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If an account exists for that email, a reset link is on its way. It may take a few minutes to arrive, and it expires in 30 minutes.
        </p>
        {devLink && (
          <p className="mt-4 break-all rounded-lg bg-muted p-3 text-left text-xs">
            Local development only (no email provider is configured): <a className="text-primary underline" href={devLink}>open the reset link</a>.
          </p>
        )}
        <Button variant="outline" className="mt-6" asChild>
          <Link href="/login">
            <ArrowLeft className="size-4" /> Back to login
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Forgot password?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email and we'll send you a reset link.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={submit}
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="you@company.com" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="gradient" className="w-full" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </Button>
      </form>
      <Button variant="ghost" size="sm" className="mt-4 w-full" asChild>
        <Link href="/login">
          <ArrowLeft className="size-4" /> Back to login
        </Link>
      </Button>
    </div>
  );
}
