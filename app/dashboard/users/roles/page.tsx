"use client";
import { Check, Clock, Minus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { SectionNav } from "@/components/security/section-nav";
import { ROLE_LABEL, TEAM_LINKS, type TeamRole } from "@/components/team/team";

type Cell = boolean;
type Row = { label: string; detail: string; live: boolean; grants: Record<TeamRole, Cell> };

const ROLES: TeamRole[] = ["owner", "admin", "member", "viewer"];

// `live` = enforced by the server today. Planned rows describe how roles will
// apply once teammates can open the owner's workspace; nothing in them is
// enforced (or granted) yet.
const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Team",
    rows: [
      { label: "See who's on the team", detail: "Roster, roles and join dates", live: true, grants: { owner: true, admin: true, member: true, viewer: true } },
      { label: "Invite members and viewers", detail: "Send, resend and revoke invite links", live: true, grants: { owner: true, admin: true, member: false, viewer: false } },
      { label: "Change roles and remove people", detail: "Admins manage members and viewers only", live: true, grants: { owner: true, admin: true, member: false, viewer: false } },
      { label: "Grant or remove admin", detail: "Only the owner can promote or demote admins", live: true, grants: { owner: true, admin: false, member: false, viewer: false } },
      { label: "Leave the team", detail: "Any member can leave on their own", live: true, grants: { owner: false, admin: true, member: true, viewer: true } },
    ],
  },
  {
    title: "Shared workspace (planned)",
    rows: [
      { label: "View jobs, gigs and pipeline", detail: "The owner's Job Radar, Gigs and applications", live: false, grants: { owner: true, admin: true, member: true, viewer: true } },
      { label: "Draft and send proposals", detail: "Use bid credits from the owner's plan", live: false, grants: { owner: true, admin: true, member: true, viewer: false } },
      { label: "Run and pause agents", detail: "Agent Fleet controls and guardrails", live: false, grants: { owner: true, admin: true, member: false, viewer: false } },
      { label: "See Money and invoices", detail: "Ledger, invoices and pay links", live: false, grants: { owner: true, admin: true, member: false, viewer: false } },
      { label: "Billing, plan and payouts", detail: "Upgrades, credits and payout settings", live: false, grants: { owner: true, admin: false, member: false, viewer: false } },
    ],
  },
];

export default function RolesPage() {
  return (
    <>
      <PageHeader title="Roles & permissions" description="What each role can do on your team — and what's enforced today versus planned." />
      <SectionNav links={TEAM_LINKS} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { role: "owner" as const, text: "Created the team. Full control, including admins and billing." },
          { role: "admin" as const, text: "Runs the roster with you: invites, roles for members and viewers." },
          { role: "member" as const, text: "Part of the team. Will work in your workspace once sharing is live." },
          { role: "viewer" as const, text: "Read-only. Good for accountants, clients' PMs or advisors." },
        ].map((r) => (
          <div key={r.role} className="panel p-4">
            <p className="font-semibold">{ROLE_LABEL[r.role]}</p>
            <p className="mt-1 text-sm text-muted-foreground">{r.text}</p>
          </div>
        ))}
      </div>

      <div className="space-y-6">
        {GROUPS.map((g) => (
          <section key={g.title} className="panel overflow-hidden">
            <header className="flex items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
              <h2 className="font-semibold">{g.title}</h2>
              {g.rows.every((r) => !r.live) && <Badge variant="secondary" className="gap-1"><Clock className="size-3" /> Not enforced yet</Badge>}
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-medium sm:px-5">Permission</th>
                    {ROLES.map((r) => <th key={r} className="w-20 px-2 py-2.5 text-center font-medium">{ROLE_LABEL[r]}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {g.rows.map((row) => (
                    <tr key={row.label}>
                      <td className="px-4 py-3 sm:px-5">
                        <p className="font-medium">{row.label}</p>
                        <p className="text-xs text-muted-foreground">{row.detail}</p>
                      </td>
                      {ROLES.map((r) => (
                        <td key={r} className="px-2 py-3 text-center">
                          {row.grants[r] ? (
                            <Check className={row.live ? "mx-auto size-4 text-success" : "mx-auto size-4 text-muted-foreground"} aria-label="Allowed" />
                          ) : (
                            <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="Not allowed" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Green ticks are enforced by the server today. Grey ticks show how roles will apply when teammates can open your workspace; until then
        each person works in their own.
      </p>
    </>
  );
}
