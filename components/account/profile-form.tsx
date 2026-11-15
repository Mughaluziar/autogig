"use client";
import * as React from "react";
import { Mail, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiCall } from "@/lib/api";
import { sessionFields, useAuth } from "@/lib/auth";

type Msg = { ok: boolean; text: string } | null;

/** Correct your display name, and change your sign-in email with proof of the new address. */
export function ProfileForm() {
  const { user, login, demoMode } = useAuth();
  const needsPassword = user?.hasPassword !== false;
  const [name, setName] = React.useState(user?.name ?? "");
  const [nameMsg, setNameMsg] = React.useState<Msg>(null);
  const [newEmail, setNewEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [stage, setStage] = React.useState<"form" | "code">("form");
  const [devCode, setDevCode] = React.useState("");
  const [emailMsg, setEmailMsg] = React.useState<Msg>(null);
  const [busy, setBusy] = React.useState("");
  React.useEffect(() => setName(user?.name ?? ""), [user?.name]);
  if (!user || demoMode) return null;

  const detail = (d: unknown) => (typeof d === "string" ? d : "Something went wrong. Try again.");

  async function saveName() {
    setBusy("name"); setNameMsg(null);
    const res = await apiCall<{ user?: Record<string, unknown>; detail?: unknown }>("/api/me/profile", { name }, "PATCH");
    setBusy("");
    if (res && res.status < 400 && user) { login(user.role, { ...user, ...sessionFields(res.data.user) }); setNameMsg({ ok: true, text: "Name updated." }); }
    else setNameMsg({ ok: false, text: res ? detail(res.data.detail) : "Can't reach the server." });
  }

  async function requestChange() {
    setBusy("email"); setEmailMsg(null);
    const res = await apiCall<{ devCode?: string; sent?: boolean; detail?: unknown }>("/api/me/email/change", { newEmail, password: needsPassword ? password : undefined });
    setBusy("");
    if (res && res.status < 400) { setStage("code"); setDevCode(res.data.devCode ?? ""); setPassword(""); setEmailMsg({ ok: true, text: `We sent a 6-digit code to ${newEmail}. Your email stays the same until you enter it.` }); }
    else setEmailMsg({ ok: false, text: res ? detail(res.data.detail) : "Can't reach the server." });
  }

  async function confirm() {
    setBusy("confirm"); setEmailMsg(null);
    const res = await apiCall<{ user?: Record<string, unknown>; detail?: unknown }>("/api/me/email/confirm", { code });
    setBusy("");
    if (res && res.status < 400 && user) {
      login(user.role, { ...user, ...sessionFields(res.data.user) });
      setStage("form"); setNewEmail(""); setCode(""); setDevCode("");
      setEmailMsg({ ok: true, text: "Email changed. Other devices were signed out." });
    } else setEmailMsg({ ok: false, text: res ? detail(res.data.detail) : "Can't reach the server." });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="size-5" /> Your name</CardTitle>
          <CardDescription>Shown to people you work with. Records already shared with others (a signed contract) keep the name they were created with.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="profile-name">Full name</Label><Input id="profile-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
          <Button onClick={saveName} disabled={busy === "name" || !name.trim() || name.trim() === user.name} data-testid="name-save">Save name</Button>
          {nameMsg && <p className={`text-sm ${nameMsg.ok ? "text-muted-foreground" : "text-destructive"}`} role="status" data-testid="name-message">{nameMsg.text}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="size-5" /> Sign-in email</CardTitle>
          <CardDescription>Currently <strong>{user.email}</strong>. To change it we send a code to the new address, and you confirm with your password. All other devices are signed out afterwards.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {stage === "form" ? (
            <>
              <div className="space-y-1.5"><Label htmlFor="new-email">New email address</Label><Input id="new-email" type="email" autoComplete="off" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></div>
              {needsPassword && <div className="space-y-1.5"><Label htmlFor="email-pw">Current password</Label><Input id="email-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>}
              <Button onClick={requestChange} disabled={busy === "email" || !newEmail.trim() || (needsPassword && !password)} data-testid="email-request">Send code to new address</Button>
            </>
          ) : (
            <>
              <div className="space-y-1.5"><Label htmlFor="email-code">6-digit code</Label><Input id="email-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} /></div>
              {devCode && <p className="text-xs text-muted-foreground" data-testid="email-devcode">Development only (no email provider): your code is <code>{devCode}</code>.</p>}
              <div className="flex gap-2">
                <Button onClick={confirm} disabled={busy === "confirm" || code.replace(/\D/g, "").length < 6} data-testid="email-confirm">Confirm new email</Button>
                <Button variant="outline" onClick={() => { setStage("form"); setCode(""); setDevCode(""); setEmailMsg(null); }}>Cancel</Button>
              </div>
            </>
          )}
          {emailMsg && <p className={`text-sm ${emailMsg.ok ? "text-muted-foreground" : "text-destructive"}`} role="status" data-testid="email-message">{emailMsg.text}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
