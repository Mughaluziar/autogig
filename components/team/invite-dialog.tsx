"use client";
import * as React from "react";
import { Check, Copy, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { detailOf, send } from "@/components/security/use-api";
import { ROLE_HINT, ROLE_LABEL, type TeamRole } from "./team";

type Result = { link: string; emailed: boolean; email: string };

/** Invite by email. Afterwards it shows the invite link — the only time it's
 *  available — so it can be shared when email isn't configured. */
export function InviteDialog({
  open,
  onOpenChange,
  teamId,
  myRole,
  emailEnabled,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teamId: string;
  myRole: TeamRole;
  emailEnabled: boolean;
  onInvited: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Exclude<TeamRole, "owner">>("member");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Result | null>(null);

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setRole("member");
      setError(null);
      setResult(null);
    }
  }, [open]);

  const roles = (["admin", "member", "viewer"] as const).filter((r) => r !== "admin" || myRole === "owner");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await send<{ link: string; emailed: boolean }>("/api/team/invites", "POST", { email, role, team: teamId });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(detailOf(res.data, "Couldn't send the invite."));
      return;
    }
    setResult({ link: res.data.link, emailed: res.data.emailed, email: email.trim().toLowerCase() });
    onInvited();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {result ? (
        <InviteLink {...result} onDone={() => onOpenChange(false)} />
      ) : (
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>
              {emailEnabled
                ? "We'll email them a link to join. It expires in 7 days."
                : "Email isn't set up on this server, so you'll get a link to send them yourself. It expires in 7 days."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sam@youragency.com" />
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-medium">Role</legend>
              {roles.map((r) => (
                <label
                  key={r}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    role === r ? "border-primary bg-primary/5" : "hover:bg-accent/50"
                  )}
                >
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1 accent-[hsl(var(--primary))]" />
                  <span>
                    <span className="block text-sm font-medium">{ROLE_LABEL[r]}</span>
                    <span className="block text-xs text-muted-foreground">{ROLE_HINT[r]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="gradient" disabled={busy || !email.trim()}>
              <Send className="size-4" /> {busy ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}

export function InviteLink({ link, emailed, email, onDone }: Result & { onDone: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the field is selectable */ }
  };
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Join my team on Autopilot")}&body=${encodeURIComponent(`Here's your invite link (it expires in 7 days):\n\n${link}`)}`;
  return (
    <div>
      <DialogHeader>
        <DialogTitle>{emailed ? "Invite sent" : "Invite created"}</DialogTitle>
        <DialogDescription>
          {emailed
            ? `We emailed ${email}. You can also share this link with them directly.`
            : `Email isn't configured on this server, so nothing was emailed. Send ${email} this link — it's shown only now.`}
        </DialogDescription>
      </DialogHeader>
      <div className="flex gap-2">
        <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" className="font-mono text-xs" />
        <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Copy invite link">
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <DialogFooter className="flex-col-reverse sm:flex-row">
        {!emailed && (
          <Button asChild variant="outline">
            <a href={mailto}><Mail className="size-4" /> Open in email app</a>
          </Button>
        )}
        <Button variant="gradient" onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  );
}
