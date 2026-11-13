"use client";
/**
 * Analytics chart pieces. Palette (validated with the dataviz skill's
 * validator, both themes, adjacent CVD ΔE ≥ 28): series 1 = brand primary,
 * series 2 = orange (#eb6834 light / #d95926 dark). Single-series charts use
 * the primary only; ranked lists and the funnel are HTML bars with direct
 * labels, so values never depend on hover or on colour alone.
 */
import * as React from "react";
import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table2, BarChart3 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { RANGES, type RangeId } from "./data";

const PRIMARY = "hsl(var(--primary))";
const SECOND = "var(--series-2)";
// Arbitrary-property classes set the second series colour per theme.
export const VIZ_ROOT = "[--series-2:#eb6834] dark:[--series-2:#d95926]";
const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

export const money = (n: number) => formatCurrency(n);
export const compactMoney = (n: number) =>
  Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`;

export function RangePicker({ value, onChange }: { value: RangeId; onChange: (r: RangeId) => void }) {
  return (
    <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border bg-card/60 p-1">
      {RANGES.map((r) => (
        <button
          key={r.id}
          role="radio"
          aria-checked={value === r.id}
          title={r.long}
          onClick={() => onChange(r.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
            value === r.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string }[];
  /** Rows for the table view; omit for cards that are already tabular. */
  table?: { columns: string[]; rows: (string | number)[][] };
  className?: string;
  children: React.ReactNode;
}) {
  const [asTable, setAsTable] = React.useState(false);
  return (
    <section className={cn("panel flex min-w-0 flex-col p-4 sm:p-5", VIZ_ROOT, className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {legend && !asTable && (
            <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {legend.map((l) => (
                <li key={l.label} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: l.color }} />
                  {l.label}
                </li>
              ))}
            </ul>
          )}
          {table && (
            <button
              onClick={() => setAsTable((v) => !v)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={asTable ? "Show chart" : "Show as table"}
              title={asTable ? "Show chart" : "Show as table"}
            >
              {asTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
            </button>
          )}
        </div>
      </header>
      {asTable && table ? <DataTable {...table} /> : children}
    </section>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-xs text-muted-foreground">
            {columns.map((c, i) => <th key={c} className={cn("py-2 font-medium", i ? "text-right" : "text-left")}>{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => <td key={j} className={cn("py-1.5", j ? "text-right tabular-nums" : "")}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyChart({ text, href, cta }: { text: string; href?: string; cta?: string }) {
  return (
    <div className="flex min-h-40 flex-1 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
      <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
      {href && cta && <Link href={href} className="mt-2 text-sm font-medium text-primary hover:underline">{cta}</Link>}
    </div>
  );
}

type TipRow = { name: string; value: number; color: string };
function Tip({ active, label, rows, format }: { active?: boolean; label?: string; rows: TipRow[]; format: (n: number) => string }) {
  if (!active || !rows.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 text-muted-foreground">{label}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} />
          <span className="font-semibold tabular-nums">{format(r.value)}</span>
          <span className="text-muted-foreground">{r.name}</span>
        </p>
      ))}
    </div>
  );
}

/** Income vs expenses per period — two series, one axis. */
export function IncomeExpenseBars({ data, height = 260 }: { data: { label: string; income: number; expense: number }[]; height?: number }) {
  return (
    <div className={VIZ_ROOT} style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -8, right: 4, top: 4 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compactMoney} width={48} />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
            content={({ active, label, payload }) => (
              <Tip
                active={active}
                label={String(label ?? "")}
                format={money}
                rows={(payload ?? []).map((p) => ({ name: p.dataKey === "income" ? "Income" : "Expenses", value: Number(p.value) || 0, color: p.dataKey === "income" ? PRIMARY : SECOND }))}
              />
            )}
          />
          <Bar dataKey="income" fill={PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expense" fill={SECOND} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One series over time, with a crosshair tooltip. */
export function TrendArea({
  data,
  name,
  format = (n) => String(n),
  height = 220,
  id,
}: {
  data: { label: string; value: number }[];
  name: string;
  format?: (n: number) => string;
  height?: number;
  id: string;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: -16, right: 4, top: 4 }}>
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.28} />
              <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
          <Tooltip
            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
            content={({ active, label, payload }) => (
              <Tip active={active} label={String(label ?? "")} format={format} rows={(payload ?? []).map((p) => ({ name, value: Number(p.value) || 0, color: PRIMARY }))} />
            )}
          />
          <Area type="monotone" dataKey="value" stroke={PRIMARY} strokeWidth={2} fill={`url(#fill-${id})`} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars with direct labels — top sources, categories, clients. */
export function RankedBars({ rows, format = (n) => String(n) }: { rows: { name: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((n, r) => n + r.value, 0);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.name} title={`${r.name}: ${format(r.value)} (${Math.round((r.value / (total || 1)) * 100)}%)`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="shrink-0 font-semibold tabular-nums">
              {format(r.value)} <span className="text-xs font-normal text-muted-foreground">{Math.round((r.value / (total || 1)) * 100)}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Pipeline funnel: each stage's bar is its share of the first stage. */
export function Funnel({ stages }: { stages: { stage: string; value: number }[] }) {
  const top = Math.max(1, stages[0]?.value ?? 0);
  return (
    <ol className="space-y-2.5">
      {stages.map((s, i) => {
        const prev = i ? stages[i - 1].value : null;
        const conv = prev ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.stage} className="grid grid-cols-[88px_minmax(0,1fr)_64px] items-center gap-3 text-sm">
            <span className="text-muted-foreground">{s.stage}</span>
            <div className="h-7 rounded-md bg-muted/60">
              <div
                className="flex h-7 items-center rounded-md bg-primary/80 px-2 text-xs font-semibold text-primary-foreground transition-all"
                style={{ width: `${Math.max(s.value ? 8 : 0, (s.value / top) * 100)}%` }}
              >
                {s.value > 0 && s.value}
              </div>
            </div>
            <span className="text-right text-xs text-muted-foreground tabular-nums" title={i ? `Share of ${stages[i - 1].stage}` : undefined}>
              {i === 0 ? "" : prev ? `${conv}%` : "—"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
