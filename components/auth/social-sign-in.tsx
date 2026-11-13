"use client";
import * as React from "react";
import { API_URL, apiGet } from "@/lib/api";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { AppleMark, GitHubMark, GoogleMark, MicrosoftMark } from "./brand-icons";

type ProviderInfo = { id: string; name: string; configured: boolean };
type ProvidersResponse = {
  providers: ProviderInfo[];
  showUnconfigured: boolean;
  emailVerification: { enforced: boolean; delivery: "email" | "dev" | "off" };
};

const MARKS: Record<string, React.ComponentType<{ className?: string }>> = {
  google: GoogleMark, apple: AppleMark, github: GitHubMark, microsoft: MicrosoftMark,
};

/** Why a social sign-in sent the visitor back to /login (?oauth_error=…). */
export const OAUTH_ERRORS: Record<string, string> = {
  not_configured: "That sign-in option isn't set up on this server yet. Use email and password instead.",
  expired: "The sign-in took too long or was already used. Try again.",
  denied: "You cancelled the sign-in, so nothing changed.",
  rejected: "The provider didn't accept the sign-in. Try again.",
  provider_error: "The provider reported an error. Try again.",
  unreachable: "We couldn't reach the provider. Try again in a moment.",
  no_email: "The provider didn't share an email address. Use another option or sign up with email.",
  email_conflict: "An account with that email already exists, and this provider couldn't confirm you own the address. Sign in with your password instead.",
  retired: "Client accounts have been retired. To pay an invoice, use the pay link you were sent.",
  server_error: "Something went wrong on our side. Try again.",
};

let cache: Promise<ProvidersResponse | null> | null = null;
function loadProviders() {
  cache ??= apiGet<ProvidersResponse>("/api/auth/providers").then((r) => {
    if (!r) cache = null; // retry on the next mount
    return r;
  });
  return cache;
}

/**
 * Google / Apple / GitHub / Microsoft buttons. Each is a plain link to the
 * backend, which runs the OAuth flow and returns to /auth/callback. Only
 * providers configured on the server are offered; outside production the
 * rest appear disabled so it's clear what can be switched on.
 */
export function SocialSignIn({
  role, next, label = "Continue with", position = "below",
}: {
  role?: Role;
  next?: string;
  label?: string;
  /** "above" the email form (divider after the buttons) or "below" it. */
  position?: "above" | "below";
}) {
  const [data, setData] = React.useState<ProvidersResponse | null>(null);

  React.useEffect(() => {
    if (!API_URL) return;
    let live = true;
    loadProviders().then((r) => live && setData(r));
    return () => {
      live = false;
    };
  }, []);

  if (!data) return null;
  const shown = data.providers.filter((p) => p.configured || data.showUnconfigured);
  if (shown.length === 0) return null;
  const anyOff = shown.some((p) => !p.configured);

  const href = (id: string) => {
    const params = new URLSearchParams();
    if (role) params.set("role", role);
    if (next) params.set("next", next);
    const q = params.toString();
    return `/api/auth/oauth/${id}/start${q ? `?${q}` : ""}`;
  };

  const divider = (text: string) => (
    <div className="my-6 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">{text}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );

  return (
    <div>
      {position === "below" && divider("or")}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {shown.map((p) => {
          const Mark = MARKS[p.id];
          const inner = (
            <>
              {Mark && <Mark className="size-[18px] shrink-0" />}
              <span className="truncate">{label} {p.name}</span>
            </>
          );
          const base = "flex h-11 items-center justify-center gap-2.5 rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors";
          return p.configured ? (
            <a key={p.id} href={href(p.id)} className={cn(base, "hover:border-primary/50 hover:bg-accent")}>
              {inner}
            </a>
          ) : (
            <span key={p.id} aria-disabled="true" title={`${p.name} sign-in isn't configured on this server`}
              className={cn(base, "cursor-not-allowed opacity-45")}>
              {inner}
            </span>
          );
        })}
      </div>
      {anyOff && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Greyed-out options aren&apos;t configured on this server yet (shown outside production only).
        </p>
      )}
      {position === "above" && divider("or use your email")}
    </div>
  );
}
