"use client";
import { Inbox, KeyRound, Users } from "lucide-react";
import type { SectionLink } from "@/components/security/section-nav";

export type TeamRole = "owner" | "admin" | "member" | "viewer";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type TeamMember = { id: string; userId: string; email: string; name: string; role: Exclude<TeamRole, "owner">; joinedAt: string };
export type TeamInvite = {
  id: string; email: string; role: Exclude<TeamRole, "owner">; status: InviteStatus; invitedBy: string;
  createdAt: string; expiresAt: string; lastSentAt: string | null; sendCount: number; acceptedAt: string | null;
};
export type Membership = { memberId: string; teamId: string; teamName: string; ownerName: string; role: TeamRole; joinedAt: string };
export type TeamOverview = {
  team: { id: string; name: string; ownerName: string; ownerEmail: string; myRole: TeamRole };
  members: TeamMember[];
  invites: TeamInvite[];
  seats: { used: number; limit: number };
  canManage: boolean;
  emailEnabled: boolean;
  memberships: Membership[];
};

export const ROLE_LABEL: Record<TeamRole, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };
export const ROLE_HINT: Record<Exclude<TeamRole, "owner">, string> = {
  admin: "Invites people and manages members and viewers.",
  member: "Works alongside you. Can't manage the team.",
  viewer: "Read-only. Can see who's on the team.",
};

export const TEAM_LINKS: SectionLink[] = [
  { href: "/dashboard/users", label: "Members", icon: Users },
  { href: "/dashboard/users/invites", label: "Invites", icon: Inbox },
  { href: "/dashboard/users/roles", label: "Roles & permissions", icon: KeyRound },
];

// An invite link opened while signed out (or as another account) is kept
// here so the Team page can offer to accept it after signing in.
const PENDING_KEY = "pending-team-invite";

export function savePendingInvite(token: string) {
  try {
    localStorage.setItem(PENDING_KEY, token);
  } catch { /* storage blocked — the link still works when reopened */ }
}

export function readPendingInvite(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch { /* ignore */ }
}

export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "—";
