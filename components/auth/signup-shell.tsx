"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAuth, dashboardHomeFor, sessionFields, type Role } from "@/lib/auth";
import { apiCall, apiGet } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { SIGNUP_EMAIL_KEY } from "@/lib/landing";
import { nextFromLocation, rememberNext, withNext } from "@/lib/safe-next";
import { SocialSignIn } from "./social-sign-in";
import { normalizeLinkedAccount } from "./linked-account-field";
import { VERIFICATION_KEY } from "./verification";

type SignupResponse = {
  ok?: boolean;
  token?: string;
  user?: Record<string, any>;
  detail?: string;
  verification?: { required: boolean; sent?: boolean; devCode?: string; detail?: string; retryAfterSeconds?: number };
};

/** Reads the optional profile fields a signup form may render, by element id. */
function readProfile(form: HTMLFormElement): { profile: Record<string, unknown>; linkError?: string; linkPlatform?: string } {
  const val = (id: string) => (form.querySelector(`#${id}`) as HTMLInputElement | null)?.value?.trim() || "";
  const profile: Record<string, unknown> = {};
  const country = val("country");
  if (country) profile.country = country;
  const rate = val("rate");
  if (rate && Number.isFinite(Number(rate))) profile.hourlyRate = Number(rate);
  const skills = val("skills");
  if (skills) profile.skills = skills.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
  for (const [id, key] of [["experience", "experience"], ["availability", "availability"], ["size", "teamSize"], ["bio", "bio"]] as const) {
    const v = val(id);
    if (v) profile[key] = v;
  }
  const linkPlatform = val("linkPlatform");
  const linkUrl = val("linkUrl");
  if (linkPlatform && linkUrl) {
    const result = normalizeLinkedAccount(linkPlatform, linkUrl);
    if (result.error) return { profile, linkError: result.error, linkPlatform };
    profile.linkedAccount = { platform: linkPlatform, url: result.url };
  }
  return { profile, linkPlatform: linkUrl ? linkPlatform : undefined };
}

export function SignupShell({
  role,
  title,
  subtitle,
  children,
}: {
  role: Role;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { login, demoMode } = useAuth();
  const { toast } = useToast();
  const [agree, setAgree] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  // ?next= — where to go once the account is ready (e.g. checkout).
  const [next, setNext] = React.useState("");
  React.useEffect(() => setNext(nextFromLocation()), []);

  // Prefill the email the visitor typed on the landing page.
  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SIGNUP_EMAIL_KEY);
      const input = document.getElementById("email") as HTMLInputElement | null;
      if (saved && input && !input.value) input.value = saved;
    } catch { /* storage blocked */ }
  }, []);

  return (
    <div>
      <Button variant="ghost" size="sm" className="-ml-2 mb-4" asChild>
        <Link href={withNext("/signup", next)}>
          <ArrowLeft className="size-4" /> All account types
        </Link>
      </Button>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <SocialSignIn role={role} next={next} label="Sign up with" position="above" />

      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const val = (id: string) =>
            (form.querySelector(`#${id}`) as HTMLInputElement | null)?.value?.trim() || "";
          const first = val("first");
          const last = val("last");
          const name = [first, last].filter(Boolean).join(" ") || undefined;
          const email = val("email") || undefined;
          const company = val("agency") || val("company") || undefined;
          const password = val("password");
          const confirm = val("confirm");
          if (confirm && password !== confirm) {
            toast({ title: "Passwords don't match" });
            return;
          }
          const { profile, linkError, linkPlatform } = readProfile(form);
          if (linkError) {
            toast({ title: "Check your linked account", description: linkError });
            (form.querySelector("#linkUrl") as HTMLInputElement | null)?.focus();
            return;
          }
          setLoading(true);
          try {
            // Frontend-only demo (no backend) continues with a local session;
            // with a backend the account and session come from the server.
            // The Terms/Privacy versions the person is agreeing to are recorded by the server with the account.
            const legal = await apiGet<{ terms: string; privacy: string; required: boolean }>("/api/legal/versions");
            const res = await apiCall<SignupResponse>("/api/auth/signup", {
              name: name ?? "", email: email ?? "", password, role, company: company ?? "", profile,
              ...(legal?.required ? { acceptedTerms: { terms: legal.terms, privacy: legal.privacy } } : {}),
            });
            if (!res && !demoMode) {
              toast({ title: "Can't reach the server", description: "Check your connection and try again." });
              return;
            }
            if (res && res.status >= 400) {
              toast({
                title: res.status === 409 ? "Email already registered" : "Couldn't create account",
                description: res.data.detail ?? "Please try again.",
              });
              return;
            }
            const user = res?.data?.user;
            const fields = sessionFields(user);
            login(role, { name, email, company, ...fields });
            try {
              sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
            } catch { /* storage blocked */ }
            if (fields.verificationRequired) {
              try {
                sessionStorage.setItem(VERIFICATION_KEY, JSON.stringify({ ...res?.data?.verification, at: Date.now() }));
              } catch { /* the page asks for a fresh code instead */ }
              rememberNext(next);
              router.push(withNext("/verify-email", next));
              return;
            }
            if (res?.data?.ok) {
              toast({ title: "Account created", description: "Your workspace is ready.", variant: "success" });
            }
            router.push(next || (role === "admin" ? "/dashboard/command" : dashboardHomeFor(role)));
          } finally {
            setLoading(false);
          }
        }}
      >
        {children}
        <div className="flex items-start gap-2">
          <Checkbox id="agree" checked={agree} onCheckedChange={setAgree} />
          <Label htmlFor="agree" className="text-sm font-normal text-muted-foreground">
            I agree to the{" "}
            <Link href="/legal/terms" className="text-primary hover:underline">Terms</Link> and{" "}
            <Link href="/legal/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </Label>
        </div>
        <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={!agree || loading}>
          {loading ? "Creating account…" : "Create account"}
        </Button>
        {!demoMode && (
          <p className="text-center text-xs text-muted-foreground">
            We&apos;ll email you a 6-digit code to confirm your address.
          </p>
        )}
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={withNext("/login", next)} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
