"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiCall } from "@/lib/api";
import { afterSignIn, isRole, sessionFields, useAuth } from "@/lib/auth";
import { rememberNext, safeNext, withNext } from "@/lib/safe-next";

type Exchange = { token?: string; user?: Record<string, any>; detail?: string; newAccount?: boolean; next?: string };

/**
 * Social sign-in lands here with a one-time ?code= from the backend, which
 * this page trades for the session (the token itself never travels in a URL).
 */
export default function OAuthCallbackPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [error, setError] = React.useState("");
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = new URLSearchParams(window.location.search).get("code") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    if (!code) {
      setError("This sign-in link is incomplete. Start the sign-in again.");
      return;
    }
    void (async () => {
      const res = await apiCall<Exchange>("/api/auth/oauth/exchange", { code });
      if (!res) {
        setError("Can't reach the server. Check your connection and try again.");
        return;
      }
      const user = res.data.user;
      if (res.status >= 400 || !user || !isRole(user.role)) {
        setError(res.data.detail ?? "This sign-in link has expired. Sign in again.");
        return;
      }
      const fields = sessionFields(user);
      login(user.role, fields);
      const next = safeNext(res.data.next);
      if (fields.verificationRequired) {
        rememberNext(next);
        router.replace(withNext("/verify-email", next));
        return;
      }
      router.replace(next || (res.data.newAccount && user.role === "admin" ? "/dashboard/command" : afterSignIn({ role: user.role })));
    })();
  }, [login, router]);

  if (error) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-destructive/15 text-destructive">
          <AlertTriangle className="size-6" />
        </span>
        <h1 className="text-xl font-bold tracking-tight">Sign-in didn&apos;t finish</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Button variant="gradient" className="mt-6 w-full" asChild>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center" role="status" aria-live="polite">
      <Loader2 className="size-7 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}
