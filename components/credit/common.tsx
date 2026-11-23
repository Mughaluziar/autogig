"use client";
import * as React from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { API_URL } from "@/lib/api";

/** Shown on every credit screen: what this is and is not. */
export function SimNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div role="note" data-testid="credit-sim-notice" className="mb-5 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs sm:px-4 sm:py-3 sm:text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div>
        <strong>AutoGig credit is a simulation.</strong> No real money is received, lent, invested or insured, no returns are promised, and
        amounts can go down as well as up.
        {children && <span className="text-muted-foreground"> {children}</span>}
      </div>
    </div>
  );
}

/** Every figure card carries its own "Demo" tag, so a screenshot of one card still cannot pass for a real balance. */
export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "bad" | "good" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">Demo</span>
        </div>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-success" : ""}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Frontend-only demo, loading and "not invited" states, so no page ever shows an empty broken shell. */
export function Gate({ loaded, denied, failed, retry, children }: {
  loaded: boolean; denied: boolean; failed: boolean; retry: () => void; children: React.ReactNode;
}) {
  if (!API_URL) {
    return <EmptyState icon={<ShieldAlert className="size-6" />} title="Needs the backend"
      description="AutoGig credit keeps its records on the server, so it isn't available in the frontend-only demo." />;
  }
  if (!loaded) return <p role="status" className="py-10 text-center text-sm text-muted-foreground">Loading…</p>;
  if (denied) {
    return <EmptyState icon={<ShieldAlert className="size-6" />} title="Not available for this account"
      description="Your account does not have permission to view this credit page." />;
  }
  if (failed) {
    return <div role="alert" className="space-y-3 rounded-lg border p-4">
      <p>Credit data could not be loaded. Try again.</p>
      <Button onClick={retry} size="sm">Retry</Button>
    </div>;
  }
  return <>{children}</>;
}

export const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
