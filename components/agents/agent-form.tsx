"use client";
import * as React from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { RUNS_WHILE, SCHEDULE_LABEL, splitList, type FleetAgent, type Schedule } from "@/lib/fleet";
import { SourcePicker } from "./source-picker";

const TONES = ["professional", "friendly", "concise", "confident", "warm"];

const RULE_IDEAS: Record<FleetAgent["kind"], string[]> = {
  scout: [],
  writer: [
    "Keep it under 120 words.",
    "Mention I can start this week.",
    "Ask one question about their timeline.",
    "Never promise a fixed price before a call.",
    "Lead with a result from a similar project.",
  ],
  applier: [],
  closer: [],
  keeper: [],
};

export type FormSection = "basics" | "targeting" | "prompt";

export function sectionsFor(kind: FleetAgent["kind"]): FormSection[] {
  if (kind === "scout") return ["basics", "targeting"];
  if (kind === "keeper" || kind === "applier") return ["basics"];
  return ["basics", "prompt"];
}

export function AgentFields({
  value,
  onChange,
  section,
}: {
  value: FleetAgent;
  onChange: (patch: Partial<FleetAgent>) => void;
  section: FormSection;
}) {
  const a = value;
  const [exclude, setExclude] = React.useState(a.excludeKeywords.join(", "));
  React.useEffect(() => setExclude(a.excludeKeywords.join(", ")), [a.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (section === "basics") {
    const schedules = (Object.keys(SCHEDULE_LABEL) as Schedule[]).filter((s) => s !== "chain" || a.kind === "writer");
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ag-name">Name</Label>
          <Input id="ag-name" value={a.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ag-schedule">Schedule</Label>
          <Select id="ag-schedule" value={a.schedule} onChange={(e) => onChange({ schedule: e.target.value as Schedule })}>
            {schedules.map((s) => <option key={s} value={s}>{SCHEDULE_LABEL[s]}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ag-role">What it's for</Label>
          <Input id="ag-role" value={a.role} maxLength={120} onChange={(e) => onChange({ role: e.target.value })} />
        </div>
        {(a.kind === "writer" || a.kind === "closer" || a.kind === "applier" || a.kind === "scout") && (
          <div className="space-y-1.5">
            <Label htmlFor="ag-limit">{a.kind === "scout" ? "Matches to hand off per run" : "Drafts per run"}</Label>
            <Input id="ag-limit" type="number" min={1} max={20} value={a.perRunLimit} onChange={(e) => onChange({ perRunLimit: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
          </div>
        )}
        {a.kind === "applier" && (
          <div className="space-y-1.5">
            <Label htmlFor="ag-follow">Follow up after (days)</Label>
            <Input id="ag-follow" type="number" min={1} max={30} value={a.followUpDays} onChange={(e) => onChange({ followUpDays: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} />
          </div>
        )}
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Scheduled runs happen {RUNS_WHILE}. Close it and the fleet picks up where it left off next time.
        </p>
      </div>
    );
  }

  if (section === "targeting") {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ag-query">Skills and keywords</Label>
          <Input id="ag-query" value={a.query} maxLength={300} onChange={(e) => onChange({ query: e.target.value })} placeholder="react, next.js, figma  (blank = your Job Radar skills)" />
        </div>
        <div className="space-y-1.5">
          <Label>Looks for</Label>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1">
            {(["all", "gig", "job"] as const).map((k) => (
              <button key={k} type="button" onClick={() => onChange({ scanKind: k })}
                className={cn("rounded-lg py-1.5 text-xs font-medium", a.scanKind === k ? "bg-gradient-to-r from-primary to-purple-500 text-white" : "text-muted-foreground hover:text-foreground")}>
                {k === "all" ? "Jobs and gigs" : k === "gig" ? "Freelance gigs" : "Jobs"}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Sources</Label>
          <SourcePicker value={a.sources} onChange={(sources) => onChange({ sources })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ag-match">Minimum match: {a.minMatch}%</Label>
            <input id="ag-match" type="range" min={0} max={95} step={5} value={a.minMatch} onChange={(e) => onChange({ minMatch: Number(e.target.value) })} className="w-full accent-[hsl(var(--primary))]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ag-budget">Minimum budget (USD)</Label>
            <Input id="ag-budget" type="number" min={0} step={50} value={a.minBudget} onChange={(e) => onChange({ minBudget: Math.max(0, Number(e.target.value) || 0) })} />
            <p className="text-[11px] text-muted-foreground">Listings without a budget are skipped when this is above 0.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ag-exclude">Skip listings mentioning</Label>
          <Input id="ag-exclude" value={exclude} onChange={(e) => setExclude(e.target.value)} onBlur={() => onChange({ excludeKeywords: splitList(exclude).slice(0, 30) })} placeholder="wordpress, unpaid, equity only" />
        </div>
      </div>
    );
  }

  const ideas = RULE_IDEAS[a.kind].filter((r) => !a.instructions.includes(r));
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ag-tone">Tone</Label>
        <div className="flex flex-wrap gap-1.5">
          {TONES.map((t) => (
            <button key={t} id={t === TONES[0] ? "ag-tone" : undefined} type="button" onClick={() => onChange({ tone: t })}
              className={cn("rounded-full border px-3 py-1 text-xs capitalize", a.tone === t ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {a.kind !== "writer" ? (
        <p className="text-xs text-muted-foreground">Reply drafts follow this tone. You can edit every draft before you send it.</p>
      ) : (
      <div className="space-y-1.5">
        <Label htmlFor="ag-instructions">Prompt and rules</Label>
        <Textarea
          id="ag-instructions"
          rows={6}
          maxLength={1500}
          value={a.instructions}
          onChange={(e) => onChange({ instructions: e.target.value })}
          placeholder="What should every proposal include? What should it never say?"
        />
        <p className="text-[11px] text-muted-foreground">
          Sent to the AI with every draft, on top of the job details. {a.instructions.length}/1500
        </p>
        {ideas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {ideas.map((r) => (
              <button key={r} type="button" onClick={() => onChange({ instructions: `${a.instructions.trim()}${a.instructions.trim() ? "\n" : ""}${r}` })}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground">
                <Plus className="size-3" /> {r}
              </button>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
