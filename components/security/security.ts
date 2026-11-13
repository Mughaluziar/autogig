"use client";
import { History, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import type { SectionLink } from "./section-nav";

export const SECURITY_LINKS: SectionLink[] = [
  { href: "/dashboard/security", label: "Overview", icon: ShieldCheck },
  { href: "/dashboard/security/api-keys", label: "API keys", icon: KeyRound },
  { href: "/dashboard/security/activity", label: "Activity", icon: History },
  { href: "/dashboard/security/password", label: "Password", icon: LockKeyhole },
];

export type ApiKey = {
  id: string; name: string; prefix: string; scopes: ("read" | "write")[]; status: "active" | "expired" | "revoked";
  createdAt: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null;
};

export type ActivityEntry = { id: string; agent: string; action: string; status: string; created_at?: string; time?: string };

export type Me = { user: { id: string; email: string; name: string; emailVerified?: boolean; hasPassword?: boolean } };

export type SecurityKind = "signin" | "account" | "keys" | "team" | "other";

export const KIND_LABEL: Record<SecurityKind, string> = {
  signin: "Sign-ins", account: "Account", keys: "API keys", team: "Team", other: "Other",
};

/** Which security bucket an activity-log entry belongs to. */
export function kindOf(e: ActivityEntry): SecurityKind {
  if (/^Signed in/i.test(e.action)) return "signin";
  if (/^(Account created|Email address verified|Password changed)/i.test(e.action)) return "account";
  if (e.agent === "Security" || /API key/i.test(e.action)) return "keys";
  if (e.agent === "Team") return "team";
  return "other";
}

export const entryTime = (e: ActivityEntry) => e.created_at ?? e.time ?? "";

const DAY = 86_400_000;

/** Active keys nobody has used for 30 days (or ever, 30 days after creation). */
export function staleKeys(keys: ApiKey[]): ApiKey[] {
  const cutoff = Date.now() - 30 * DAY;
  return keys.filter((k) => k.status === "active" && Date.parse(k.lastUsedAt ?? k.createdAt) < cutoff);
}
