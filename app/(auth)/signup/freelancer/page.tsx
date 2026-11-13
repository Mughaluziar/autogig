import { SignupShell } from "@/components/auth/signup-shell";
import { CountrySelect } from "@/components/auth/country-select";
import { LinkedAccountField } from "@/components/auth/linked-account-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default function FreelancerSignupPage() {
  return (
    <SignupShell
      role="freelancer"
      title="Join the freelancer pool"
      subtitle="Get matched to specs, bid in blind auctions, and get paid on delivery."
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="first">First name</Label>
          <Input id="first" autoComplete="given-name" placeholder="Priya" required />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="last">Last name</Label>
          <Input id="last" autoComplete="family-name" placeholder="Sharma" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" placeholder="priya@devpool.io" required />
      </div>
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="country">Country / Region</Label>
          <CountrySelect />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="rate">Hourly rate (USD)</Label>
          <Input id="rate" type="number" inputMode="decimal" min={0} max={10000} step="1" placeholder="28" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="skills">Primary skills</Label>
        <Input id="skills" placeholder="React, Next.js, Node, Python" required />
        <p className="text-xs text-muted-foreground">Separate skills with commas.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="experience">Years of experience</Label>
          <Select id="experience" defaultValue="" required>
            <option value="" disabled>Select</option>
            <option>0–2</option>
            <option>3–5</option>
            <option>6–10</option>
            <option>10+</option>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="availability">Availability</Label>
          <Select id="availability" defaultValue="" required>
            <option value="" disabled>Select</option>
            <option>Full-time</option>
            <option>Part-time</option>
            <option>Occasional</option>
          </Select>
        </div>
      </div>
      <LinkedAccountField />
      <div className="space-y-1.5">
        <Label htmlFor="bio">Short bio</Label>
        <Textarea id="bio" rows={3} maxLength={1000} placeholder="Tell us about your experience..." />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" minLength={8} required />
      </div>
    </SignupShell>
  );
}
