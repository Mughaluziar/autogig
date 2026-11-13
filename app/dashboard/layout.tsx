"use client";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { RequireVerifiedEmail } from "@/components/auth/require-verified-email";
import { adminNav } from "@/components/dashboard/nav-config";
import { FleetProvider } from "@/components/agents/fleet-provider";

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireVerifiedEmail>
      {/* The agent fleet's scheduler runs on every dashboard page, not just Agent Fleet. */}
      <FleetProvider>
        <DashboardShell nav={adminNav} roleLabel="Administrator">
          {children}
        </DashboardShell>
      </FleetProvider>
    </RequireVerifiedEmail>
  );
}
