"use client";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StepState } from "./model";

/** One dot per step; filled when done. */
export function StepDots({ steps }: { steps: StepState[] }) {
  return (
    <ol className="flex items-center gap-1" aria-label="Onboarding steps">
      {steps.map((s) => (
        <li
          key={s.id}
          title={`${s.label}: ${s.detail}`}
          className={cn("flex size-5 items-center justify-center rounded-full border", s.done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/40")}
        >
          {s.done && <Check className="size-3" />}
          <span className="sr-only">{s.label}: {s.done ? "done" : s.detail}</span>
        </li>
      ))}
    </ol>
  );
}

export function ProgressRing({ value, size = 56 }: { value: number; size?: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${value}% onboarded`}>
      <svg viewBox="0 0 50 50" className="size-full -rotate-90">
        <circle cx="25" cy="25" r={r} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle cx="25" cy="25" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className={cn("transition-all duration-500", value >= 100 ? "stroke-success" : "stroke-primary")} strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">{value}%</span>
    </div>
  );
}
