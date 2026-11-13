"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, MailCheck, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiCall, apiGet } from "@/lib/api";
import { useAuth, dashboardHomeFor, sessionFields, type Role } from "@/lib/auth";
import { startUpworkConnect, type UpworkConnections } from "@/lib/upwork";
import { cn } from "@/lib/utils";
import { forgetNext, nextFromLocation, recalledNext, withNext } from "@/lib/safe-next";
import { UPWORK_PROMPT_KEY, VERIFICATION_KEY, type VerificationInfo } from "@/components/auth/verification";

const LENGTH = 6;
const CODE_TTL_MS = 15 * 60 * 1000;

type Session = { token?: string; user?: Record<string, any>; detail?: string };

function readStored(): VerificationInfo | null {
  try {
    const info = JSON.parse(sessionStorage.getItem(VERIFICATION_KEY) ?? "null") as VerificationInfo | null;
    return info && info.at && Date.now() - info.at < CODE_TTL_MS ? info : null;
  } catch {
    return null;
  }
}

function store(info: VerificationInfo | null) {
  try {
    if (info) sessionStorage.setItem(VERIFICATION_KEY, JSON.stringify(info));
    else sessionStorage.removeItem(VERIFICATION_KEY);
  } catch { /* storage blocked */ }
}

export default function VerifyEmailPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, restored, demoMode, login, logout } = useAuth();
  const [digits, setDigits] = React.useState<string[]>(() => Array(LENGTH).fill(""));
  const [info, setInfo] = React.useState<VerificationInfo | null>(null);
  const [cooldown, setCooldown] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [done, setDone] = React.useState<{ role: Role; upwork: UpworkConnections | null } | null>(null);
  const inputs = React.useRef<(HTMLInputElement | null)[]>([]);
  const lastTried = React.useRef("");
  const requested = React.useRef(false);

  const needsCode = !!user?.verificationRequired && !demoMode;
  // ?next= (or the one remembered at signup/sign-in): where to go once confirmed.
  const nextRef = React.useRef("");
  React.useEffect(() => {
    nextRef.current = nextFromLocation() || recalledNext();
  }, []);

  // Nobody signed in → login; nothing to verify → their dashboard.
  React.useEffect(() => {
    if (done || (!restored && !demoMode)) return;
    if (!user) router.replace(withNext("/login", nextRef.current));
    else if (!needsCode) router.replace(nextRef.current || dashboardHomeFor(user.role));
  }, [restored, demoMode, user, needsCode, done, router]);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = React.useCallback(async (manual: boolean) => {
    setSending(true);
    setError("");
    try {
      const res = await apiCall<VerificationInfo & { detail?: string; alreadyVerified?: boolean }>("/api/auth/resend-verification", {});
      if (!res) {
        setError("Can't reach the server. Check your connection and try again.");
        return;
      }
      if (res.status === 429) {
        const wait = Number(/(\d+) seconds/.exec(res.data.detail ?? "")?.[1] ?? 0);
        if (wait) setCooldown(wait);
        if (manual || !wait) setError(res.data.detail ?? "Please wait before requesting another code.");
        return;
      }
      if (res.status >= 400) {
        setError(res.data.detail ?? "Couldn't send a code. Try again.");
        return;
      }
      if (res.data.alreadyVerified) {
        // Verified elsewhere (another tab): trade this session for a full one.
        await submit("");
        return;
      }
      const next: VerificationInfo = { ...res.data, at: Date.now() };
      setInfo(next);
      store(next);
      setCooldown(res.data.retryAfterSeconds ?? 60);
      setDigits(Array(LENGTH).fill(""));
      lastTried.current = "";
      if (manual) {
        toast({
          title: next.sent ? "New code sent" : next.devCode ? "New code ready" : "Couldn't send the email",
          description: next.sent ? `Check ${user?.email ?? "your inbox"}.` : next.detail,
          variant: next.sent || next.devCode ? "success" : undefined,
        });
      }
      inputs.current[0]?.focus();
    } finally {
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, user?.email]);

  // Use the code issued at signup, or ask for one (arriving from sign-in).
  React.useEffect(() => {
    if (!needsCode || requested.current) return;
    requested.current = true;
    const stored = readStored();
    if (stored) {
      setInfo(stored);
      const elapsed = Math.floor((Date.now() - (stored.at ?? 0)) / 1000);
      setCooldown(Math.max(0, (stored.retryAfterSeconds ?? 60) - elapsed));
    } else {
      void requestCode(false);
    }
    inputs.current[0]?.focus();
  }, [needsCode, requestCode]);

  async function submit(code: string) {
    setBusy(true);
    setError("");
    try {
      const res = await apiCall<Session>("/api/auth/verify-email", { code });
      if (!res) {
        setError("Can't reach the server. Check your connection and try again.");
        return;
      }
      if (res.status >= 400 || !res.data.token || !res.data.user) {
        setError(res.data.detail ?? "That code didn't work. Try again.");
        setDigits(Array(LENGTH).fill(""));
        inputs.current[0]?.focus();
        return;
      }
      const fields = sessionFields(res.data.user);
      const role = (res.data.user.role as Role) ?? user?.role ?? "admin";
      store(null);
      let wantsUpwork = false;
      try {
        wantsUpwork = sessionStorage.getItem(UPWORK_PROMPT_KEY) === "1";
        sessionStorage.removeItem(UPWORK_PROMPT_KEY);
      } catch { /* storage blocked */ }
      // Connecting Upwork's API lands on the agency workspace's Accounts page.
      const offered = wantsUpwork && role === "admin" ? await apiGet<UpworkConnections>("/api/upwork/connections") : null;
      const upwork = offered?.canConnect ? offered : null; // only when the API connection is switched on
      setDone({ role, upwork });
      login(role, fields, res.data.token);
      toast({ title: "Email confirmed", description: "Your account is ready.", variant: "success" });
      // A full load, not a client-side push: the workspace store couldn't load
      // with the pending session and only reloads when the user changes.
      const target = nextRef.current || (role === "admin" ? "/dashboard/command" : dashboardHomeFor(role));
      forgetNext();
      if (!upwork) window.location.replace(target);
    } finally {
      setBusy(false);
    }
  }

  const code = digits.join("");
  React.useEffect(() => {
    if (code.length === LENGTH && !busy && code !== lastTried.current) {
      lastTried.current = code;
      void submit(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, busy]);

  const fill = (start: number, text: string) => {
    const clean = text.replace(/\D/g, "").slice(0, LENGTH - start);
    if (!clean) return;
    setDigits((cur) => {
      const next = [...cur];
      clean.split("").forEach((d, i) => (next[start + i] = d));
      return next;
    });
    inputs.current[Math.min(start + clean.length, LENGTH - 1)]?.focus();
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      setDigits((cur) => cur.map((d, j) => (j === i - 1 ? "" : d)));
      inputs.current[i - 1]?.focus();
    } else if (e.key === "ArrowLeft" && i > 0) {
      inputs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < LENGTH - 1) {
      inputs.current[i + 1]?.focus();
    }
  };

  if (done?.upwork) {
    const up = done.upwork;
    return (
      <div className="text-center">
        <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-success/15 text-success">
          <CheckCircle2 className="size-7" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">Email confirmed</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account is ready. One more optional step:</p>
        <div className="panel mt-6 p-5 text-left">
          <h2 className="font-semibold">Connect your Upwork account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You linked an Upwork profile. Connecting through Upwork&apos;s own sign-in lets Autopilot sync your jobs and
            orders. We never see your Upwork password.
          </p>
          {up.canConnect ? (
            <Button
              variant="gradient"
              className="mt-4 w-full"
              onClick={async () => {
                const err = await startUpworkConnect("/dashboard/accounts");
                if (err) toast({ title: "Couldn't start the Upwork sign-in", description: err });
              }}
            >
              Connect Upwork <ArrowRight className="size-4" />
            </Button>
          ) : (
            <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-muted-foreground">
              {up.reason ?? "Upwork connections aren't switched on for this app yet."} Your profile link is saved, and you can
              connect later from Accounts &amp; Gigs.
            </p>
          )}
        </div>
        <Button variant="ghost" className="mt-4 w-full" onClick={() => window.location.replace(nextRef.current || "/dashboard/command")}>
          {up.canConnect ? "Skip for now" : "Continue to your dashboard"}
        </Button>
      </div>
    );
  }

  if (!needsCode) {
    return (
      <div className="flex justify-center py-16" role="status">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-purple-500 text-white shadow-lg shadow-primary/30">
        <MailCheck className="size-7" />
      </span>
      <h1 className="text-2xl font-bold tracking-tight">Confirm your email</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Enter the 6-digit code we sent to <span className="break-all font-medium text-foreground">{user?.email}</span>.
      </p>

      {info?.devCode && (
        <div className="mt-5 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-sm">
          <p className="font-medium">Development only</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            No email provider is configured on this server, so the code is shown here instead of being emailed. Production
            servers never do this.
          </p>
          <button
            type="button"
            className="mt-2 font-mono text-lg font-semibold tracking-[0.3em] text-foreground underline-offset-4 hover:underline"
            onClick={() => fill(0, info.devCode ?? "")}
            title="Fill in this code"
          >
            {info.devCode}
          </button>
        </div>
      )}
      {info && !info.sent && !info.devCode && info.detail && (
        <p className="mt-5 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> {info.detail}
        </p>
      )}

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === LENGTH) {
            lastTried.current = code;
            void submit(code);
          }
        }}
      >
        <fieldset disabled={busy} className="grid grid-cols-6 gap-2 sm:gap-3">
          <legend className="sr-only">Verification code</legend>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              value={d}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              pattern="[0-9]*"
              maxLength={i === 0 ? LENGTH : 1}
              aria-label={`Digit ${i + 1}`}
              onChange={(e) => {
                const v = e.target.value;
                if (v.length > 1) fill(i, v);
                else {
                  const digit = v.replace(/\D/g, "");
                  setDigits((cur) => cur.map((x, j) => (j === i ? digit : x)));
                  if (digit && i < LENGTH - 1) inputs.current[i + 1]?.focus();
                }
              }}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={(e) => {
                e.preventDefault();
                fill(i, e.clipboardData.getData("text"));
              }}
              onFocus={(e) => e.target.select()}
              className={cn(
                "h-14 w-full min-w-0 rounded-xl border bg-background text-center text-2xl font-semibold tabular-nums outline-none transition-colors",
                "focus:border-primary focus:ring-2 focus:ring-primary/30",
                error ? "border-destructive/60" : d ? "border-primary/50" : "border-input"
              )}
            />
          ))}
        </fieldset>
        <p className={cn("mt-2 min-h-5 text-sm", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>
          {error || (busy ? "Checking…" : "")}
        </p>
        <Button type="submit" variant="gradient" size="lg" className="mt-2 w-full" disabled={busy || code.length !== LENGTH}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {busy ? "Verifying…" : "Verify email"}
        </Button>
      </form>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Didn&apos;t get it? Check spam, or</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={cooldown > 0 || sending}
          onClick={() => requestCode(true)}
        >
          <RotateCw className={cn("size-4", sending && "animate-spin")} />
          {cooldown > 0 ? `Resend in ${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, "0")}` : "Resend code"}
        </Button>
      </div>
      <p className="mt-6 border-t pt-4 text-center text-xs text-muted-foreground">
        Codes expire after 15 minutes. Wrong email?{" "}
        <button
          type="button"
          className="font-medium text-primary hover:underline"
          onClick={() => {
            store(null);
            logout();
            router.push(withNext("/signup", nextRef.current));
          }}
        >
          Start over
        </button>
      </p>
    </div>
  );
}
