"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Layers, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const MODES = {
  direct: {
    icon: Target,
    label: "Invest directly",
    title: "Pick the freelancers and agencies you believe in.",
    points: [
      "Browse verified freelancers and agencies raising for a project or growth",
      "Read their terms: project funding, or a share of eligible revenue for a set period",
      "Concentrated: your return depends on the names you choose",
    ],
  },
  index: {
    icon: Layers,
    label: "Platform Index",
    title: "Spread across high-rated talent in one move.",
    points: [
      "One investment, divided evenly across the platform's highest-rated freelancers",
      "Less riding on any single name, so one default hurts less",
      "Rebalanced as ratings change, with every holding visible in your portfolio",
    ],
  },
} as const;

/** Direct vs index: the two ways into the marketplace, with an example allocation. */
export function InvestModes() {
  const [mode, setMode] = React.useState<keyof typeof MODES>("index");
  const [amount, setAmount] = React.useState(10000);
  const m = MODES[mode];
  const slices = mode === "index" ? 20 : 3;
  const weights = mode === "index" ? Array(slices).fill(1 / slices) : [0.5, 0.3, 0.2];

  return (
    <div className="panel p-5 md:p-6">
      <div role="radiogroup" aria-label="How to invest" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {(Object.keys(MODES) as (keyof typeof MODES)[]).map((k) => {
          const Icon = MODES[k].icon;
          return (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} data-cta={`invest-mode-${k}`}
              className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition",
                mode === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="size-4" /> {MODES[k].label}
            </button>
          );
        })}
      </div>

      <div key={mode} className="animate-fade-in">
        <h3 className="mt-5 text-xl font-bold">{m.title}</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {m.points.map((p) => <li key={p} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />{p}</li>)}
        </ul>

        <label htmlFor="invest-amount" className="mt-5 flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">Example investment</span>
          <span className="text-lg font-bold">{usd(amount)}</span>
        </label>
        <input id="invest-amount" type="range" min={1000} max={100000} step={1000} value={amount} onChange={(e) => setAmount(Number(e.target.value))}
          className="mt-2 w-full accent-[hsl(var(--primary))]" />

        <div className="mt-4 flex h-10 overflow-hidden rounded-lg" aria-hidden>
          {weights.map((w, i) => (
            <div key={i} className={cn("h-full border-r border-background/60 last:border-0", i % 2 ? "bg-primary/70" : "bg-fuchsia-400/70")} style={{ width: `${w * 100}%` }} />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {mode === "index"
            ? `${usd(amount / slices)} in each of ${slices} high-rated freelancers.`
            : `For example ${weights.map((w) => usd(amount * w)).join(", ")} across three names you pick.`}
        </p>
      </div>

      <Button variant="gradient" className="mt-5 w-full" asChild>
        <Link href="/signup/investor" data-cta={`invest-${mode}`}>Explore the marketplace <ArrowRight className="size-4" /></Link>
      </Button>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">Example allocation only, not a projection. Capital at risk.</p>
    </div>
  );
}
