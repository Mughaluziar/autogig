"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bot, CheckCircle2, Loader2, LogIn, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth, dashboardHomeFor } from "@/lib/auth";
import { BackendNotice } from "@/components/security/backend-notice";
import { SERVER_FEATURES, detailOf, send } from "@/components/security/use-api";
import { ROLE_HINT, ROLE_LABEL, clearPendingInvite, fmtDay, savePendingInvite, type InviteStatus } from "@/components/team/team";

type Preview = { teamName: string; invitedBy: string; role: "admin" | "member" | "viewer"; email: string; status: InviteStatus; expiresAt: string };

export default function AcceptInvitePage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  const router = useRouter();
  const { user, restored, logout } = useAuth();
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [acceptError, setAcceptError] = React.useState<string | null>(null);
  const [joined, setJoined] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!SERVER_FEATURES) return;
    send<Preview>("/api/team/invite-preview", "POST", { token }).then((res) => {
      if (res.ok && res.data) setPreview(res.data);
      else setLoadError(detailOf(res.data, "This invite link isn't valid. Ask for a new one."));
    });
  }, [token]);

  // Remember the invite so it can be accepted after signing in.
  React.useEffect(() => {
    if (restored && !user && preview?.status === "pending") savePendingInvite(token);
  }, [restored, user, preview, token]);

  const accept = async () => {
    setBusy(true);
    setAcceptError(null);
    const res = await send<{ teamName: string }>("/api/team/accept", "POST", { token });
    setBusy(false);
    if (res.ok) {
      clearPendingInvite();
      setJoined(res.data?.teamName ?? preview?.teamName ?? "the team");
    } else {
      setAcceptError(detailOf(res.data, "Couldn't accept the invite."));
    }
  };

  const switchAccount = () => {
    savePendingInvite(token);
    logout();
    router.push("/login");
  };

  return (
    <div className="aurora flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2 font-bold">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white">
            <Bot className="size-5" />
          </span>
          Autopilot
        </Link>

        <div className="panel p-6 sm:p-8">
          {!SERVER_FEATURES ? (
            <BackendNotice feature="Accepting a team invite" />
          ) : joined ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto size-12 text-success" />
              <h1 className="mt-4 text-xl font-bold">You&apos;re on {joined}</h1>
              <p className="mt-2 text-sm text-muted-foreground">You&apos;ll find the team under Team &amp; Invites.</p>
              <Button asChild variant="gradient" className="mt-6 w-full">
                <Link href={user?.role === "admin" ? "/dashboard/users" : dashboardHomeFor(user?.role ?? "admin")}>Open my dashboard</Link>
              </Button>
            </div>
          ) : loadError ? (
            <div className="text-center">
              <AlertTriangle className="mx-auto size-10 text-warning" />
              <h1 className="mt-4 text-xl font-bold">Invite not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
              <Button asChild variant="outline" className="mt-6"><Link href="/">Go to Autopilot</Link></Button>
            </div>
          ) : !preview || !restored ? (
            <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Users className="size-6" /></div>
              <p className="mt-4 text-sm text-muted-foreground">{preview.invitedBy || "Someone"} invited you to join</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{preview.teamName}</h1>
              <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Role</span>
                  <Badge>{ROLE_LABEL[preview.role]}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{ROLE_HINT[preview.role]}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Sent to</span>
                  <span className="font-medium">{preview.email}</span>
                </div>
                {preview.status === "pending" && (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Expires</span>
                    <span>{fmtDay(preview.expiresAt)}</span>
                  </div>
                )}
              </div>

              {preview.status !== "pending" ? (
                <p role="alert" className="mt-5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                  {preview.status === "expired" ? "This invite has expired. Ask the team for a new one." :
                    preview.status === "revoked" ? "This invite was revoked." : "This invite was already used."}
                </p>
              ) : user ? (
                <>
                  <p className="mt-5 text-sm text-muted-foreground">Signed in as <span className="font-medium text-foreground">{user.email}</span></p>
                  {acceptError && <p role="alert" className="mt-3 text-sm text-destructive">{acceptError}</p>}
                  <Button variant="gradient" className="mt-4 w-full" onClick={accept} disabled={busy}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Accept invite
                  </Button>
                  <Button variant="ghost" className="mt-2 w-full" onClick={switchAccount}>Use a different account</Button>
                </>
              ) : (
                <>
                  <p className="mt-5 text-sm text-muted-foreground">
                    Sign in or create an account with the invited email. We&apos;ll keep this invite ready — accept it from Team &amp; Invites once you&apos;re in.
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Button asChild variant="gradient"><Link href="/login"><LogIn className="size-4" /> Sign in</Link></Button>
                    <Button asChild variant="outline"><Link href="/signup"><UserPlus className="size-4" /> Create account</Link></Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
