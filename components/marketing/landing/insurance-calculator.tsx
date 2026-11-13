"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COVER } from "@/lib/landing";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** A 24-hour window that ticks down from a full day, to show how cover is offered. */
function WindowClock() {
  const [left, setLeft] = React.useState(COVER.windowHours * 3600 - 1);
  React.useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setLeft((s) => (s <= 1 ? COVER.windowHours * 3600 - 1 : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const h = Math.floor(left / 3600), m = Math.floor(left / 60) % 60, s = left % 60;
  return (
    <span className="font-mono tabular-nums">{String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</span>
  );
}

export function InsuranceCalculator() {
  const [order, setOrder] = React.useState(1500);
  const raw = order * COVER.maxPct;
  const cover = Math.min(raw, COVER.maxCover);
  const premium = cover * COVER.premiumPct;
  const capped = raw > COVER.maxCover;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl backdrop-blur md:p-8">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/10 px-3 py-3 text-xs sm:px-4 sm:text-sm">
        <span className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-emerald-300" /> New order · cover offer</span>
        <span className="flex items-center gap-1.5 text-emerald-200"><Timer className="size-4" /><WindowClock /></span>
      </div>

      <label htmlFor="cover-order" className="mt-6 flex items-baseline justify-between text-sm">
        <span className="text-white/75">Order value</span>
        <span className="text-2xl font-black">{usd0(order)}</span>
      </label>
      <input id="cover-order" type="range" min={100} max={5000} step={50} value={order} onChange={(e) => setOrder(Number(e.target.value))}
        className="mt-3 w-full accent-emerald-400" />

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-4">
          <p className="text-xs text-white/85">Paid to you if it&apos;s cancelled</p>
          <p className="text-2xl font-black tabular-nums sm:text-3xl">{usd0(cover)}</p>
          <p className="text-[11px] text-white/85">{capped ? "per-order maximum" : `${Math.round(COVER.maxPct * 100)}% of the order`}</p>
        </div>
        <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
          <p className="text-xs text-white/75">One-time premium</p>
          <p className="text-2xl font-black tabular-nums sm:text-3xl">{usd(premium)}</p>
          <p className="text-[11px] text-white/75">{Math.round(COVER.premiumPct * 100)}% of the cover</p>
        </div>
      </div>

      <Button size="xl" className="mt-6 w-full bg-white text-zinc-900 hover:bg-white/90" asChild>
        <Link href="/signup" data-cta="insurance-calculator">Protect my next order <ArrowRight className="size-4" /></Link>
      </Button>
    </div>
  );
}
