"use client";
import * as React from "react";
import { Save, Plus, X, MapPin, Globe, Link2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PhotoAvatar, ChangePhotoButton } from "@/components/shared/photo-picker";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { apiCall, apiGet } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

const PLATFORMS = ["Upwork", "Fiverr", "LinkedIn", "GitHub", "Portfolio site"];

export default function ProfilePage() {
  const { user, demoMode } = useAuth();
  const { toast } = useToast();

  const [available, setAvailable] = React.useState(true);
  const [rate, setRate] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [bio, setBio] = React.useState("");
  const [skills, setSkills] = React.useState<string[]>([]);
  const [newSkill, setNewSkill] = React.useState("");
  const [links, setLinks] = React.useState<Record<string, string>>({ Upwork: "", Fiverr: "", LinkedIn: "", GitHub: "", "Portfolio site": "" });

  // Start from what this account saved earlier, never from sample text.
  React.useEffect(() => {
    if (demoMode) return;
    let alive = true;
    void apiGet<{ profile?: Record<string, any> }>("/api/settings").then((d) => {
      const pr = d?.profile;
      if (!alive || !pr) return;
      if (typeof pr.title === "string") setTitle(pr.title);
      if (pr.rate !== undefined) setRate(String(pr.rate));
      if (typeof pr.location === "string") setLocation(pr.location);
      if (typeof pr.bio === "string") setBio(pr.bio);
      if (Array.isArray(pr.skills)) setSkills(pr.skills.map(String));
      if (pr.links && typeof pr.links === "object") setLinks((v) => ({ ...v, ...pr.links }));
      if (typeof pr.available === "boolean") setAvailable(pr.available);
    });
    return () => { alive = false; };
  }, [demoMode]);

  function addSkill() {
    const s = newSkill.trim();
    if (s && !skills.includes(s)) setSkills((v) => [...v, s]);
    setNewSkill("");
  }

  async function save() {
    const res = await apiCall<{ detail?: string }>("/api/settings", { profile: { title, rate, location, bio, skills, links, available } }, "PATCH");
    if (res ? res.status < 400 : demoMode) {
      toast({ title: "Profile saved", variant: "success" });
    } else {
      toast({ title: "Profile not saved", description: res?.data?.detail ?? "Can't reach the server — try again." });
    }
  }

  return (
    <>
      <PageHeader
        title="My Profile"
        description="How clients and the matching engine see you."
        actions={<Button variant="gradient" onClick={save}><Save className="size-4" /> Save profile</Button>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Identity card */}
        <div className="space-y-6">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
              <div className="relative">
                <PhotoAvatar name={user?.name ?? "User"} size={88} />
                <span className={`absolute bottom-1 right-1 size-4 rounded-full border-2 border-card ${available ? "bg-success" : "bg-muted-foreground"}`} />
              </div>
              <div>
                <p className="flex items-center justify-center gap-1.5 font-semibold">{user?.name}</p>
                <p className="text-sm text-muted-foreground">{title || "Freelancer"}</p>
                <p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" /> {location || "Location not set"}</p>
              </div>
              <Badge>{user?.role}</Badge>
              <div className="flex w-full items-center justify-between rounded-lg border p-3 text-left">
                <div><p className="text-sm font-medium">Available for work</p><p className="text-xs text-muted-foreground">Show up in client searches</p></div>
                <Switch checked={available} onCheckedChange={setAvailable} />
              </div>
              <ChangePhotoButton />
            </CardContent>
          </Card>

        </div>

        {/* Details */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle><CardDescription>Your professional headline and rate.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5"><Label>Headline</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Hourly rate ($)</Label><Input value={rate} onChange={(e) => setRate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Location</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={user?.email ?? ""} readOnly aria-describedby="email-note" /><p id="email-note" className="text-xs text-muted-foreground">Your sign-in email can't be changed here yet.</p></div>
              <div className="space-y-1.5"><Label>Bio</Label><Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} /></div>
            </CardContent>
          </Card>

          {/* Skills */}
          <Card>
            <CardHeader><CardTitle>Skills</CardTitle><CardDescription>Used by Job Radar to match you to work.</CardDescription></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {skills.map((s: any) => (
                  <Badge key={s} variant="secondary" className="gap-1 pl-2.5">
                    {s}
                    <button onClick={() => setSkills((v) => v.filter((x: any) => x !== s))}><X className="size-3" /></button>
                  </Badge>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Input placeholder="Add a skill..." value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSkill()} />
                <Button variant="outline" onClick={addSkill}><Plus className="size-4" /> Add</Button>
              </div>
            </CardContent>
          </Card>

          {/* Platform links */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="size-4" /> Platform Profiles</CardTitle><CardDescription>Where clients can find &amp; verify you.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {PLATFORMS.map((p: any) => (
                <div key={p} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm font-medium">{p}</span>
                  <Input placeholder={`https://${p.toLowerCase().replace(" ", "")}.com/you`} value={links[p]} onChange={(e) => setLinks((v) => ({ ...v, [p]: e.target.value }))} />
                </div>
              ))}
            </CardContent>
          </Card>

        </div>
      </div>
    </>
  );
}
