"use client";
import * as React from "react";
import Link from "next/link";
import {
  ArrowRight, CheckCircle2, CircleDashed, History, KeyRound, LogIn, ShieldAlert, Users,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionNav } from "@/components/security/section-nav";
import { EventIcon } from "@/components/security/event-icon";
import { BackendNotice, LoadError } from "@/components/security/backend-notice";
import { SERVER_FEATURES, useApi } from "@/components/security/use-api";
import {
  SECURITY_LINKS, entryTime, kindOf, staleKeys, type ActivityEntry, type ApiKey, type Me,
} from "@/components/security/security";
import type { TeamOverview } from "@/components/team/team";
import { cn, formatRelative } from "@/lib/utils";

type Check = {
  id: string;
  title: string;
  detail: string;
  state: "pass" | "warn" | "info";
  href?: string;
  cta?: string;
};

export default function SecurityPage() {
  const me = useApi<Me>("/api/auth/me");
  const keys = useApi<ApiKey[]>("/api/api-keys");
  const activity = useApi<ActivityEntry[]>("/api/audit-log");
  const team = useApi<TeamOverview>("/api/team");

  const loading = [me, keys, activity, team].some((r) => r.loading && !r.data);
  const failed = [me, keys, activity, team].find((r) => r.error);

  const events = (activity.data ?? []).filter((e) => kindOf(e) !== "other");
  const signIns = events.filter((e) => kindOf(e) === "signin");
  const monthAgo = Date.now() - 30 * 86_400_000;
  const recentSignIns = signIns.filter((e) => Date.parse(entryTime(e)) >= monthAgo);
  const activeKeys = (keys.data ?? []).filter((k) => k.status === "active");
  const forever = activeKeys.filter((k) => !k.expiresAt);
  const stale = staleKeys(keys.data ?? []);
  const admins = (team.data?.members ?? []).filter((m) => m.role === "admin");

  const checks: Check[] = [];
  if (me.data) {
    const u = me.data.user;
    checks.push(u.emailVerified === false
      ? { id: "email", title: "Verify your email", detail: "A verified email lets you recover your account and receive security alerts. Use the code we emailed you when you signed up.", state: "warn" }
      : { id: "email", title: "Email verified", detail: `Security alerts go to ${u.email}.`, state: "pass" });
    checks.push(u.hasPassword === false
      ? { id: "password", title: "Add a password", detail: "You sign in with a social account only. A password is a backup if you lose access to it.", state: "warn", href: "/dashboard/security/password", cta: "Set password" }
      : { id: "password", title: "Password set", detail: "Use a long, unique password you don't use anywhere else.", state: "pass", href: "/dashboard/security/password", cta: "Change" });
  }
  if (keys.data) {
    checks.push(forever.length
      ? { id: "expiry", title: `${forever.length} API key${forever.length > 1 ? "s" : ""} never expire${forever.length > 1 ? "" : "s"}`, detail: "Keys with an expiry limit the damage if one leaks. Replace them with expiring keys.", state: "warn", href: "/dashboard/security/api-keys", cta: "Review keys" }
      : { id: "expiry", title: "Every API key expires", detail: activeKeys.length ? "All active keys have an expiry date." : "You have no active API keys.", state: "pass" });
    checks.push(stale.length
      ? { id: "stale", title: `${stale.length} unused API key${stale.length > 1 ? "s" : ""}`, detail: "Active keys nobody has used in 30 days. Revoke what you don't need.", state: "warn", href: "/dashboard/security/api-keys", cta: "Clean up" }
      : { id: "stale", title: "No forgotten API keys", detail: "Every active key has been used in the last 30 days.", state: "pass" });
  }
  if (team.data && team.data.team.myRole === "owner") {
    checks.push(admins.length > 3
      ? { id: "admins", title: `${admins.length} team admins`, detail: "Admins can invite and remove people. Keep the list short.", state: "warn", href: "/dashboard/users", cta: "Review team" }
      : { id: "admins", title: "Admin access is limited", detail: admins.length ? `${admins.length} admin${admins.length > 1 ? "s" : ""} besides you.` : "Only you can manage your team.", state: "pass" });
  }
  checks.push({ id: "2fa", title: "Two-factor authentication", detail: "Not available yet. It isn't counted in your score.", state: "info" });

  const scored = checks.filter((c) => c.state !== "info");
  const score = scored.length ? Math.round((scored.filter((c) => c.state === "pass").length / scored.length) * 100) : 0;

  return (
    <>
      <PageHeader title="Security & API" description="Your account's security health, API access and sign-in history in one place." />
      <SectionNav links={SECURITY_LINKS} />

      {!SERVER_FEATURES ? (
        <BackendNotice feature="Security settings and API keys" />
      ) : failed ? (
        <LoadError message={failed.error!} onRetry={() => [me, keys, activity, team].forEach((r) => r.reload())} />
      ) : loading ? (
        <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted/60" />)}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div className="panel flex flex-col items-center p-6 text-center">
              <ScoreRing score={score} />
              <p className="mt-3 font-semibold">{score >= 100 ? "Looking solid" : score >= 60 ? "A few things to tighten" : "Needs attention"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {scored.filter((c) => c.state === "pass").length} of {scored.length} checks passing
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile icon={KeyRound} label="Active API keys" value={String(activeKeys.length)} hint={`${activeKeys.filter((k) => k.scopes.includes("write")).length} can write`} href="/dashboard/security/api-keys" />
              <Tile icon={LogIn} label="Sign-ins, last 30 days" value={String(recentSignIns.length)} hint={signIns[0] ? `last ${formatRelative(entryTime(signIns[0]))}` : "none recorded"} href="/dashboard/security/activity" />
              <Tile icon={Users} label="Team members" value={String((team.data?.members.length ?? 0) + 1)} hint={`${admins.length} admin${admins.length === 1 ? "" : "s"} besides the owner`} href="/dashboard/users" />
            </div>
          </div>

          <section className="panel overflow-hidden">
            <header className="border-b px-4 py-3 sm:px-5"><h2 className="font-semibold">Security checklist</h2></header>
            <ul className="divide-y">
              {checks.map((c) => (
                <li key={c.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
                  <div className="flex flex-1 items-start gap-3">
                    {c.state === "pass" ? (
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label="Passing" />
                    ) : c.state === "warn" ? (
                      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-label="Needs attention" />
                    ) : (
                      <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-label="Not scored" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{c.title}</p>
                      <p className="text-sm text-muted-foreground">{c.detail}</p>
                    </div>
                  </div>
                  {c.href && c.cta && (
                    <Button asChild size="sm" variant={c.state === "warn" ? "default" : "outline"} className="ml-8 self-start sm:ml-0 sm:self-auto">
                      <Link href={c.href}>{c.cta}</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel overflow-hidden">
            <header className="flex items-center justify-between border-b px-4 py-3 sm:px-5">
              <h2 className="flex items-center gap-2 font-semibold"><History className="size-4 text-primary" /> Recent security activity</h2>
              <Link href="/dashboard/security/activity" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                All activity <ArrowRight className="size-3" />
              </Link>
            </header>
            {events.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">Sign-ins, password changes, API keys and team changes will show up here.</p>
            ) : (
              <ul className="divide-y">
                {events.slice(0, 6).map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <EventIcon entry={e} />
                    <p className="min-w-0 flex-1 truncate text-sm">{e.action}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(entryTime(e))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Tile({ icon: Icon, label, value, hint, href }: { icon: typeof KeyRound; label: string; value: string; hint: string; href: string }) {
  return (
    <Link href={href} className="panel group flex flex-col p-4 transition-colors hover:border-primary/50">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="size-4 text-primary" /> {label}</span>
      <span className="mt-2 text-2xl font-bold">{value}</span>
      <span className="mt-auto pt-1 text-xs text-muted-foreground">{hint}</span>
    </Link>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const tone = score >= 100 ? "text-success" : score >= 60 ? "text-primary" : "text-warning";
  return (
    <div className="relative size-32" role="img" aria-label={`Security score ${score} out of 100`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle
          cx="50" cy="50" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
          className={cn("stroke-current transition-all duration-700", tone)}
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold">{score}</span>
        <Badge variant="secondary" className="mt-0.5 h-5 px-1.5 text-[10px]">score</Badge>
      </div>
    </div>
  );
}
