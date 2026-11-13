"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, Maximize2, Minimize2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatRelative } from "@/lib/utils";
import {
  KIND_META, agentHealth, pendingApprovals,
  type AgentHealth, type FleetAgent, type FleetRun, type FleetState,
} from "@/lib/fleet";
import type { Row } from "@/lib/demo-engine";

const W = 920;
const H = 400;
const SRC = { x: 16, w: 168, h: 38 };
const AG = { x: 300, w: 176, h: 40 };
const ORCH = { cx: 610, cy: H / 2, r: 50 };
const OUT = { x: 742, w: 166, h: 50 };

const KIND_ORDER = ["scout", "writer", "applier", "closer", "keeper"] as const;

function spread(n: number, h: number, top = 24, bottom = 24): number[] {
  if (n <= 0) return [];
  const avail = H - top - bottom;
  const gap = Math.min(avail / n, h + 34);
  const start = top + (avail - gap * n) / 2 + gap / 2;
  return Array.from({ length: n }, (_, i) => start + i * gap);
}

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

function Edge({ d, color, health, reduced }: { d: string; color: string; health: AgentHealth | "idle"; reduced: boolean }) {
  const active = health === "working" || health === "running" || health === "waiting";
  const working = health === "working";
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeOpacity={active ? 0.75 : 0.18} strokeWidth={working ? 2 : 1.4} strokeDasharray="5 6">
        {active && !reduced && (
          <animate attributeName="stroke-dashoffset" values="22;0" dur={working ? "0.6s" : "1.8s"} repeatCount="indefinite" />
        )}
      </path>
      {working && !reduced && (
        <circle r="3.5" fill={color}>
          <animateMotion dur="1.3s" repeatCount="indefinite" path={d} />
        </circle>
      )}
    </g>
  );
}

export function LiveMap({
  fleet,
  working,
  applications,
  onSelect,
  selectedId,
}: {
  fleet: FleetState;
  working: Set<string>;
  applications: Row[];
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const reduced = useReducedMotion();
  const router = useRouter();
  const [fit, setFit] = React.useState(false);
  const [replay, setReplay] = React.useState<{ agentId: string; caption: string } | null>(null);
  const replayTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (replayTimer.current) clearTimeout(replayTimer.current); }, []);

  const agents = React.useMemo(
    () => [...fleet.agents].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)).slice(0, 6),
    [fleet.agents]
  );
  const extra = fleet.agents.length - agents.length;
  const sources = React.useMemo(() => {
    const entries = Object.entries(fleet.sources ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return entries.map(([name, count]) => ({ name, count }));
  }, [fleet.sources]);

  const health = (a: FleetAgent) => agentHealth(fleet, a, working.has(a.id));
  const pending = pendingApprovals(fleet);
  const outputs = [
    { key: "approvals", label: "Approvals", sub: `${pending.length} waiting`, href: "/dashboard/agents/approvals", hot: pending.length > 0 },
    { key: "pipeline", label: "Pipeline", sub: `${applications.length} tracked`, href: "/dashboard/job-radar", hot: false },
    { key: "inbox", label: "Inbox", sub: `${pending.filter((p) => p.kind === "reply").length} replies drafted`, href: "/dashboard/conversations", hot: false },
  ];

  const srcY = spread(Math.max(sources.length, 1) + 1, SRC.h);
  const agY = spread(agents.length, AG.h);
  const outY = spread(outputs.length, OUT.h, 60, 60);
  const scouts = agents.map((a, i) => ({ a, y: agY[i] })).filter((x) => x.a.kind === "scout");
  const anyLive = agents.some((a) => ["working", "running", "waiting"].includes(health(a)));

  const startReplay = () => {
    if (replayTimer.current) clearTimeout(replayTimer.current);
    const since = Date.now() - 60 * 60_000;
    const runs: FleetRun[] = fleet.runs.filter((r) => !r.dryRun && Date.parse(r.startedAt) >= since).reverse();
    if (!runs.length) {
      setReplay({ agentId: "", caption: "No runs in the last hour. Start an agent or press Run." });
      replayTimer.current = setTimeout(() => setReplay(null), 2600);
      return;
    }
    const play = (i: number) => {
      if (i >= runs.length) {
        setReplay(null);
        return;
      }
      const r = runs[i];
      setReplay({ agentId: r.agentId, caption: `${new Date(r.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${r.agentName} · ${r.summary}` });
      replayTimer.current = setTimeout(() => play(i + 1), 1500);
    };
    play(0);
  };

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3">
        <h2 className="font-semibold">Live map</h2>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", anyLive && !fleet.guardrails.killSwitch ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
          <span className={cn("size-1.5 rounded-full", anyLive && !fleet.guardrails.killSwitch ? "animate-pulse bg-success" : "bg-muted-foreground")} />
          {fleet.guardrails.killSwitch ? "Kill switch on" : anyLive ? "Live" : "Idle"}
        </span>
        <span className="hidden text-xs text-muted-foreground md:inline">Moving lines show work in flight</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-8 px-2.5" onClick={() => setFit((v) => !v)} aria-pressed={fit} title={fit ? "Actual size" : "Fit to width"}>
            {fit ? <Minimize2 /> : <Maximize2 />}<span className="hidden sm:inline">{fit ? "Actual size" : "Fit"}</span>
          </Button>
          <Button size="sm" variant="outline" className="h-8 px-2.5" onClick={startReplay}>
            <History /> Replay last hour
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto overscroll-x-contain">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Live map of your agents, their sources and where their work goes"
          className={cn("block h-auto", fit ? "w-full" : "w-full min-w-[720px]")}
          style={{ background: "radial-gradient(circle at 1px 1px, hsl(var(--border) / 0.6) 1px, transparent 0) 0 0 / 22px 22px" }}
        >
          {/* source → scout edges */}
          {sources.length > 0
            ? sources.flatMap((s, si) => (scouts.length ? scouts : [{ a: null as FleetAgent | null, y: ORCH.cy }]).map(({ a, y }) => (
              <Edge key={`s${si}-${a?.id ?? "o"}`} d={curve(SRC.x + SRC.w, srcY[si], a ? AG.x : ORCH.cx - ORCH.r, y)} color={KIND_META.scout.hex} health={a ? health(a) : "idle"} reduced={reduced} />
            )))
            : scouts.map(({ a, y }) => (
              <Edge key={`s-empty-${a.id}`} d={curve(SRC.x + SRC.w, srcY[0], AG.x, y)} color={KIND_META.scout.hex} health={health(a)} reduced={reduced} />
            ))}
          {/* agent → orchestrator */}
          {agents.map((a, i) => (
            <Edge key={`a-${a.id}`} d={curve(AG.x + AG.w, agY[i], ORCH.cx - ORCH.r, ORCH.cy)} color={KIND_META[a.kind].hex} health={health(a)} reduced={reduced} />
          ))}
          {/* orchestrator → outputs */}
          {outputs.map((o, i) => (
            <Edge key={`o-${o.key}`} d={curve(ORCH.cx + ORCH.r, ORCH.cy, OUT.x, outY[i])} color="hsl(var(--primary))" health={anyLive && !fleet.guardrails.killSwitch ? (o.hot ? "working" : "running") : "idle"} reduced={reduced} />
          ))}

          {/* sources */}
          {(sources.length ? sources : [{ name: "Job feeds", count: -1 }]).map((s, i) => (
            <g key={s.name} transform={`translate(${SRC.x} ${srcY[i] - SRC.h / 2})`}>
              <rect width={SRC.w} height={SRC.h} rx={10} className="fill-card stroke-border" strokeWidth={1} strokeDasharray={s.count < 0 ? "4 4" : undefined} />
              <circle cx={16} cy={SRC.h / 2} r={4} fill={s.count < 0 ? "hsl(var(--muted-foreground))" : KIND_META.scout.hex} />
              <text x={28} y={SRC.h / 2 + 4.5} className="fill-foreground" fontSize={13} fontWeight={500}>
                {s.name.length > 15 ? `${s.name.slice(0, 14)}…` : s.name}{s.count >= 0 ? ` · ${s.count}` : ""}
              </text>
            </g>
          ))}
          <g
            transform={`translate(${SRC.x} ${srcY[Math.max(sources.length, 1)] - SRC.h / 2})`}
            className="cursor-pointer"
            role="link"
            tabIndex={0}
            aria-label="Add a platform"
            onClick={() => router.push("/dashboard/accounts")}
            onKeyDown={(e) => { if (e.key === "Enter") router.push("/dashboard/accounts"); }}
          >
            <rect width={SRC.w} height={SRC.h} rx={10} fill="transparent" className="stroke-border" strokeDasharray="4 4" />
            <text x={SRC.w / 2} y={SRC.h / 2 + 4.5} textAnchor="middle" className="fill-muted-foreground" fontSize={12.5}>+ Add platform</text>
          </g>

          {/* agents */}
          {agents.map((a, i) => {
            const h = health(a);
            const selected = a.id === selectedId;
            const replaying = replay?.agentId === a.id;
            const color = KIND_META[a.kind].hex;
            return (
              <g
                key={a.id}
                transform={`translate(${AG.x} ${agY[i] - AG.h / 2})`}
                onClick={() => onSelect(a.id)}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`${a.name}: ${h}`}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(a.id); } }}
              >
                {(replaying || h === "working") && (
                  <rect x={-5} y={-5} width={AG.w + 10} height={AG.h + 10} rx={16} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={2}>
                    {!reduced && <animate attributeName="stroke-opacity" values="0.6;0.1;0.6" dur="1.4s" repeatCount="indefinite" />}
                  </rect>
                )}
                <rect
                  width={AG.w} height={AG.h} rx={AG.h / 2}
                  className="fill-card"
                  stroke={selected ? "hsl(var(--primary))" : color}
                  strokeOpacity={h === "paused" || h === "stopped" ? 0.3 : 0.8}
                  strokeWidth={selected ? 2.2 : 1.3}
                />
                <circle cx={20} cy={AG.h / 2} r={5} fill={h === "paused" ? "hsl(var(--muted-foreground))" : h === "stopped" || h === "error" ? "hsl(var(--destructive))" : h === "waiting" ? "hsl(var(--warning))" : color}>
                  {h === "working" && !reduced && <animate attributeName="r" values="4;6.5;4" dur="1s" repeatCount="indefinite" />}
                </circle>
                <text x={34} y={AG.h / 2 + 4.5} className="fill-foreground" fontSize={13.5} fontWeight={600}>
                  {a.name.length > 16 ? `${a.name.slice(0, 15)}…` : a.name}
                </text>
              </g>
            );
          })}
          {extra > 0 && (
            <text x={AG.x + AG.w / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground" fontSize={12}>+{extra} more agents</text>
          )}

          {/* orchestrator */}
          <g>
            <circle cx={ORCH.cx} cy={ORCH.cy} r={ORCH.r + 10} fill="hsl(var(--primary) / 0.08)">
              {anyLive && !reduced && <animate attributeName="r" values={`${ORCH.r + 4};${ORCH.r + 16};${ORCH.r + 4}`} dur="2.6s" repeatCount="indefinite" />}
            </circle>
            <circle cx={ORCH.cx} cy={ORCH.cy} r={ORCH.r} className="fill-card" stroke="hsl(var(--primary))" strokeWidth={2} />
            <text x={ORCH.cx} y={ORCH.cy - 2} textAnchor="middle" className="fill-foreground" fontSize={13} fontWeight={700}>Orchestrator</text>
            <text x={ORCH.cx} y={ORCH.cy + 15} textAnchor="middle" className="fill-muted-foreground" fontSize={11}>rules · caps</text>
          </g>

          {/* outputs */}
          {outputs.map((o, i) => (
            <g
              key={o.key}
              transform={`translate(${OUT.x} ${outY[i] - OUT.h / 2})`}
              className="cursor-pointer"
              role="link"
              tabIndex={0}
              aria-label={`${o.label}: ${o.sub}`}
              onClick={() => router.push(o.href)}
              onKeyDown={(e) => { if (e.key === "Enter") router.push(o.href); }}
            >
              <rect width={OUT.w} height={OUT.h} rx={12} className="fill-card" stroke={o.hot ? "hsl(var(--warning))" : "hsl(var(--primary) / 0.6)"} strokeWidth={1.4} />
              <text x={14} y={21} className="fill-foreground" fontSize={13.5} fontWeight={600}>{o.label}</text>
              <text x={14} y={38} fill={o.hot ? "hsl(var(--warning))" : "hsl(var(--primary))"} fontSize={12}>{o.sub}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="flex min-h-10 items-center gap-2 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
        {replay ? (
          <span className="animate-fade-in text-foreground">▶ {replay.caption}</span>
        ) : fleet.runs[0] ? (
          <span className="truncate">Last activity {formatRelative(fleet.runs[0].startedAt)}: {fleet.runs[0].agentName} · {fleet.runs[0].summary}</span>
        ) : (
          <span>No runs yet. Press Run on Scout to light up the map.</span>
        )}
        <Link href="/dashboard/accounts" className="ml-auto hidden shrink-0 items-center gap-1 text-primary hover:underline sm:inline-flex">
          <Plus className="size-3" /> Add platform
        </Link>
      </div>
    </section>
  );
}
