"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, ClipboardList, FileSignature, Mail, Plus, Receipt, Rocket, Search, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionNav } from "@/components/security/section-nav";
import { ProgressRing, StepDots } from "@/components/onboarding/bits";
import { ONBOARDING_LINKS, progressOf, stepsOf, useDepositLookup, useOnboarding, type ClientOnboarding } from "@/components/onboarding/model";
import { cn, formatCurrency, formatRelative } from "@/lib/utils";

const TABS = ["active", "completed", "archived"] as const;

export default function OnboardingPage() {
  const { state, ready } = useOnboarding();
  const depositOf = useDepositLookup();
  const [tab, setTab] = React.useState<(typeof TABS)[number]>("active");
  const [q, setQ] = React.useState("");

  const rows = state.clients.map((o) => {
    const inv = depositOf(o);
    const steps = stepsOf(o, inv?.status === "Paid");
    return { o, steps, progress: progressOf(steps), next: steps.find((s) => !s.done), depositWaiting: !!o.deposit && inv?.status !== "Paid" && !!o.deposit.invoicedAt };
  });
  const shown = rows
    .filter((r) => r.o.status === tab)
    .filter((r) => !q.trim() || `${r.o.clientName} ${r.o.company} ${r.o.projectTitle}`.toLowerCase().includes(q.trim().toLowerCase()));

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const completed = state.clients.filter((o) => o.status === "completed" && o.completedAt);
  const avgDays = completed.length
    ? Math.round(completed.reduce((n, o) => n + (Date.parse(o.completedAt!) - Date.parse(o.createdAt)) / 86_400_000, 0) / completed.length)
    : null;

  return (
    <>
      <PageHeader
        title="Client Onboarding"
        description="Turn a yes into a smooth start: welcome email, intake questions, terms, deposit and kickoff — tracked for every new client."
        actions={<Button asChild variant="gradient"><Link href="/dashboard/onboarding/new"><UserPlus className="size-4" /> Onboard a client</Link></Button>}
      />
      <SectionNav links={ONBOARDING_LINKS} />

      {!ready ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/60" />)}</div>
      ) : state.clients.length === 0 ? (
        <FirstRun templates={state.templates.length} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="In progress" value={String(rows.filter((r) => r.o.status === "active").length)} hint={`${rows.filter((r) => r.o.status === "active" && r.progress >= 100).length} ready to complete`} />
            <StatCard label="Completed this month" value={String(completed.filter((o) => Date.parse(o.completedAt!) >= monthStart).length)} hint={`${completed.length} all time`} />
            <StatCard label="Avg time to onboard" value={avgDays === null ? "—" : `${avgDays}d`} hint="start to completed" />
            <StatCard label="Deposits waiting" value={String(rows.filter((r) => r.o.status === "active" && r.depositWaiting).length)} hint="invoiced, not paid yet" href="/dashboard/money/invoices" />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-lg bg-muted p-1">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium capitalize", tab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {t} <span className="text-xs text-muted-foreground">{rows.filter((r) => r.o.status === t).length}</span>
                </button>
              ))}
            </div>
            <div className="relative sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="pl-9" aria-label="Search clients" />
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="panel px-6 py-10 text-center text-sm text-muted-foreground">
              {q ? "No clients match your search." : tab === "active" ? "No onboardings in progress." : `No ${tab} onboardings.`}
            </div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {shown.map(({ o, steps, progress, next }) => (
                <li key={o.id}>
                  <Link href={`/dashboard/onboarding/${o.id}`} className="panel group flex h-full flex-col p-4 transition-colors hover:border-primary/50">
                    <div className="flex items-start gap-3">
                      <ProgressRing value={progress} size={48} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{o.clientName}</p>
                        <p className="truncate text-sm text-muted-foreground">{o.projectTitle || "Untitled project"}{o.company ? ` · ${o.company}` : ""}</p>
                      </div>
                      {o.projectValue > 0 && <span className="shrink-0 text-sm font-semibold">{formatCurrency(o.projectValue)}</span>}
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-2">
                      <StepDots steps={steps} />
                      <Badge variant="secondary" className="truncate">{o.templateName}</Badge>
                    </div>
                    <p className="mt-3 flex items-center gap-1 text-sm">
                      {o.status === "completed" ? (
                        <span className="text-success">Onboarded {formatRelative(o.completedAt)}</span>
                      ) : next ? (
                        <><span className="text-muted-foreground">Next:</span> <span className="font-medium">{next.label}</span></>
                      ) : (
                        <span className="font-medium text-success">Ready to complete</span>
                      )}
                      <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">Updated {formatRelative(o.updatedAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function FirstRun({ templates }: { templates: number }) {
  const steps = [
    { icon: Mail, title: "Welcome email", text: "A warm, ready-to-send note from your template." },
    { icon: ClipboardList, title: "Intake questions", text: "Send the questionnaire, record the answers." },
    { icon: FileSignature, title: "Terms", text: "Scope, payment and revisions, agreed in writing." },
    { icon: Receipt, title: "Deposit", text: "One click creates the invoice in Money." },
    { icon: Rocket, title: "Kickoff", text: "Tick off access, calls and folders." },
  ];
  return (
    <div className="space-y-6">
      <section className="panel relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-primary/15 blur-3xl" />
        <h2 className="text-xl font-bold">Onboard every client the same, professional way</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Pick a template, add the client, and Autopilot walks you through each step and keeps track of what&apos;s done. You send everything from your own
          email — clients don&apos;t need an account.
        </p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-xl border bg-card/60 p-3">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{i + 1}</span>
                {s.title}
              </span>
              <p className="mt-1.5 text-xs text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="gradient"><Link href="/dashboard/onboarding/new"><Plus className="size-4" /> Onboard your first client</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/onboarding/templates">Browse {templates} template{templates === 1 ? "" : "s"}</Link></Button>
        </div>
      </section>
    </div>
  );
}
