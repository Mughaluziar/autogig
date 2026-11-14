"use client";
import * as React from "react";
import { AlertTriangle, BadgeCheck, Clock, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiCall } from "@/lib/api";
import type { CapitalProfile } from "@/lib/capital";

/** Shown on every capital screen so nobody mistakes the program for live money or licensed insurance. */
export function SimulatedBanner() {
  return (
    <div role="note" className="mb-4 flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <p>
        <span className="font-medium">Simulated settlement.</span> Deposits, early payments, repayments and payouts are
        recorded in the ledger, but no real money moves and no escrow is provided until a licensed settlement partner is connected. Order insurance
        is backed by the platform&apos;s protection fund, <span className="font-medium">not a licensed insurer</span>: claims are
        reviewed and paid only up to the fund&apos;s balance.
      </p>
    </div>
  );
}

export const RISK_DISCLOSURE = [
  "Early payments are repaid by freelancers after their marketplace pays them. Freelancers can default, and written-off amounts reduce the pool's value and your position.",
  "The protection fund covers only losses the marketplace itself reports (a client cancellation or refund). It is not a licensed insurer, and payouts are limited to its balance.",
  "Withdrawals depend on uncommitted cash. Capital lent out returns only as advances are repaid.",
  "Returns are not guaranteed, and past yield doesn't predict future yield. Only invest money you can afford to lose.",
];

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary"; icon: typeof Clock }> = {
  none: { label: "Not verified", variant: "secondary", icon: ShieldAlert },
  pending: { label: "In review", variant: "warning", icon: Clock },
  verified: { label: "Verified", variant: "success", icon: BadgeCheck },
  rejected: { label: "Not approved", variant: "destructive", icon: ShieldAlert },
};

export function VerificationCard({
  profile, defaultRoles, onSaved,
}: {
  profile: CapitalProfile;
  defaultRoles: ("freelancer" | "investor")[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const kyc = profile.kyc;
  const [name, setName] = React.useState(kyc.legalName);
  const [country, setCountry] = React.useState(kyc.country);
  const [roles, setRoles] = React.useState<string[]>(profile.roles.length ? profile.roles : defaultRoles);
  const [basis, setBasis] = React.useState(profile.investor.basis ?? "");
  const [accredited, setAccredited] = React.useState(profile.investor.accredited);
  const [ack, setAck] = React.useState(Boolean(profile.investor.riskAckAt));
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(kyc.status === "none" || kyc.status === "rejected");
  const status = STATUS[kyc.status] ?? STATUS.none;
  const investing = roles.includes("investor");
  const toggleRole = (role: string) => setRoles((cur) => (cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await apiCall<{ detail?: string }>("/api/capital/verification", {
      legalName: name, country: country.toUpperCase(), roles,
      investorBasis: investing ? basis || null : null, accredited: investing && accredited, riskAcknowledged: investing && ack,
    });
    setBusy(false);
    if (!res || res.status >= 400) {
      toast({ title: "Not submitted", description: res?.data?.detail ?? "Can't reach the server." });
      return;
    }
    toast({ title: "Submitted for review", description: "An operator checks your details; you'll get a notification.", variant: "success" });
    setEditing(false);
    onSaved();
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Identity verification <Badge variant={status.variant}>{status.label}</Badge>
        </CardTitle>
        <CardDescription>
          Required for early payments, insurance and investing. Reviewed by the platform operator; a regulated identity
          provider replaces this review before real money moves.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!editing ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>{kyc.legalName} · {kyc.country} · {profile.roles.join(" & ") || "no role"}</span>
            {kyc.note && <span className="text-muted-foreground">Note: {kyc.note}</span>}
            {profile.investorReasons.length > 0 && profile.roles.includes("investor") && kyc.status === "verified" && (
              <span className="text-warning">{profile.investorReasons.join(" ")}</span>
            )}
            {kyc.status !== "pending" && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Update details</Button>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <div className="space-y-1.5">
                <Label htmlFor="kyc-name">Full legal name</Label>
                <Input id="kyc-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120}
                  disabled={kyc.status === "verified"} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kyc-country">Country</Label>
                <Input id="kyc-country" value={country} onChange={(e) => setCountry(e.target.value.slice(0, 2))} placeholder="US"
                  required pattern="[A-Za-z]{2}" title="Two-letter country code" disabled={kyc.status === "verified"} />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">I want to</legend>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={roles.includes("freelancer")} onCheckedChange={() => toggleRole("freelancer")} />
                get early payment and insurance on my verified orders
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={investing} onCheckedChange={() => toggleRole("investor")} />
                invest in the funding pool
              </label>
            </fieldset>
            {investing && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="kyc-basis">Accredited or professional status, based on</Label>
                  <Select id="kyc-basis" value={basis} onChange={(e) => setBasis(e.target.value)} required>
                    <option value="" disabled>Choose</option>
                    <option value="income">Income</option>
                    <option value="net_worth">Net worth</option>
                    <option value="professional">Professional investor licence or certification</option>
                  </Select>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={accredited} onCheckedChange={(v) => setAccredited(Boolean(v))} className="mt-0.5" />
                  I confirm I meet my country&apos;s accredited or professional investor criteria.
                </label>
                <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">Risk disclosure</p>
                  <ul className="list-disc space-y-1 pl-4">{RISK_DISCLOSURE.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={ack} onCheckedChange={(v) => setAck(Boolean(v))} className="mt-0.5" />
                  I have read and understand the risks.
                </label>
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || roles.length === 0 || (investing && (!accredited || !ack || !basis))}>
                {busy && <Loader2 className="animate-spin" />} Submit for review
              </Button>
              {kyc.status !== "none" && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
