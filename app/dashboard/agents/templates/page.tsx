"use client";
import * as React from "react";
import Link from "next/link";
import { Check, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KIND_META, SCHEDULE_LABEL, TEMPLATES, type AgentKind } from "@/lib/fleet";
import { useFleet } from "@/components/agents/fleet-provider";
import { AgentAvatar, KindTag } from "@/components/agents/agent-bits";

const FILTERS: ("all" | AgentKind)[] = ["all", "scout", "writer", "applier", "closer", "keeper"];

export default function TemplatesPage() {
  const { fleet } = useFleet();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("all");
  const used = new Set(fleet.agents.map((a) => a.templateId).filter(Boolean));
  const list = TEMPLATES.filter((t) => filter === "all" || t.kind === filter);
  return (
    <>
      <div className="mb-5">
        <div className="mb-1.5 h-1 w-10 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" />
        <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">Ready-made agents you can deploy in a click and tune afterwards. Each one runs on the same real features as the rest of your fleet.</p>
      </div>
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cn("shrink-0 rounded-full px-3 py-1.5 text-sm", filter === f ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
            {f === "all" ? "All" : KIND_META[f].label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => (
          <article key={t.id} className="panel flex flex-col p-5">
            <div className="flex items-center gap-3">
              <AgentAvatar kind={t.kind} health="running" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{t.name}</h2>
                <KindTag kind={t.kind} />
              </div>
              {used.has(t.id) && <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success"><Check className="size-3" /> In your fleet</span>}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{t.blurb}</p>
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {KIND_META[t.kind].does.map((d) => <li key={d} className="flex gap-1.5"><Check className="mt-0.5 size-3 shrink-0 text-primary" />{d}</li>)}
            </ul>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {t.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{tag}</span>)}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{SCHEDULE_LABEL[t.defaults.schedule ?? "1h"]}</span>
              {t.defaults.minBudget ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">${t.defaults.minBudget}+ only</span> : null}
            </div>
            <Button variant="gradient" className="mt-4 w-full" asChild>
              <Link href={`/dashboard/agents/new?template=${t.id}`}><Rocket /> Use template</Link>
            </Button>
          </article>
        ))}
      </div>
    </>
  );
}
