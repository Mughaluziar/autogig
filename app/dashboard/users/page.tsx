"use client";
import * as React from "react";
import Link from "next/link";
import {
  ArrowRight, Crown, Info, LogOut, Mail, MailCheck, RotateCw, Trash2, UserPlus, Users, X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { SectionNav } from "@/components/security/section-nav";
import { BackendNotice, LoadError } from "@/components/security/backend-notice";
import { SERVER_FEATURES, detailOf, send, useApi } from "@/components/security/use-api";
import { InviteDialog, InviteLink } from "@/components/team/invite-dialog";
import { ConfirmDialog, type Confirm } from "@/components/security/confirm-dialog";
import {
  ROLE_LABEL, TEAM_LINKS, clearPendingInvite, fmtDay, readPendingInvite,
  type TeamMember, type TeamOverview, type TeamRole,
} from "@/components/team/team";
import { cn, formatRelative } from "@/lib/utils";

export default function TeamPage() {
  const { toast } = useToast();
  const [teamId, setTeamId] = React.useState<string | null>(null);
  const { data, loading, error, reload } = useApi<TeamOverview>(teamId ? `/api/team?team=${encodeURIComponent(teamId)}` : "/api/team");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [link, setLink] = React.useState<{ link: string; emailed: boolean; email: string } | null>(null);
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  React.useEffect(() => setPending(readPendingInvite()), []);

  const team = data?.team;
  const myRole: TeamRole = team?.myRole ?? "owner";
  const teamParam = team && team.myRole !== "owner" ? team.id : undefined;
  const pendingInvites = (data?.invites ?? []).filter((i) => i.status === "pending");

  const act = async (fn: () => Promise<{ ok: boolean; data: any }>, success: string) => {
    const res = await fn();
    if (!res.ok) {
      toast({ title: "Couldn't do that", description: detailOf(res.data) });
      return null;
    }
    toast({ title: success, variant: "success" });
    reload();
    return res.data;
  };

  const canAssign = (role: TeamRole) => myRole === "owner" || (myRole === "admin" && role !== "admin");

  const changeRole = (m: TeamMember, role: string) =>
    act(() => send(`/api/team/members/${m.id}`, "PATCH", { role, team: teamParam }), `${m.name || m.email} is now ${ROLE_LABEL[role as TeamRole].toLowerCase()}`);

  const remove = (m: TeamMember) =>
    setConfirm({
      title: `Remove ${m.name || m.email}?`,
      body: "They'll lose their place on the team. You can invite them again later.",
      action: async () => {
        await act(() => send(`/api/team/members/${m.id}${teamParam ? `?team=${teamParam}` : ""}`, "DELETE"), "Removed from the team");
      },
    });

  const resend = async (id: string, email: string) => {
    const out = await act(() => send(`/api/team/invites/${id}/resend${teamParam ? `?team=${teamParam}` : ""}`, "POST"), "New invite link created");
    if (out) setLink({ link: out.link, emailed: out.emailed, email });
  };

  const revoke = (id: string, email: string) =>
    setConfirm({
      title: `Revoke the invite to ${email}?`,
      body: "The link stops working straight away.",
      action: async () => {
        await act(() => send(`/api/team/invites/${id}${teamParam ? `?team=${teamParam}` : ""}`, "DELETE"), "Invite revoked");
      },
    });

  const leave = (id: string, name: string) =>
    setConfirm({
      title: `Leave ${name}?`,
      body: "You'll need a new invite to rejoin.",
      action: async () => {
        const ok = await act(() => send("/api/team/leave", "POST", { team: id }), `You left ${name}`);
        if (ok && teamId === id) setTeamId(null);
      },
    });

  const acceptPending = async () => {
    if (!pending) return;
    const res = await send<{ teamName: string }>("/api/team/accept", "POST", { token: pending });
    if (res.ok) {
      clearPendingInvite();
      setPending(null);
      toast({ title: `You joined ${res.data?.teamName ?? "the team"}`, variant: "success" });
      reload();
    } else {
      toast({ title: "Couldn't accept the invite", description: detailOf(res.data) });
      if (res.status === 404 || res.status === 410) {
        clearPendingInvite();
        setPending(null);
      }
    }
  };

  return (
    <>
      <PageHeader
        title="Team & Invites"
        description="Bring teammates into your workspace roster with the right role — and see every team you've joined."
        actions={
          data?.canManage && (
            <Button variant="gradient" onClick={() => setInviteOpen(true)} disabled={data.seats.used >= data.seats.limit}>
              <UserPlus className="size-4" /> Invite teammate
            </Button>
          )
        }
      />
      <SectionNav links={TEAM_LINKS} />

      {!SERVER_FEATURES ? (
        <BackendNotice feature="Team invites" />
      ) : (
        <div className="space-y-6">
          {pending && (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 text-sm">
                <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" />
                <p><span className="font-medium">You have a team invite waiting.</span> <span className="text-muted-foreground">Accept it to join that team with this account.</span></p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => { clearPendingInvite(); setPending(null); }}>Dismiss</Button>
                <Button size="sm" variant="gradient" onClick={acceptPending}>Accept invite</Button>
              </div>
            </div>
          )}

          {data && data.memberships.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm text-muted-foreground">Viewing</span>
              <div className="sm:w-72">
                <Select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value || null)} aria-label="Team">
                  <option value="">My team</option>
                  {data.memberships.map((m) => (
                    <option key={m.teamId} value={m.teamId}>{m.teamName} · {ROLE_LABEL[m.role]}</option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {error && <LoadError message={error} onRetry={reload} />}

          {loading && !data ? (
            <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/60" />)}</div>
          ) : data && team ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="panel p-4">
                  <p className="text-xs font-medium text-muted-foreground">Seats used</p>
                  <p className="mt-1 text-2xl font-bold">{data.seats.used}<span className="text-base font-medium text-muted-foreground"> / {data.seats.limit}</span></p>
                  <Progress value={(data.seats.used / data.seats.limit) * 100} className="mt-3 h-1.5" />
                  <p className="mt-2 text-xs text-muted-foreground">Members plus pending invites. The owner doesn&apos;t use a seat.</p>
                </div>
                <div className="panel p-4">
                  <p className="text-xs font-medium text-muted-foreground">On the team</p>
                  <p className="mt-1 text-2xl font-bold">{data.members.length + 1}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {(["admin", "member", "viewer"] as const).map((r) => `${data.members.filter((m) => m.role === r).length} ${r}${data.members.filter((m) => m.role === r).length === 1 ? "" : "s"}`).join(" · ")}
                  </p>
                </div>
                <div className="panel p-4">
                  <p className="text-xs font-medium text-muted-foreground">Your role on {team.name}</p>
                  <p className="mt-1 flex items-center gap-2 text-2xl font-bold">
                    {myRole === "owner" && <Crown className="size-5 text-warning" />}
                    {ROLE_LABEL[myRole]}
                  </p>
                  <Link href="/dashboard/users/roles" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    What each role can do <ArrowRight className="size-3" />
                  </Link>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">What membership does today:</span> teammates are on your roster with a role, and admins help
                  manage invites. Shared access to your jobs, money and agents isn&apos;t live yet — each person still works in their own workspace.
                </p>
              </div>

              <section className="panel overflow-hidden">
                <header className="flex items-center justify-between border-b px-4 py-3 sm:px-5">
                  <h2 className="flex items-center gap-2 font-semibold"><Users className="size-4 text-primary" /> Members</h2>
                  <span className="text-xs text-muted-foreground">{team.name}</span>
                </header>
                <ul className="divide-y">
                  <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <Avatar name={team.ownerName || team.ownerEmail} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{team.ownerName}{myRole === "owner" && <span className="text-muted-foreground"> (you)</span>}</p>
                      <p className="truncate text-xs text-muted-foreground">{team.ownerEmail}</p>
                    </div>
                    <Badge variant="warning" className="gap-1"><Crown className="size-3" /> Owner</Badge>
                  </li>
                  {data.members.map((m) => {
                    const editable = data.canManage && canAssign(m.role);
                    return (
                      <li key={m.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <Avatar name={m.name || m.email} size={36} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{m.name || m.email}</p>
                            <p className="truncate text-xs text-muted-foreground">{m.email} · joined {formatRelative(m.joinedAt)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pl-12 sm:pl-0">
                          {editable ? (
                            <div className="w-32">
                              <Select value={m.role} onChange={(e) => changeRole(m, e.target.value)} aria-label={`Role for ${m.email}`} className="h-9">
                                {(["admin", "member", "viewer"] as const).filter((r) => canAssign(r)).map((r) => (
                                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                                ))}
                              </Select>
                            </div>
                          ) : (
                            <Badge variant={m.role === "admin" ? "default" : "secondary"}>{ROLE_LABEL[m.role]}</Badge>
                          )}
                          {editable && (
                            <Button size="icon" variant="ghost" className="size-9" onClick={() => remove(m)} aria-label={`Remove ${m.email}`}>
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {data.members.length === 0 && (
                  <div className="border-t px-5 py-8 text-center">
                    <p className="text-sm font-medium">It&apos;s just you so far</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Invite a VA, a partner or a subcontractor and give them the role that fits.</p>
                    {data.canManage && (
                      <Button className="mt-4" variant="outline" onClick={() => setInviteOpen(true)}><UserPlus className="size-4" /> Invite your first teammate</Button>
                    )}
                  </div>
                )}
              </section>

              {data.canManage && (
                <section className="panel overflow-hidden">
                  <header className="flex items-center justify-between border-b px-4 py-3 sm:px-5">
                    <h2 className="flex items-center gap-2 font-semibold"><Mail className="size-4 text-primary" /> Pending invites</h2>
                    <Link href="/dashboard/users/invites" className="text-xs font-medium text-primary hover:underline">All invites</Link>
                  </header>
                  {pendingInvites.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-muted-foreground">No invites waiting on a reply.</p>
                  ) : (
                    <ul className="divide-y">
                      {pendingInvites.map((i) => (
                        <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{i.email}</p>
                            <p className="text-xs text-muted-foreground">
                              {ROLE_LABEL[i.role]} · sent {formatRelative(i.lastSentAt ?? i.createdAt)} · expires {fmtDay(i.expiresAt)}
                            </p>
                          </div>
                          {canAssign(i.role) && (
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" onClick={() => resend(i.id, i.email)}><RotateCw className="size-3.5" /> New link</Button>
                              <Button size="sm" variant="ghost" onClick={() => revoke(i.id, i.email)}><X className="size-3.5" /> Revoke</Button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {data.memberships.length > 0 && (
                <section className="panel overflow-hidden">
                  <header className="border-b px-4 py-3 sm:px-5">
                    <h2 className="font-semibold">Teams you&apos;ve joined</h2>
                  </header>
                  <ul className="divide-y">
                    {data.memberships.map((m) => (
                      <li key={m.memberId} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{m.teamName}</p>
                          <p className="truncate text-xs text-muted-foreground">Owner {m.ownerName || "—"} · {ROLE_LABEL[m.role]} since {fmtDay(m.joinedAt)}</p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setTeamId(m.teamId)} className={cn(teamId === m.teamId && "hidden")}>View</Button>
                        <Button size="sm" variant="outline" onClick={() => leave(m.teamId, m.teamName)}><LogOut className="size-3.5" /> Leave</Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : null}
        </div>
      )}

      {team && (
        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          teamId={team.id}
          myRole={myRole}
          emailEnabled={!!data?.emailEnabled}
          onInvited={reload}
        />
      )}
      <Dialog open={!!link} onOpenChange={(v) => !v && setLink(null)}>
        {link && <InviteLink {...link} onDone={() => setLink(null)} />}
      </Dialog>
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

