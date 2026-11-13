"use client";
import * as React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, moneyCompact } from "./format";

const PRIMARY = "hsl(var(--primary))";
const MUTED_MARK = "hsl(var(--muted-foreground) / 0.45)";
const GRID = "hsl(var(--border))";
const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

type Point = { label: string; income: number; expense: number };

function TipBox({ title, rows }: { title: string; rows: { label: string; value: number; swatch: string }[] }) {
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1 font-semibold">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted-foreground">
          <i className="size-2 rounded-sm" style={{ background: r.swatch }} />
          {r.label}
          <span className="ml-auto pl-3 font-semibold text-foreground">{money(r.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** Income over time — one series, so the hero's title names it (no legend). */
export function IncomeAreaChart({ data, height = 220 }: { data: Point[]; height?: number }) {
  const id = React.useId().replace(/:/g, "");
  return (
    <div style={{ width: "100%", height }} role="img" aria-label={`Income by month: ${data.map((d) => `${d.label} ${money(d.income)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id={`hero-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.45} />
              <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} strokeOpacity={0.6} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => (v === 0 ? "$0" : moneyCompact(v))} />
          <Tooltip
            cursor={{ stroke: PRIMARY, strokeOpacity: 0.4, strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? <TipBox title={String(label)} rows={[{ label: "Income", value: Number(payload[0].value) || 0, swatch: PRIMARY }]} /> : null}
          />
          <Area type="monotone" dataKey="income" stroke={PRIMARY} strokeWidth={2} fill={`url(#hero-${id})`}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))", fill: PRIMARY }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Income vs expenses per month — two series, legend always shown. */
export function IncomeExpenseBars({ data, height = 230 }: { data: Point[]; height?: number }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: PRIMARY }} />Income</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: MUTED_MARK }} />Expenses</span>
      </div>
      <div style={{ width: "100%", height }} role="img" aria-label={`Income and expenses by month: ${data.map((d) => `${d.label} income ${money(d.income)}, expenses ${money(d.expense)}`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} strokeOpacity={0.6} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => (v === 0 ? "$0" : moneyCompact(v))} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TipBox title={String(label)} rows={[
                    { label: "Income", value: Number(payload.find((p) => p.dataKey === "income")?.value) || 0, swatch: PRIMARY },
                    { label: "Expenses", value: Number(payload.find((p) => p.dataKey === "expense")?.value) || 0, swatch: MUTED_MARK },
                  ]} />
                ) : null}
            />
            <Bar dataKey="income" fill={PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="expense" fill={MUTED_MARK} radius={[4, 4, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Progress ring for the monthly goal. */
export function GoalRing({ pct, size = 112 }: { pct: number; size?: number }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={10} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#goal-grad)" strokeWidth={10} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} style={{ transition: "stroke-dashoffset 600ms ease" }} />
      <defs>
        <linearGradient id="goal-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="#d946ef" />
        </linearGradient>
      </defs>
    </svg>
  );
}
