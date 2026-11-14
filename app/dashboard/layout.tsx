"use client";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { RequireVerifiedEmail } from "@/components/auth/require-verified-email";
import { RoleGate } from "@/components/auth/role-gate";
import { adminNav } from "@/components/dashboard/nav-config";
import { FleetProvider } from "@/components/agents/fleet-provider";

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireVerifiedEmail>
      {/* Agency-only URLs show an access-denied page to other roles; nothing below mounts for them. */}
      <RoleGate>
        {/* The agent fleet's scheduler runs on every dashboard page, not just Agent Fleet. */}
        <FleetProvider>
          <DashboardShell nav={adminNav} roleLabel="Administrator">
            {children}
          </DashboardShell>
        </FleetProvider>
      </RoleGate>
    </RequireVerifiedEmail>
  );
}
