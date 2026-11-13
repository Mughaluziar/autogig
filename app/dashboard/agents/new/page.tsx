"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, FlaskConical, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  AUTONOMY, KIND_META, SCHEDULE_LABEL, TEMPLATES, agentFromTemplate, type AgentKind, type FleetAgent, type Template,
} from "@/lib/fleet";
import { useFleet } from "@/components/agents/fleet-provider";
import { AgentFields, sectionsFor } from "@/components/agents/agent-form";
import { AgentAvatar, AutonomyPicker, KindTag } from "@/components/agents/agent-bits";

const STEPS = ["Choose", "Configure", "Autonomy", "Review"];
const KINDS: AgentKind[] = ["scout", "writer", "applier", "closer", "keeper"];

function blankTemplate(kind: AgentKind): Template {
  const base = TEMPLATES.find((t) => t.kind === kind)!;
  return { ...base, id: `blank-${kind}`, name: `New ${KIND_META[kind].label}`, blurb: KIND_META[kind].does[0], tags: [] };
}

export default function NewAgentPage() {
  return (
    <React.Suspense fallback={<div className="panel h-64 animate-pulse" aria-busy="true" />}>
      <NewAgent />
    </React.Suspense>
  );
}

function NewAgent() {
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { fleet, ready, addAgent, startRun } = useFleet();
  const preset = TEMPLATES.find((t) => t.id === params.get("template"));
  const [step, setStep] = React.useState(preset ? 1 : 0);
  const [agent, setAgent] = React.useState<FleetAgent | null>(() => (preset ? agentFromTemplate(preset) : null));
  const [startNow, setStartNow] = React.useState(true);

  const choose = (t: Template) => {
    setAgent(agentFromTemplate(t, t.id.startsWith("blank-") ? { templateId: undefined } : {}));
    setStep(1);
  };
  const patch = (p: Partial<FleetAgent>) => setAgent((a) => (a ? { ...a, ...p } : a));

  const deploy = (dryRun: boolean) => {
    if (!agent || !ready) return;
    const name = agent.name.trim() || KIND_META[agent.kind].label;
    const final: FleetAgent = { ...agent, name, state: startNow && !fleet.guardrails.killSwitch ? "running" : "paused", createdAt: new Date().toISOString() };
    addAgent(final);
    toast({ title: `${name} deployed`, description: final.state === "running" ? "It's live and on its schedule." : "It's paused until you start it.", variant: "success" });
    if (dryRun) startRun(final.id, { dryRun: true });
    router.push(`/dashboard/agents/${final.id}`);
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
        <Link href="/dashboard/agents"><ArrowLeft /> Fleet</Link>
      </Button>
      <div className="mb-5">
        <div className="mb-1.5 h-1 w-10 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" />
        <h1 className="text-3xl font-bold tracking-tight">Deploy an agent</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Start from a template or a blank agent. You can change everything later.</p>
      </div>

      <ol className="mb-5 flex items-center gap-2 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <li key={s} className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={i > 0 && !agent}
              onClick={() => setStep(i)}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium",
                i === step ? "bg-primary/15 text-primary ring-1 ring-primary/30" : i < step ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px]", i < step ? "bg-success text-white" : i === step ? "bg-primary text-white" : "bg-muted")}>
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              {s}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-border" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 font-semibold">Templates</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" onClick={() => choose(t)} className="panel group flex flex-col items-start gap-3 p-4 text-left transition-colors hover:border-primary/60">
                  <div className="flex w-full items-center gap-3">
                    <AgentAvatar kind={t.kind} health="running" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{t.name}</p>
                      <KindTag kind={t.kind} />
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <p className="text-sm text-muted-foreground">{t.blurb}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {t.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{tag}</span>)}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{SCHEDULE_LABEL[t.defaults.schedule ?? "1h"]}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-3 font-semibold">Or start blank</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {KINDS.map((k) => (
                <button key={k} type="button" onClick={() => choose(blankTemplate(k))} className="panel flex flex-col items-center gap-2 p-4 text-center transition-colors hover:border-primary/60">
                  <AgentAvatar kind={k} size="sm" />
                  <span className="text-sm font-medium">{KIND_META[k].label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {step === 1 && agent && (
        <section className="panel space-y-6 p-4 sm:p-5">
          {sectionsFor(agent.kind).map((s) => (
            <div key={s}>
              <h2 className="mb-3 font-semibold">{s === "basics" ? "Basics" : s === "targeting" ? "What to look for" : "Prompt and rules"}</h2>
              <AgentFields value={agent} onChange={patch} section={s} />
            </div>
          ))}
          <WizardNav onBack={() => setStep(0)} onNext={() => setStep(2)} />
        </section>
      )}

      {step === 2 && agent && (
        <section className="panel space-y-5 p-4 sm:p-5">
          <div>
            <h2 className="font-semibold">How much should {agent.name || "it"} do on its own?</h2>
            <p className="text-sm text-muted-foreground">Proposals, replies and follow-ups always wait for your OK.</p>
          </div>
          <AutonomyPicker value={agent.autonomy} onChange={(autonomy) => patch({ autonomy })} />
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
            <div>
              <p className="text-sm font-medium">Start it right away</p>
              <p className="text-xs text-muted-foreground">{fleet.guardrails.killSwitch ? "The kill switch is on, so it will start paused." : "Otherwise it's deployed paused."}</p>
            </div>
            <Switch checked={startNow} onCheckedChange={setStartNow} />
          </div>
          <WizardNav onBack={() => setStep(1)} onNext={() => setStep(3)} />
        </section>
      )}

      {step === 3 && agent && (
        <section className="panel space-y-5 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <AgentAvatar kind={agent.kind} health={startNow ? "running" : "paused"} size="lg" />
            <div className="min-w-0">
              <p className="text-lg font-semibold">{agent.name || KIND_META[agent.kind].label}</p>
              <p className="text-sm text-muted-foreground">{agent.role}</p>
            </div>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Item label="Type" value={KIND_META[agent.kind].label} />
            <Item label="Schedule" value={SCHEDULE_LABEL[agent.schedule]} />
            <Item label="Autonomy" value={AUTONOMY.find((a) => a.id === agent.autonomy)!.label} />
            <Item label="Starts" value={startNow && !fleet.guardrails.killSwitch ? "Running" : "Paused"} />
            {agent.kind === "scout" && <Item label="Looks for" value={agent.query || "Your Job Radar skills"} />}
            {agent.kind === "scout" && <Item label="Filters" value={`≥ ${agent.minMatch}% match${agent.minBudget ? ` · $${agent.minBudget}+` : ""}${agent.sources.length ? ` · ${agent.sources.join(", ")}` : ""}`} />}
            {(agent.kind === "writer" || agent.kind === "closer") && <Item label="Tone" value={agent.tone} />}
            {agent.kind === "writer" && agent.instructions && <Item label="Rules" value={agent.instructions} />}
          </dl>
          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
            <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft /> Back</Button>
            <Button variant="outline" className="ml-auto" onClick={() => deploy(true)} disabled={!ready}><FlaskConical /> Deploy and dry run</Button>
            <Button variant="gradient" onClick={() => deploy(false)} disabled={!ready}><Rocket /> Deploy</Button>
          </div>
        </section>
      )}
    </>
  );
}

function WizardNav({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="flex gap-2 border-t border-border/60 pt-4">
      <Button variant="ghost" onClick={onBack}><ArrowLeft /> Back</Button>
      <Button variant="gradient" className="ml-auto" onClick={onNext}>Next <ArrowRight /></Button>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words">{value}</dd>
    </div>
  );
}
