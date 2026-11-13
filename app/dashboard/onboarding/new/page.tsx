"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ClipboardList, FileSignature, Mail, Receipt, Rocket } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { SectionNav } from "@/components/security/section-nav";
import { ONBOARDING_LINKS, today, useOnboarding } from "@/components/onboarding/model";
import { useAuth } from "@/lib/auth";
import { cn, formatCurrency } from "@/lib/utils";

export default function NewOnboardingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { state, ready, createClient } = useOnboarding();
  const [form, setForm] = React.useState({ clientName: "", company: "", email: "", projectTitle: "", projectValue: "", startDate: today() });
  const [templateId, setTemplateId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!templateId && state.templates[0]) setTemplateId(state.templates[0].id);
  }, [state.templates, templateId]);

  const t = state.templates.find((x) => x.id === templateId);
  const value = Number(form.projectValue) || 0;
  const deposit = t && t.depositPercent > 0 ? Math.round(value * t.depositPercent) / 100 : 0;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    if (!form.clientName.trim()) return setError("Add the client's name.");
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return setError("That email doesn't look right.");
    if (t && t.depositPercent > 0 && value <= 0) return setError("Add the project value so the deposit can be worked out — or pick a template without a deposit.");
    const id = createClient({ ...form, projectValue: value, templateId, you: user?.name ?? "" });
    toast({ title: `Onboarding started for ${form.clientName.trim()}`, variant: "success" });
    router.push(`/dashboard/onboarding/${id}`);
  };

  const plan = t
    ? [
        { icon: Mail, label: "Welcome email", on: true },
        { icon: ClipboardList, label: `${t.questions.length} intake question${t.questions.length === 1 ? "" : "s"}`, on: true },
        { icon: FileSignature, label: "Terms to agree", on: !!t.terms.trim() },
        { icon: Receipt, label: t.depositPercent ? `${t.depositPercent}% deposit${deposit ? ` · ${formatCurrency(deposit)}` : ""}` : "No deposit", on: t.depositPercent > 0 },
        { icon: Rocket, label: `${t.checklist.length}-item kickoff checklist`, on: true },
      ]
    : [];

  return (
    <>
      <PageHeader title="Onboard a client" description="Add who you're working with and pick a template. You can change anything later." />
      <SectionNav links={ONBOARDING_LINKS} />

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="panel space-y-4 p-4 sm:p-6">
            <h2 className="font-semibold">Client</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Client name</Label>
                <Input id="name" required value={form.clientName} onChange={set("clientName")} placeholder="Maya Chen" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company">Company (optional)</Label>
                <Input id="company" value={form.company} onChange={set("company")} placeholder="Northwind Studio" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="email">Email (optional)</Label>
                <Input id="email" type="email" value={form.email} onChange={set("email")} placeholder="maya@northwind.co" />
                <p className="text-xs text-muted-foreground">Used to open your email app with the welcome note and on the deposit invoice.</p>
              </div>
            </div>
          </section>

          <section className="panel space-y-4 p-4 sm:p-6">
            <h2 className="font-semibold">Project</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="project">Project title</Label>
                <Input id="project" value={form.projectTitle} onChange={set("projectTitle")} placeholder="Website redesign" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="value">Project value ($)</Label>
                <Input id="value" type="number" min={0} step="0.01" inputMode="decimal" value={form.projectValue} onChange={set("projectValue")} placeholder="4500" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="start">Start date</Label>
                <Input id="start" type="date" value={form.startDate} onChange={set("startDate")} />
              </div>
            </div>
          </section>

          <section className="panel p-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="font-semibold">Template</h2>
              <Link href="/dashboard/onboarding/templates" className="text-xs font-medium text-primary hover:underline">Edit templates</Link>
            </div>
            {state.templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You have no templates. <Link href="/dashboard/onboarding/templates" className="text-primary hover:underline">Create one</Link> first, or continue with a blank onboarding.
              </p>
            ) : (
              <div role="radiogroup" aria-label="Template" className="grid gap-3 sm:grid-cols-2">
                {state.templates.map((x) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={templateId === x.id}
                    key={x.id}
                    onClick={() => setTemplateId(x.id)}
                    className={cn("relative rounded-xl border p-4 text-left transition-colors", templateId === x.id ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "hover:bg-accent/40")}
                  >
                    {templateId === x.id && <Check className="absolute right-3 top-3 size-4 text-primary" />}
                    <p className="pr-6 font-medium">{x.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{x.description || "No description"}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{x.questions.length} questions · {x.checklist.length} checklist items · {x.depositPercent ? `${x.depositPercent}% deposit` : "no deposit"}</p>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="panel h-fit space-y-4 p-4 sm:p-5 lg:sticky lg:top-4">
          <h2 className="font-semibold">What happens next</h2>
          {plan.length ? (
            <ol className="space-y-2.5">
              {plan.map((p) => (
                <li key={p.label} className={cn("flex items-center gap-3 text-sm", !p.on && "text-muted-foreground line-through")}>
                  <span className={cn("flex size-7 items-center justify-center rounded-lg", p.on ? "bg-primary/10 text-primary" : "bg-muted")}><p.icon className="size-3.5" /></span>
                  {p.label}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">A blank onboarding with a welcome email and an empty checklist.</p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" variant="gradient" className="w-full" disabled={!ready}>Start onboarding</Button>
          <p className="text-xs text-muted-foreground">Nothing is sent to the client yet. You&apos;ll review every email first.</p>
        </aside>
      </form>
    </>
  );
}
