"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, History, LayoutTemplate, MoonStar, OctagonX, Plus, ShieldCheck, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inQuietHours, pendingApprovals } from "@/lib/fleet";
import { useFleet } from "./fleet-provider";

const LINKS = [
  { href: "/dashboard/agents", label: "Control center", icon: Workflow, exact: true },
  { href: "/dashboard/agents/approvals", label: "Approvals", icon: Bell },
  { href: "/dashboard/agents/runs", label: "Runs", icon: History },
  { href: "/dashboard/agents/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/dashboard/agents/guardrails", label: "Guardrails", icon: ShieldCheck },
];

export function FleetNav() {
  const pathname = usePathname();
  const { fleet, updateGuardrails, ready } = useFleet();
  const pending = pendingApprovals(fleet).length;
  const quiet = inQuietHours(fleet.guardrails);
  return (
    <div className="mb-5 space-y-3">
      <nav aria-label="Agent Fleet" className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1">
        {LINKS.map((l) => {
          const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <l.icon className="size-4" />
              {l.label}
              {l.href.endsWith("approvals") && pending > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1 text-[11px] font-bold text-warning-foreground">{pending}</span>
              )}
            </Link>
          );
        })}
        <Button size="sm" variant="gradient" className="ml-auto h-8 shrink-0 rounded-full" asChild>
          <Link href="/dashboard/agents/new"><Plus /> Deploy agent</Link>
        </Button>
      </nav>
      {ready && fleet.guardrails.killSwitch && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <OctagonX className="size-5 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1"><b>Kill switch is on.</b> Every agent is stopped, including manual runs.</span>
          <Button size="sm" variant="outline" onClick={() => updateGuardrails({ killSwitch: false })}>Turn off</Button>
        </div>
      )}
      {ready && !fleet.guardrails.killSwitch && quiet && (
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          <MoonStar className="size-4 shrink-0 text-primary" />
          Quiet hours until {fleet.guardrails.quietHours.end}. Scheduled runs wait; you can still run agents yourself.
        </div>
      )}
    </div>
  );
}
