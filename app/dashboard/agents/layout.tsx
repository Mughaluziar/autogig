"use client";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { FleetNav } from "@/components/agents/fleet-nav";
import { CopilotLauncher } from "@/components/agents/copilot";

/** Agent Fleet pages share the fleet from app/dashboard/layout.tsx (one
 *  scheduler for the whole dashboard); this adds the fleet nav and Copilot. */
export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  return (
    <>
      <FleetNav />
      {children}
      {/* The control center shows Copilot inline on desktop. */}
      <CopilotLauncher hideOnDesktop={pathname === "/dashboard/agents"} userName={user?.name} />
    </>
  );
}
