"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { successRate, sumMetric, type FleetRun } from "@/lib/fleet";
import { useFleet } from "@/components/agents/fleet-provider";
import { RunRow, StatTile } from "@/components/agents/agent-bits";

const STATUSES = ["all", "success", "error", "skipped", "running"] as const;
const PERIODS = { day: 86_400_000, week: 7 * 86_400_000, all: Infinity } as const;

function toCsv(runs: FleetRun[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = runs.map((r) => [r.startedAt, r.finishedAt ?? "", r.agentName, r.kind, r.trigger, r.dryRun ? "yes" : "no", r.status, r.summary,
    Object.entries(r.metrics).map(([k, v]) => `${k}=${v}`).join(" ")].map(esc).join(","));
  return ["started,finished,agent,kind,trigger,dry_run,status,summary,metrics", ...rows].join("\n");
}

export default function RunsPage() {
  return (
    <React.Suspense fallback={<div className="panel h-64 animate-pulse" aria-busy="true" />}>
      <Runs />
    </React.Suspense>
  );
}

function Runs() {
  const params = useSearchParams();
  const { fleet, live, ready } = useFleet();
  const [agentId, setAgentId] = React.useState(params.get("agent") ?? "all");
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>("all");
  const [period, setPeriod] = React.useState<keyof typeof PERIODS>("week");
  const [dry, setDry] = React.useState(true);
  const [q, setQ] = React.useState("");
  const focus = params.get("run");

  const runs = fleet.runs.filter((r) =>
    (agentId === "all" || r.agentId === agentId)
    && (status === "all" || r.status === status)
    && (dry || !r.dryRun)
    && Date.now() - Date.parse(r.startedAt) <= PERIODS[period]
    && (!q || `${r.agentName} ${r.summary} ${r.steps.map((s) => s.text).join(" ")}`.toLowerCase().includes(q.toLowerCase()))
  );
  const real = runs.filter((r) => !r.dryRun);
  const rate = successRate(real);

  const exportCsv = () => {
    const blob = new Blob([toCsv(runs)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-runs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 h-1 w-10 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" />
          <h1 className="text-3xl font-bold tracking-tight">Runs</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">Every run, step by step. The latest {fleet.runs.length} are kept.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!runs.length}><Download /> Export CSV</Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Runs" value={real.length} sub={period === "all" ? "kept history" : period === "day" ? "last 24 hours" : "last 7 days"} />
        <StatTile label="Success rate" value={rate == null ? "—" : `${rate}%`} sub={`${real.filter((r) => r.status === "error").length} failed`} tone={rate != null && rate < 70 ? "warning" : "success"} />
        <StatTile label="Matches found" value={sumMetric(real, "matches")} sub={`${sumMetric(real, "scanned")} listings scanned`} />
        <StatTile label="Drafts written" value={sumMetric(real, "drafted") + sumMetric(real, "followUps")} sub="proposals, replies, follow-ups" tone="primary" />
      </div>

      <div className="panel mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_150px_150px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search summaries and steps" className="h-9 pl-9" aria-label="Search runs" />
        </div>
        <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-9" aria-label="Agent">
          <option value="all">All agents</option>
          {fleet.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])} className="h-9 capitalize" aria-label="Status">
          {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "Any status" : s}</option>)}
        </Select>
        <Select value={period} onChange={(e) => setPeriod(e.target.value as keyof typeof PERIODS)} className="h-9" aria-label="Period">
          <option value="day">Last 24 hours</option>
          <option value="week">Last 7 days</option>
          <option value="all">All kept</option>
        </Select>
        <label className="flex h-9 items-center gap-2 px-1 text-sm text-muted-foreground">
          <input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} className="accent-[hsl(var(--primary))]" /> Dry runs
        </label>
      </div>

      {!ready ? (
        <div className="panel h-40 animate-pulse" />
      ) : runs.length === 0 ? (
        <p className="panel py-12 text-center text-sm text-muted-foreground">No runs match these filters.</p>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r.id} className={cn(focus === r.id && "rounded-xl ring-2 ring-primary/50")}>
              <RunRow run={r} defaultOpen={focus === r.id || r.status === "running"} liveSteps={live[r.agentId]?.runId === r.id ? live[r.agentId].steps : undefined} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
