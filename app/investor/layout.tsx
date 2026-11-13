"use client";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { RequireVerifiedEmail } from "@/components/auth/require-verified-email";
import { investorNav } from "@/components/dashboard/nav-config";

export default function InvestorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireVerifiedEmail>
      <DashboardShell nav={investorNav} roleLabel="Investor">
        {children}
      </DashboardShell>
    </RequireVerifiedEmail>
  );
}
