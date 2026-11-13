"use client";
import * as React from "react";
import { Lock, MonitorSmartphone, MoonStar, OctagonX, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { RUNS_WHILE, actionsToday, defaultFleet, inQuietHours, splitList } from "@/lib/fleet";
import { useFleet } from "@/components/agents/fleet-provider";
import { SourcePicker } from "@/components/agents/source-picker";

export default function GuardrailsPage() {
  const { fleet, ready, updateGuardrails, update } = useFleet();
  const { toast } = useToast();
  const g = fleet.guardrails;
  const [blocked, setBlocked] = React.useState(g.blockKeywords.join(", "));
  React.useEffect(() => setBlocked(g.blockKeywords.join(", ")), [g.blockKeywords]);
  const used = actionsToday(fleet);

  if (!ready) return <div className="panel h-64 animate-pulse" aria-busy="true" />;

  return (
    <>
      <div className="mb-5">
        <div className="mb-1.5 h-1 w-10 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" />
        <h1 className="text-3xl font-bold tracking-tight">Guardrails</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">Limits every agent follows, whatever its own settings say. Changes apply immediately.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={cn("panel p-5 lg:col-span-2", g.killSwitch && "border-destructive/50 bg-destructive/5")}>
          <div className="flex flex-wrap items-center gap-4">
            <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl", g.killSwitch ? "bg-destructive text-white" : "bg-destructive/10 text-destructive")}>
              <OctagonX className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Kill switch</h2>
              <p className="text-sm text-muted-foreground">
                {g.killSwitch ? "On. Every agent is stopped, including manual runs and Copilot commands." : "Stops every agent at once, including manual runs. Use it if anything looks wrong."}
              </p>
            </div>
            <Button variant={g.killSwitch ? "outline" : "destructive"} onClick={() => updateGuardrails({ killSwitch: !g.killSwitch })} className="w-full sm:w-auto">
              <OctagonX /> {g.killSwitch ? "Release kill switch" : "Stop everything"}
            </Button>
          </div>
        </section>

        <section className="panel space-y-3 p-5">
          <h2 className="font-semibold">Daily draft cap</h2>
          <p className="text-sm text-muted-foreground">The most proposals, replies and follow-ups the whole fleet drafts per day. Resets at midnight.</p>
          <div className="flex items-center gap-3">
            <Input type="number" min={1} max={500} value={g.dailyActionCap} className="w-24"
              onChange={(e) => updateGuardrails({ dailyActionCap: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} aria-label="Daily draft cap" />
            <div className="min-w-0 flex-1">
              <Progress value={Math.min(100, (used / Math.max(1, g.dailyActionCap)) * 100)} />
              <p className="mt-1 text-xs text-muted-foreground">{used} used today · {Math.max(0, g.dailyActionCap - used)} left</p>
            </div>
          </div>
        </section>

        <section className="panel space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold"><MoonStar className="size-4 text-primary" /> Quiet hours</h2>
            <Switch checked={g.quietHours.enabled} onCheckedChange={(v) => updateGuardrails({ quietHours: { ...g.quietHours, enabled: v } })} />
          </div>
          <p className="text-sm text-muted-foreground">No scheduled runs in this window (your device&apos;s time). You can still run agents yourself.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qh-start">From</Label>
              <Input id="qh-start" type="time" value={g.quietHours.start} disabled={!g.quietHours.enabled} onChange={(e) => updateGuardrails({ quietHours: { ...g.quietHours, start: e.target.value } })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qh-end">Until</Label>
              <Input id="qh-end" type="time" value={g.quietHours.end} disabled={!g.quietHours.enabled} onChange={(e) => updateGuardrails({ quietHours: { ...g.quietHours, end: e.target.value } })} />
            </div>
          </div>
          {inQuietHours(g) && <p className="text-xs text-primary">Quiet hours are on right now.</p>}
        </section>

        <section className="panel space-y-3 p-5">
          <h2 className="font-semibold">Minimum match</h2>
          <p className="text-sm text-muted-foreground">Scouts never hand off anything below this score, even if their own threshold is lower.</p>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={95} step={5} value={g.minMatch} onChange={(e) => updateGuardrails({ minMatch: Number(e.target.value) })} className="min-w-0 flex-1 accent-[hsl(var(--primary))]" aria-label="Minimum match" />
            <span className="w-12 text-right font-semibold tabular-nums">{g.minMatch}%</span>
          </div>
        </section>

        <section className="panel space-y-3 p-5">
          <h2 className="font-semibold">Blocked keywords</h2>
          <p className="text-sm text-muted-foreground">Scouts skip any listing that mentions one of these.</p>
          <Input value={blocked} onChange={(e) => setBlocked(e.target.value)} onBlur={() => updateGuardrails({ blockKeywords: splitList(blocked).slice(0, 50) })} placeholder="unpaid, equity only, test task" aria-label="Blocked keywords" />
        </section>

        <section className="panel space-y-3 p-5 lg:col-span-2">
          <h2 className="font-semibold">Allowed sources</h2>
          <p className="text-sm text-muted-foreground">Which Job Radar sources the fleet may use. Leave on “Every source” to use whatever your server has enabled.</p>
          <SourcePicker value={g.sources} onChange={(sources) => updateGuardrails({ sources })} />
        </section>

        <section className="panel space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Lock className="size-4 text-primary" /> Approval policy</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> Proposals, replies and follow-ups always wait for your OK.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> Agents never log in to or post on a marketplace for you.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> Approving copies the text and opens the listing; you press send.</li>
          </ul>
          <p className="text-xs text-muted-foreground">This can&apos;t be turned off. It keeps your marketplace accounts safe.</p>
        </section>

        <section className="panel space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><MonitorSmartphone className="size-4 text-primary" /> Where agents run</h2>
          <p className="text-sm text-muted-foreground">
            Scheduled runs happen {RUNS_WHILE}. Close it and nothing runs; open it again and overdue agents catch up within a minute.
            Job Radar&apos;s saved-search alerts keep working on the server either way.
          </p>
        </section>

        <section className="panel space-y-3 border-destructive/30 p-5 lg:col-span-2">
          <h2 className="font-semibold text-destructive">Danger zone</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => {
              if (!window.confirm("Clear all run history? Agents and approvals stay.")) return;
              update((f) => ({ ...f, runs: f.runs.filter((r) => r.status === "running") }));
              toast({ title: "Run history cleared" });
            }}><Trash2 /> Clear run history</Button>
            <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => {
              if (!window.confirm("Reset the fleet? Your agents go back to the five defaults (paused), and runs, approvals and the match queue are cleared. Your Job Radar pipeline isn't touched.")) return;
              update((f) => ({ ...defaultFleet(), streak: f.streak, lastVisitAt: f.lastVisitAt }));
              toast({ title: "Fleet reset" });
            }}><RotateCcw /> Reset fleet</Button>
          </div>
        </section>
      </div>
    </>
  );
}
