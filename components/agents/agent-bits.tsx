"use client";
import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, Info, ListChecks, Loader2, MessagesSquare, PenLine, Radar, ShieldCheck, XCircle,
} from "lucide-react";
import { cn, formatRelative } from "@/lib/utils";
import {
  AUTONOMY, HEALTH_STYLE, KIND_META,
  type AgentHealth, type AgentKind, type Autonomy, type FleetRun, type RunStep,
} from "@/lib/fleet";

export const KIND_ICON: Record<AgentKind, React.ComponentType<{ className?: string }>> = {
  scout: Radar,
  writer: PenLine,
  applier: ListChecks,
  closer: MessagesSquare,
  keeper: ShieldCheck,
};

export function AgentAvatar({ kind, health, size = "md" }: { kind: AgentKind; health?: AgentHealth; size?: "sm" | "md" | "lg" }) {
  const Icon = KIND_ICON[kind];
  const dims = size === "lg" ? "size-14 rounded-2xl" : size === "sm" ? "size-8 rounded-lg" : "size-10 rounded-xl";
  const icon = size === "lg" ? "size-7" : size === "sm" ? "size-4" : "size-5";
  const active = health === "working" || health === "running" || health === "waiting";
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center text-white",
        dims,
        active ? "bg-gradient-to-br from-primary to-fuchsia-500 shadow-[0_0_24px_-6px_hsl(var(--primary)/0.7)]" : "bg-muted text-muted-foreground"
      )}
    >
      <Icon className={icon} />
      {health && (
        <span className={cn("absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-card", HEALTH_STYLE[health].dot)} />
      )}
    </span>
  );
}

export function HealthPill({ health, className }: { health: AgentHealth; className?: string }) {
  const s = HEALTH_STYLE[health];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", s.pill, className)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function KindTag({ kind }: { kind: AgentKind }) {
  return <span className={cn("text-[11px] font-medium uppercase tracking-wide", KIND_META[kind].color)}>{KIND_META[kind].label}</span>;
}

export function AutonomyPicker({
  value,
  onChange,
  compact,
}: {
  value: Autonomy;
  onChange: (v: Autonomy) => void;
  compact?: boolean;
}) {
  const current = AUTONOMY.find((a) => a.id === value)!;
  return (
    <div>
      <div role="radiogroup" aria-label="Autonomy" className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1 sm:grid-cols-4">
        {AUTONOMY.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={value === a.id}
            onClick={() => onChange(a.id)}
            className={cn(
              "rounded-lg px-2 py-1.5 text-xs font-medium transition-all",
              value === a.id
                ? "bg-gradient-to-r from-primary to-purple-500 text-white shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
            )}
          >
            {compact ? a.short : a.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{current.desc}</p>
    </div>
  );
}

const TONE_ICON = { ok: CheckCircle2, info: Info, warn: AlertTriangle, error: XCircle } as const;
const TONE_COLOR = { ok: "text-success", info: "text-muted-foreground", warn: "text-warning", error: "text-destructive" } as const;

export function StepList({ steps, live, className }: { steps: RunStep[]; live?: boolean; className?: string }) {
  return (
    <ol className={cn("space-y-1.5", className)}>
      {steps.map((s, i) => {
        const Icon = TONE_ICON[s.tone];
        return (
          <li key={`${s.at}-${i}`} className="flex items-start gap-2 text-[13px] leading-snug animate-fade-in">
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", TONE_COLOR[s.tone])} />
            <span className="min-w-0 break-words">{s.text}</span>
          </li>
        );
      })}
      {live && (
        <li className="flex items-center gap-2 text-[13px] text-primary">
          <Loader2 className="size-3.5 shrink-0 animate-spin" /> Working…
        </li>
      )}
    </ol>
  );
}

const STATUS_STYLE: Record<FleetRun["status"], string> = {
  running: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  error: "bg-destructive/15 text-destructive",
  skipped: "bg-muted text-muted-foreground",
};

export function RunStatus({ run }: { run: FleetRun }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", STATUS_STYLE[run.status])}>
      {run.status === "running" && <Loader2 className="size-3 animate-spin" />}
      {run.dryRun ? `dry run · ${run.status}` : run.status}
    </span>
  );
}

const TRIGGER_LABEL: Record<FleetRun["trigger"], string> = {
  manual: "You", schedule: "Schedule", chain: "Hand-off", copilot: "Copilot", "dry-run": "Dry run",
};

export function RunRow({ run, defaultOpen, liveSteps }: { run: FleetRun; defaultOpen?: boolean; liveSteps?: RunStep[] }) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  const steps = liveSteps ?? run.steps;
  const metrics = Object.entries(run.metrics).filter(([, v]) => v > 0);
  return (
    <div className="rounded-xl border border-border/60 bg-background/40">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 p-3 text-left">
        <AgentAvatar kind={run.kind} size="sm" health={run.status === "running" ? "working" : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{run.agentName}</span>
            <RunStatus run={run} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{run.summary}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {TRIGGER_LABEL[run.trigger]} · {formatRelative(run.startedAt)}
            {run.finishedAt && ` · ${Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000))}s`}
            {metrics.length > 0 && ` · ${metrics.map(([k, v]) => `${v} ${k}`).join(" · ")}`}
          </p>
        </div>
      </button>
      {open && steps.length > 0 && (
        <div className="border-t border-border/60 px-3 py-3">
          <StepList steps={steps} live={run.status === "running"} />
        </div>
      )}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
  icon,
  pulse,
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "primary";
  icon?: React.ReactNode;
  pulse?: boolean;
  href?: string;
}) {
  const subTone = { default: "text-muted-foreground", success: "text-success", warning: "text-warning", primary: "text-primary" }[tone];
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {sub && <p className={cn("mt-0.5 truncate text-xs", subTone)}>{sub}</p>}
    </>
  );
  const cls = cn("panel relative block min-w-0 p-4 transition-colors", href && "hover:border-primary/50", pulse && "ring-1 ring-warning/40");
  if (href) {
    return <Link href={href} className={cls}>{inner}{pulse && <span className="absolute right-3 top-3 size-2 animate-ping rounded-full bg-warning" />}</Link>;
  }
  return <div className={cls}>{inner}</div>;
}
