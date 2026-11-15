"use client";
import * as React from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiCall } from "@/lib/api";
import { sessionFields, useAuth } from "@/lib/auth";
import Link from "next/link";

type Profile = { country?: string; hourlyRate?: number; skills?: string[]; experience?: string; availability?: string; bio?: string };

/** The freelancer's profile: name, rate, skills, availability and bio, editable. Email has its own verified flow (Account & data). */
export default function FreelancerProfilePage() {
  const { user, login, demoMode } = useAuth();
  const p = (user?.profile ?? {}) as Profile;
  const [country, setCountry] = React.useState(p.country ?? "");
  const [rate, setRate] = React.useState(p.hourlyRate ? String(p.hourlyRate) : "");
  const [skills, setSkills] = React.useState((p.skills ?? []).join(", "));
  const [experience, setExperience] = React.useState(p.experience ?? "");
  const [availability, setAvailability] = React.useState(p.availability ?? "");
  const [bio, setBio] = React.useState(p.bio ?? "");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    const q = (user?.profile ?? {}) as Profile;
    setCountry(q.country ?? ""); setRate(q.hourlyRate ? String(q.hourlyRate) : ""); setSkills((q.skills ?? []).join(", "));
    setExperience(q.experience ?? ""); setAvailability(q.availability ?? ""); setBio(q.bio ?? "");
  }, [user?.profile]);

  async function save() {
    if (!user) return;
    setSaving(true); setMsg(null);
    const profile = {
      country, experience, availability, bio,
      hourlyRate: rate.trim() === "" ? null : Number(rate),
      skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
    };
    const res = await apiCall<{ user?: Record<string, unknown>; detail?: unknown }>("/api/me/profile", { profile }, "PATCH");
    setSaving(false);
    if (res && res.status < 400) { login(user.role, { ...user, ...sessionFields(res.data.user) }); setMsg({ ok: true, text: "Profile saved." }); }
    else setMsg({ ok: false, text: res && typeof res.data.detail === "string" ? res.data.detail : "Couldn't save. Check the values and try again." });
  }

  return (
    <>
      <PageHeader title="My Profile" description="Used to match you with specs and to personalise your proposal drafts." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <Avatar name={user?.name ?? "Freelancer"} size={80} />
            <div>
              <p className="font-semibold">{user?.name}</p>
              <p className="break-all text-sm text-muted-foreground">{user?.email}</p>
            </div>
            <Button asChild variant="outline" size="sm"><Link href="/freelancer/your-data">Change name or email</Link></Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Profile &amp; skills</CardTitle>
            <CardDescription>Only you and the agencies you bid to see this. Nothing here is sent to a marketplace for you.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="pf-country">Country</Label><Input id="pf-country" value={country} maxLength={64} onChange={(e) => setCountry(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="pf-rate">Hourly rate (USD)</Label><Input id="pf-rate" type="number" min={0} max={10000} value={rate} onChange={(e) => setRate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="pf-exp">Years of experience</Label>
                <Select id="pf-exp" value={experience} onChange={(e) => setExperience(e.target.value)}><option value="">Not set</option><option>0–2</option><option>3–5</option><option>6–10</option><option>10+</option></Select></div>
              <div className="space-y-1.5"><Label htmlFor="pf-avail">Availability</Label>
                <Select id="pf-avail" value={availability} onChange={(e) => setAvailability(e.target.value)}><option value="">Not set</option><option>Full-time</option><option>Part-time</option><option>Occasional</option></Select></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="pf-skills">Skills (comma separated)</Label><Input id="pf-skills" value={skills} onChange={(e) => setSkills(e.target.value)} />
              <div className="flex flex-wrap gap-1.5 pt-1">{skills.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30).map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}</div></div>
            <div className="space-y-1.5"><Label htmlFor="pf-bio">Short bio</Label><Textarea id="pf-bio" rows={4} maxLength={1000} value={bio} onChange={(e) => setBio(e.target.value)} /></div>
            <Button onClick={save} disabled={saving || demoMode} data-testid="profile-save">Save profile</Button>
            {msg && <p className={msg.ok ? "text-muted-foreground" : "text-destructive"} role="status" data-testid="profile-message">{msg.text}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
