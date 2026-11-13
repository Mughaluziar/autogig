"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EARLY_PAY } from "@/lib/landing";

// lib/landing.ts mirrors backend/app/capital/policy.py — keep in sync.
const ADVANCE_RATE = EARLY_PAY.advancePct;
const FEE_RATE = EARLY_PAY.feePct;
const MAX_ADVANCE = EARLY_PAY.maxAdvance;
const TERM_DAYS = EARLY_PAY.termDays;

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function EarlyPayCalculator() {
  const [order, setOrder] = React.useState(2500);
  const advance = Math.min(order * ADVANCE_RATE, MAX_ADVANCE);
  const fee = advance * FEE_RATE;
  const capped = order * ADVANCE_RATE > MAX_ADVANCE;

  return (
    <div className="panel p-6">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-primary text-white"><Zap className="size-4" /></span>
        <div>
          <p className="font-semibold">Don&apos;t want to wait? Get paid early.</p>
          <p className="text-xs text-muted-foreground">Drag to your order value</p>
        </div>
      </div>
      <label htmlFor="order-value" className="mt-6 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">Verified order value</span>
        <span className="text-xl font-bold">{usd(order)}</span>
      </label>
      <input
        id="order-value"
        type="range"
        min={250}
        max={10000}
        step={250}
        value={order}
        onChange={(e) => setOrder(Number(e.target.value))}
        className="mt-3 w-full accent-[hsl(var(--primary))]"
      />
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-gradient-to-br from-primary to-purple-600 p-4 text-white">
          <p className="text-xs text-white/80">In your account today</p>
          <p className="text-xl font-bold tabular-nums sm:text-2xl">{usd(advance)}</p>
          <p className="text-[11px] text-white/80">{capped ? "per-order maximum" : "70% of the order"}</p>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-xs text-muted-foreground">Flat fee</p>
          <p className="text-xl font-bold tabular-nums sm:text-2xl">{usd(fee)}</p>
          <p className="text-[11px] text-muted-foreground">3% · repay within {TERM_DAYS} days</p>
        </div>
      </div>
      <Button variant="gradient" className="mt-5 w-full" asChild>
        <Link href="/signup" data-cta="early-pay">See if my orders qualify <ArrowRight className="size-4" /></Link>
      </Button>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        For fixed-price orders confirmed by the platform&apos;s own API (Upwork, Freelancer.com) and identity-verified freelancers.
        Up to {usd(MAX_ADVANCE)} per order. Subject to eligibility; settlement is simulated during beta.
      </p>
    </div>
  );
}
