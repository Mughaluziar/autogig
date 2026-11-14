"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { areaFor, canAccess, isSimulatedPath } from "@/lib/access";
import { dashboardHomeFor, useAuth } from "@/lib/auth";

const ACCOUNT_NAMES = { admin: "an agency", freelancer: "a freelancer", investor: "an investor" } as const;
const AREA_NAMES = { agency: "agency", freelancer: "freelancer" } as const;

/**
 * Renders its children only when the signed-in account type may open this URL (lib/access.ts).
 * Otherwise it renders a plain access-denied page and nothing else: the children never mount, so no
 * agency (or freelancer) page runs, fetches or renders for the wrong role. Not signed in or still
 * restoring: the shell handles that (spinner, redirect to login).
 */
export function RoleGate({ children }: { children: React.ReactNode }) {
  const { user, demoMode } = useAuth();
  const pathname = usePathname();
  if (!demoMode && user && user.modules?.simulated === false && isSimulatedPath(pathname)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6" data-testid="simulated-restricted">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldAlert className="size-6" />
          </span>
          <h1 className="text-xl font-bold">This area is by invitation</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Banking, Marketplace, Capital and the pool token are demonstrations that record entries in Autopilot&apos;s own
            ledger. They are not financial services and no real money moves. They are open only to accounts invited to a
            demonstration.
          </p>
          <Button asChild className="mt-6 w-full"><Link href={user.role === "investor" ? "/welcome" : "/dashboard/command"}>Continue</Link></Button>
        </div>
      </main>
    );
  }
  if (demoMode || !user || canAccess(user, pathname)) return <>{children}</>;
  const area = areaFor(pathname);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6" data-testid="access-denied">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="size-6" />
        </span>
        <h1 className="text-xl font-bold">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is for {area ? AREA_NAMES[area] : "other"} accounts. You&apos;re signed in with {ACCOUNT_NAMES[user.role]} account, so it isn&apos;t available to you.
        </p>
        <Button asChild className="mt-6 w-full"><Link href={dashboardHomeFor(user.role)}>Go to my dashboard</Link></Button>
      </div>
    </main>
  );
}
