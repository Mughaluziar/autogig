"use client";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { RequireVerifiedEmail } from "@/components/auth/require-verified-email";
import { RoleGate } from "@/components/auth/role-gate";
import { investorNav } from "@/components/dashboard/nav-config";

export default function InvestorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireVerifiedEmail>
      {/* Simulated-module URLs show an explanation when the server has not invited this account. */}
      <RoleGate>
        <DashboardShell nav={investorNav} roleLabel="Investor">
          {children}
        </DashboardShell>
      </RoleGate>
    </RequireVerifiedEmail>
  );
}
