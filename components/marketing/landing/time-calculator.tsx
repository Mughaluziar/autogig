"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Slider({ id, label, value, display, min, max, step, onChange }: {
  id: string; label: string; value: number; display: string; min: number; max: number; step: number; onChange: (n: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold tabular-nums">{display}</span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[hsl(var(--primary))]" />
    </div>
  );
}

/** What hunting and writing proposals costs the visitor today, from their own numbers. */
export function TimeCalculator() {
  const [perWeek, setPerWeek] = React.useState(10);
  const [minutes, setMinutes] = React.useState(30);
  const [rate, setRate] = React.useState(50);
  const hours = (perWeek * 52) / 12 * (minutes / 60);
  const value = hours * rate;

  return (
    <div className="panel h-full p-6">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-primary text-white"><Hourglass className="size-4" /></span>
        <div>
          <p className="font-semibold">What does searching and pitching cost you?</p>
          <p className="text-xs text-muted-foreground">Your numbers, your answer</p>
        </div>
      </div>
      <div className="mt-6 space-y-5">
        <Slider id="calc-week" label="Proposals you send a week" value={perWeek} display={String(perWeek)} min={1} max={40} step={1} onChange={setPerWeek} />
        <Slider id="calc-min" label="Minutes finding the job and writing each one" value={minutes} display={`${minutes} min`} min={10} max={90} step={5} onChange={setMinutes} />
        <Slider id="calc-rate" label="Your hourly rate" value={rate} display={`${usd(rate)}/h`} min={15} max={200} step={5} onChange={setRate} />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-xs text-muted-foreground">Hours a month</p>
          <p className="text-2xl font-black tabular-nums sm:text-3xl">{hours.toFixed(0)}</p>
          <p className="text-[11px] text-muted-foreground">spent hunting and pitching</p>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-primary to-purple-600 p-4 text-white">
          <p className="text-xs text-white/80">Billable time it costs</p>
          <p className="text-2xl font-black tabular-nums sm:text-3xl">{usd(value)}</p>
          <p className="text-[11px] text-white/80">every month</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Autopilot does the searching and the first draft. You spend your time reviewing the best matches, not finding them.
      </p>
      <Button variant="gradient" className="mt-5 w-full" asChild>
        <Link href="/signup" data-cta="time-calculator">Get my hours back <ArrowRight className="size-4" /></Link>
      </Button>
    </div>
  );
}
