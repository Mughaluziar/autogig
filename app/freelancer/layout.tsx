"use client";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { RequireVerifiedEmail } from "@/components/auth/require-verified-email";
import { freelancerNav } from "@/components/dashboard/nav-config";

export default function FreelancerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireVerifiedEmail>
      <DashboardShell nav={freelancerNav} roleLabel="Freelancer">
        {children}
      </DashboardShell>
    </RequireVerifiedEmail>
  );
}
