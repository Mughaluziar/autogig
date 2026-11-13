import { SignupShell } from "@/components/auth/signup-shell";
import { CountrySelect } from "@/components/auth/country-select";
import { LinkedAccountField } from "@/components/auth/linked-account-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export default function AdminSignupPage() {
  return (
    <SignupShell role="admin" title="Create your agency account" subtitle="Set up your autonomous agency workspace.">
      <div className="grid grid-cols-2 gap-4">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="first">First name</Label>
          <Input id="first" autoComplete="given-name" placeholder="Alex" required />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="last">Last name</Label>
          <Input id="last" autoComplete="family-name" placeholder="Morgan" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" type="email" autoComplete="email" placeholder="alex@agency.ai" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="agency">Agency name</Label>
        <Input id="agency" autoComplete="organization" placeholder="Autopilot Agency" required />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-4">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="size">Team size</Label>
          <Select id="size" defaultValue="">
            <option value="" disabled>Select</option>
            <option>Just me</option>
            <option>2–5</option>
            <option>6–20</option>
            <option>20+</option>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="country">Country / Region</Label>
          <CountrySelect />
        </div>
      </div>
      <LinkedAccountField />
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" minLength={8} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" type="password" autoComplete="new-password" placeholder="••••••••" required />
      </div>
    </SignupShell>
  );
}
