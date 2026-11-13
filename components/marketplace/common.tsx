"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, Briefcase, Coins, Loader2, PieChart, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { API_URL } from "@/lib/api";
import { cn } from "@/lib/utils";
import { GRADE_TONE, KIND_LABEL, STATUS_LABEL, type Grade, type ListingKind } from "@/lib/marketplace";

export type NavLink = { href: string; label: string; exact?: boolean };

/** Horizontally scrolling section tabs (links), sized for thumbs on a phone. */
export function SectionNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Section" className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="inline-flex min-w-max gap-1 rounded-xl border bg-card/60 p-1 backdrop-blur">
        {links.map((l) => {
          const active = l.exact ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function marketLinks(base: string, opts: { raise: boolean }): NavLink[] {
  return [
    { href: base, label: "Browse", exact: true },
    { href: `${base}/portfolio`, label: "My portfolio" },
    { href: `${base}/agreements`, label: "Agreements" },
    ...(opts.raise ? [{ href: `${base}/raise`, label: "Raise funds" }, { href: `${base}/get-funded`, label: "Get money" }] : []),
  ];
}

/** Every marketplace and banking screen says plainly that no real money moves. */
export function SimulatedNote({ kind }: { kind: "market" | "banking" }) {
  return (
    <div role="note" className="mb-5 flex gap-2.5 rounded-xl border border-warning/30 bg-warning/[0.07] px-4 py-3 text-xs leading-relaxed sm:text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      {kind === "market" ? (
        <p>
          <span className="font-semibold">Simulated settlement.</span> Investments, repayments and distributions are recorded
          in the ledger, but no real money moves until a licensed partner is connected. Investments are not bank deposits,
          are <span className="font-semibold">not FDIC insured</span> and can lose value.
        </p>
      ) : (
        <p>
          <span className="font-semibold">Autopilot is not a bank.</span> Balances, transfers and statements are simulated:
          no bank or blockchain is contacted yet. Accounts, cards and financing will be provided through licensed partners,
          subject to approval. Balances are <span className="font-semibold">not FDIC insured</span>.
        </p>
      )}
    </div>
  );
}

export function NeedsBackend({ what }: { what: string }) {
  return (
    <EmptyState icon={<Coins className="size-6" />} title="Needs the backend"
      description={`${what} keeps a server-side ledger, so it isn't available in the frontend-only demo.`} />
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {label}
    </p>
  );
}

/** Page frame: header + simulated note + section nav, or the no-backend state. */
export function Frame({
  title, description, actions, links, kind, children,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
  links: NavLink[];
  kind: "market" | "banking";
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1.5 h-1 w-10 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" />
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            {title}
            <Badge variant="warning" className="text-[11px]">Simulated</Badge>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <SectionNav links={links} />
      <SimulatedNote kind={kind} />
      {API_URL ? children : <NeedsBackend what={kind === "market" ? "The marketplace" : "Banking"} />}
    </div>
  );
}

export function GradeBadge({ grade, size = "sm" }: { grade: Grade; size?: "sm" | "lg" }) {
  return (
    <span title={`Risk grade ${grade}`} className={cn(
      "inline-flex shrink-0 items-center justify-center rounded-lg font-bold ring-1",
      size === "lg" ? "size-12 text-xl" : "h-6 min-w-6 px-1.5 text-xs", GRADE_TONE[grade])}>
      {grade}
    </span>
  );
}

export function KindBadge({ kind }: { kind: ListingKind }) {
  const Icon = kind === "project_funding" ? Briefcase : PieChart;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="size-3" /> {KIND_LABEL[kind]}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/** Big number with a small caption, for hero panels. */
export function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("truncate text-xl font-bold tabular-nums tracking-tight sm:text-2xl",
        tone === "good" && "text-success", tone === "bad" && "text-destructive")}>{value}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function FundingBar({ bps, className }: { bps: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, bps / 100));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar"
      aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TrustRow() {
  const items = [
    { icon: ShieldCheck, text: "Track records verified by each marketplace's own API" },
    { icon: Sparkles, text: "Identity-verified businesses and accredited investors only" },
    { icon: Coins, text: "Every movement recorded in a double-entry ledger" },
  ];
  return (
    <ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
      {items.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-start gap-2 rounded-lg border bg-card/50 px-3 py-2">
          <Icon className="mt-0.5 size-3.5 shrink-0 text-primary" /> {text}
        </li>
      ))}
    </ul>
  );
}
