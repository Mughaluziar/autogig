"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AccountGate } from "@/components/auth/account-gate";

/**
 * Keeps accounts that haven't confirmed their email out of the dashboards:
 * they're sent to /verify-email. The backend enforces the same rule (a
 * pending session can only reach the verification endpoints). The
 * frontend-only demo has no verification.
 */
export function RequireVerifiedEmail({ children }: { children: React.ReactNode }) {
  const { user, demoMode } = useAuth();
  const router = useRouter();
  const blocked = !demoMode && !!user?.verificationRequired;

  React.useEffect(() => {
    if (blocked) router.replace("/verify-email");
  }, [blocked, router]);

  if (blocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-live="polite">
        <Loader2 className="size-6 animate-spin text-primary" />
        <span className="sr-only">Taking you to email verification…</span>
      </div>
    );
  }
  return <AccountGate>{children}</AccountGate>;
}
