"use client";
import * as React from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { API_URL } from "@/lib/api";

/** Shown on every credit screen: what this is and is not. */
export function SimNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div role="note" data-testid="credit-sim-notice" className="mb-5 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div>
        <strong>AutoGig credit is a simulation.</strong> No real money is received, lent, invested or insured, no returns are promised,
        and amounts can go down as well as up. This prototype is not a bank, lender, investment or insurance product.
        {children && <div className="mt-1 text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "bad" | "good" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-success" : ""}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Frontend-only demo, loading and "not invited" states, so no page ever shows an empty broken shell. */
export function Gate({ loaded, denied, children }: { loaded: boolean; denied: boolean; children: React.ReactNode }) {
  if (!API_URL) {
    return <EmptyState icon={<ShieldAlert className="size-6" />} title="Needs the backend"
      description="AutoGig credit keeps its records on the server, so it isn't available in the frontend-only demo." />;
  }
  if (!loaded) return <p role="status" className="py-10 text-center text-sm text-muted-foreground">Loading…</p>;
  if (denied) {
    return <EmptyState icon={<ShieldAlert className="size-6" />} title="Not available for this account"
      description="The simulated funding modules are shown only to accounts the platform owner has invited." />;
  }
  return <>{children}</>;
}

export const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
