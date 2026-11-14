"use client";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";

/** What the account holds, as entered at signup. Editing is not built yet, so nothing here is editable or faked. */
export default function FreelancerProfilePage() {
  const { user } = useAuth();
  const p = (user?.profile ?? {}) as { country?: string; hourlyRate?: number; skills?: string[]; experience?: string; availability?: string };
  const rows: [string, string][] = [
    ["Country", p.country ?? ""],
    ["Hourly rate", p.hourlyRate ? `$${p.hourlyRate}/h` : ""],
    ["Experience", p.experience ?? ""],
    ["Availability", p.availability ?? ""],
  ];
  return (
    <>
      <PageHeader title="My Profile" description="The details you gave when you signed up." actions={<Badge variant="secondary">Editing coming soon</Badge>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <Avatar name={user?.name ?? "Freelancer"} size={80} />
            <div>
              <p className="font-semibold">{user?.name}</p>
              <p className="break-all text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Profile & skills</CardTitle>
            <CardDescription>Used to match you with specs. Editing is not available yet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b pb-2 last:border-0">
                <span className="text-muted-foreground">{label}</span>
                <span className="text-right">{value || "Not provided"}</span>
              </div>
            ))}
            <div>
              <p className="mb-2 text-muted-foreground">Skills</p>
              <div className="flex flex-wrap gap-1.5">
                {(p.skills ?? []).length ? p.skills!.map((s) => <Badge key={s} variant="secondary">{s}</Badge>) : <span>Not provided</span>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
