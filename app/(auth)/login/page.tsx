"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Briefcase, Gauge, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth, afterSignIn, isRole, sessionFields, type Role } from "@/lib/auth";
import { apiCall } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { OAUTH_ERRORS, SocialSignIn } from "@/components/auth/social-sign-in";
import { cn } from "@/lib/utils";
import { nextFromLocation, rememberNext, withNext } from "@/lib/safe-next";

const quickRoles: { role: Role; label: string; icon: typeof Gauge }[] = [
  { role: "admin", label: "Agency / Admin", icon: Gauge },
  { role: "freelancer", label: "Freelancer", icon: Briefcase },
  { role: "investor", label: "Investor", icon: Landmark },
];

export default function LoginPage() {
  const router = useRouter();
  const { login, demoMode } = useAuth();
  const { toast } = useToast();
  const [remember, setRemember] = React.useState(true);
  const [role, setRole] = React.useState<Role>("admin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [oauthError, setOauthError] = React.useState("");
  // ?next= — where to go after signing in (e.g. back to checkout).
  const [next, setNext] = React.useState("");
  React.useEffect(() => setNext(nextFromLocation()), []);

  // A social sign-in that didn't finish comes back with ?oauth_error=<reason>.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const reason = url.searchParams.get("oauth_error");
    if (!reason) return;
    setOauthError(OAUTH_ERRORS[reason] ?? OAUTH_ERRORS.server_error);
    url.searchParams.delete("oauth_error");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Frontend-only demo (no backend) signs in locally; with a backend the
      // session must come from the server.
      const res = await apiCall<{ ok: boolean; token?: string; user?: any; detail?: string }>(
        "/api/auth/login",
        { email, password, role }
      );
      if (!res && !demoMode) {
        toast({ title: "Can't reach the server", description: "Check your connection and try again." });
        return;
      }
      if (res && !res.data.ok) {
        toast({
          title: res.status === 401 ? "Invalid credentials" : res.status === 429 ? "Too many attempts" : "Sign-in failed",
          description: res.data.detail ?? "Check your email/password or create an account.",
        });
        return;
      }
      const user = res?.data?.user;
      // Always use the account's real role from the server — never the tab
      // the user happened to click.
      const actualRole: Role = isRole(user?.role) ? user.role : role;
      const name: string | undefined = user?.name ?? email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
      const fields = sessionFields(user);
      login(actualRole, {
        email: email || undefined,
        name: name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined,
        ...fields,
      });
      if (fields.verificationRequired) rememberNext(next);
      router.push(afterSignIn({ role: actualRole, verificationRequired: fields.verificationRequired }, next));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to your Autopilot account.</p>
      </div>

      {oauthError && (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{oauthError}</span>
        </div>
      )}

      <div className="mb-4">
        <Label className="mb-2 block">Sign in as</Label>
        <div className="grid grid-cols-3 gap-2">
          {quickRoles.map((r) => (
            <button
              key={r.role}
              type="button"
              onClick={() => setRole(r.role)}
              aria-pressed={role === r.role}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-3 text-center text-xs font-medium transition-colors",
                role === r.role ? "border-primary bg-accent text-primary" : "hover:bg-accent"
              )}
            >
              <r.icon className="size-4" />
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="remember" checked={remember} onCheckedChange={setRemember} />
          <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
            Remember me
          </Label>
        </div>
        <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <SocialSignIn role={role} next={next} />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href={withNext("/signup", next)} className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
