import { SignupShell } from "@/components/auth/signup-shell";
import { CountrySelect } from "@/components/auth/country-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function InvestorSignupPage() {
  return (
    <SignupShell
      role="investor"
      title="Create your investor account"
      subtitle="Explore simulated funding for verified freelancers. Demo contributions move no real money."
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="first">First name</Label>
          <Input id="first" placeholder="Alex" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last">Last name</Label>
          <Input id="last" placeholder="Morgan" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" placeholder="alex@fund.com" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="country">Country / Region</Label>
        <CountrySelect />
        <p className="text-xs text-muted-foreground">Used for your demo account profile.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="company">Fund or company (optional)</Label>
        <Input id="company" placeholder="Morgan Capital" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" placeholder="At least 8 characters" minLength={8} required />
      </div>
    </SignupShell>
  );
}
