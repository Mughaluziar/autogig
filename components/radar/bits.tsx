"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, initials } from "@/lib/utils";
import { hueOf } from "./radar-data";

/** Circular match score. */
export function MatchRing({ score, size = 44, className }: { score: number; size?: number; className?: string }) {
  const stroke = size >= 56 ? 5 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const tone = pct >= 80 ? "text-success" : pct >= 60 ? "text-primary" : "text-muted-foreground";
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} title={`${pct}% match with your skills`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={cn("stroke-current transition-all", tone)} strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <span className={cn("absolute inset-0 flex items-center justify-center font-bold tabular-nums", tone,
        size >= 56 ? "text-sm" : "text-[11px]")}>
        {pct}<span className="text-[0.65em] font-semibold">%</span>
      </span>
      <span className="sr-only">{pct}% match</span>
    </div>
  );
}

/** Initials tile with a stable per-company color. */
export function CompanyAvatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const clean = name.replace(/[^A-Za-z0-9\u00C0-\u024F ]/g, "").trim() || "?";
  const hue = hueOf(clean);
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-xl font-semibold text-white", className)}
      style={{
        width: size, height: size, fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 70% 42%))`,
      }}
    >
      {initials(clean) || "?"}
    </span>
  );
}

export function Chip({ children, className, tone = "muted" }: {
  children: React.ReactNode; className?: string; tone?: "muted" | "primary" | "success" | "warning";
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium",
      tone === "muted" && "bg-muted text-muted-foreground",
      tone === "primary" && "bg-primary/10 text-primary",
      tone === "success" && "bg-success/15 text-success",
      tone === "warning" && "bg-warning/15 text-warning",
      className,
    )}>
      {children}
    </span>
  );
}

/** Page sub-navigation (real routes, not in-page tabs). Scrolls sideways on phones. */
export function SubNav({ items, className }: {
  items: { href: string; label: string; icon: React.ElementType; count?: number; exact?: boolean }[];
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <nav className={cn("-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", className)} aria-label="Section">
      <div className="flex w-max min-w-full gap-1 border-b">
        {items.map((it) => {
          const active = it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(`${it.href}/`);
          return (
            <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-1.5 whitespace-nowrap px-3 pb-2.5 pt-1 text-sm font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}>
              <it.icon className="size-4" />
              {it.label}
              {!!it.count && (
                <span className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{it.count}</span>
              )}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Small goal ring — applications this week vs. the weekly goal. */
export function GoalRing({ value, goal, size = 28 }: { value: number; goal: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, goal ? value / goal : 0);
  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="stroke-muted" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} strokeLinecap="round"
        className={pct >= 1 ? "stroke-success" : "stroke-primary"} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
    </svg>
  );
}

/** Long single-line feed text, broken into readable paragraphs at bullets/sentences. */
export function Prose({ text, className }: { text: string; className?: string }) {
  const parts = React.useMemo(() => {
    const bulleted = text.split(/\s(?=[•●▪◦]\s)|\s(?=-\s[A-Z])/g);
    if (bulleted.length > 2) return bulleted.map((p) => p.replace(/^[•●▪◦-]\s*/, "• "));
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
    const out: string[] = [];
    let cur = "";
    for (const s of sentences) {
      cur += s;
      if (cur.length > 280) { out.push(cur.trim()); cur = ""; }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }, [text]);
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-muted-foreground", className)}>
      {parts.map((p, i) => <p key={i} className="break-words">{p}</p>)}
    </div>
  );
}
