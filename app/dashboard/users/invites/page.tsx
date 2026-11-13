"use client";
import * as React from "react";
import { Inbox, RotateCw, Search, UserPlus, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { SectionNav } from "@/components/security/section-nav";
import { BackendNotice, LoadError } from "@/components/security/backend-notice";
import { ConfirmDialog, type Confirm } from "@/components/security/confirm-dialog";
import { SERVER_FEATURES, detailOf, send, useApi } from "@/components/security/use-api";
import { InviteDialog, InviteLink } from "@/components/team/invite-dialog";
import { ROLE_LABEL, TEAM_LINKS, fmtDay, type InviteStatus, type TeamOverview, type TeamRole } from "@/components/team/team";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<InviteStatus, "default" | "success" | "secondary" | "destructive"> = {
  pending: "default", accepted: "success", revoked: "secondary", expired: "destructive",
};
const FILTERS: ("all" | InviteStatus)[] = ["all", "pending", "accepted", "expired", "revoked"];

export default function InvitesPage() {
  const { toast } = useToast();
  const { data, loading, error, reload } = useApi<TeamOverview>("/api/team");
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("all");
  const [q, setQ] = React.useState("");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [link, setLink] = React.useState<{ link: string; emailed: boolean; email: string } | null>(null);
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);

  const invites = (data?.invites ?? [])
    .filter((i) => filter === "all" || i.status === filter)
    .filter((i) => !q.trim() || i.email.includes(q.trim().toLowerCase()));
  const counts = Object.fromEntries(FILTERS.map((f) => [f, f === "all" ? data?.invites.length ?? 0 : data?.invites.filter((i) => i.status === f).length ?? 0]));
  const myRole: TeamRole = data?.team.myRole ?? "owner";
  const canAssign = (role: TeamRole) => myRole === "owner" || (myRole === "admin" && role !== "admin");

  const resend = async (id: string, email: string) => {
    const res = await send<{ link: string; emailed: boolean }>(`/api/team/invites/${id}/resend`, "POST");
    if (!res.ok || !res.data) return toast({ title: "Couldn't resend", description: detailOf(res.data) });
    setLink({ ...res.data, email });
    reload();
  };

  return (
    <>
      <PageHeader
        title="Invites"
        description="Every invite you've sent, who accepted, and which links are still open."
        actions={data?.canManage && <Button variant="gradient" onClick={() => setInviteOpen(true)}><UserPlus className="size-4" /> Invite teammate</Button>}
      />
      <SectionNav links={TEAM_LINKS} />

      {!SERVER_FEATURES ? (
        <BackendNotice feature="Team invites" />
      ) : error ? (
        <LoadError message={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="h-64 animate-pulse rounded-2xl bg-muted/60" />
      ) : data && !data.canManage ? (
        <p className="text-sm text-muted-foreground">Only the team owner and admins can see invites.</p>
      ) : data ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
              <div className="inline-flex min-w-max gap-1 rounded-lg bg-muted p-1">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn("rounded-md px-3 py-1.5 text-sm font-medium capitalize", filter === f ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {f} <span className="text-xs text-muted-foreground">{counts[f]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="relative md:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email" className="pl-9" aria-label="Search invites" />
            </div>
          </div>

          {invites.length === 0 ? (
            <div className="panel flex flex-col items-center px-6 py-12 text-center">
              <Inbox className="size-8 text-muted-foreground" />
              <p className="mt-3 font-medium">{data.invites.length ? "No invites match" : "No invites yet"}</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {data.invites.length ? "Try another filter or search." : "Invites you send show up here with their status, so you know who still needs a nudge."}
              </p>
            </div>
          ) : (
            <div className="panel overflow-hidden">
              <div className="hidden grid-cols-[minmax(0,1.6fr)_100px_110px_120px_120px_170px] gap-3 border-b px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
                <span>Email</span><span>Role</span><span>Status</span><span>Sent</span><span>Expires</span><span className="text-right">Actions</span>
              </div>
              <ul className="divide-y">
                {invites.map((i) => (
                  <li key={i.id} className="grid gap-2 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,1.6fr)_100px_110px_120px_120px_170px] lg:items-center lg:gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{i.email}</p>
                      <p className="text-xs text-muted-foreground lg:hidden">
                        {ROLE_LABEL[i.role]} · sent {fmtDay(i.lastSentAt ?? i.createdAt)}{i.status === "pending" ? ` · expires ${fmtDay(i.expiresAt)}` : ""}
                      </p>
                      {i.invitedBy && <p className="hidden text-xs text-muted-foreground lg:block">by {i.invitedBy}{i.sendCount > 1 ? ` · sent ${i.sendCount}×` : ""}</p>}
                    </div>
                    <span className="hidden text-sm lg:block">{ROLE_LABEL[i.role]}</span>
                    <span><Badge variant={STATUS_BADGE[i.status]} className="capitalize">{i.status}</Badge></span>
                    <span className="hidden text-sm text-muted-foreground lg:block">{fmtDay(i.lastSentAt ?? i.createdAt)}</span>
                    <span className="hidden text-sm text-muted-foreground lg:block">{i.status === "accepted" ? `joined ${fmtDay(i.acceptedAt)}` : fmtDay(i.expiresAt)}</span>
                    <div className="flex gap-2 lg:justify-end">
                      {(i.status === "pending" || i.status === "expired") && canAssign(i.role) && i.sendCount < 5 && (
                        <Button size="sm" variant="outline" onClick={() => (i.status === "pending" ? resend(i.id, i.email) : setInviteOpen(true))}>
                          <RotateCw className="size-3.5" /> {i.status === "pending" ? "New link" : "Invite again"}
                        </Button>
                      )}
                      {i.status === "pending" && canAssign(i.role) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirm({
                            title: `Revoke the invite to ${i.email}?`, body: "The link stops working straight away.", confirmLabel: "Revoke",
                            action: async () => {
                              const res = await send(`/api/team/invites/${i.id}`, "DELETE");
                              toast(res.ok ? { title: "Invite revoked", variant: "success" } : { title: "Couldn't revoke", description: detailOf(res.data) });
                              reload();
                            },
                          })}
                        >
                          <X className="size-3.5" /> Revoke
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {data && (
        <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} teamId={data.team.id} myRole={myRole} emailEnabled={data.emailEnabled} onInvited={reload} />
      )}
      <Dialog open={!!link} onOpenChange={(v) => !v && setLink(null)}>
        {link && <InviteLink {...link} onDone={() => setLink(null)} />}
      </Dialog>
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
