"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { PLACEHOLDERS, fill, uid, useOnboarding, type Question, type QuestionType, type Template } from "@/components/onboarding/model";
import { useAuth } from "@/lib/auth";

function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export default function TemplateEditorPage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { state, ready, saveTemplate } = useOnboarding();
  const stored = state.templates.find((t) => t.id === params.id);
  const [t, setT] = React.useState<Template | null>(null);
  const [preview, setPreview] = React.useState(false);

  React.useEffect(() => {
    if (stored && !t) setT(stored);
  }, [stored, t]);

  if (!ready || (stored && !t)) return <div className="h-96 animate-pulse rounded-2xl bg-muted/60" />;
  if (!t) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <p className="font-semibold">Template not found</p>
        <Button asChild variant="outline" className="mt-4"><Link href="/dashboard/onboarding/templates">Back to templates</Link></Button>
      </div>
    );
  }

  const dirty = JSON.stringify(t) !== JSON.stringify(stored);
  const setQ = (i: number, patch: Partial<Question>) => setT({ ...t, questions: t.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const save = () => {
    if (!t.name.trim()) return toast({ title: "Give the template a name" });
    const clean: Template = {
      ...t, name: t.name.trim(), depositPercent: Math.max(0, Math.min(100, Math.round(t.depositPercent))),
      questions: t.questions.filter((q) => q.label.trim()).map((q) => ({ ...q, options: q.type === "choice" ? q.options.map((o) => o.trim()).filter(Boolean) : [] })),
      checklist: t.checklist.filter((c) => c.label.trim()),
    };
    saveTemplate(clean);
    setT(clean);
    toast({ title: "Template saved", description: "New onboardings use it. Ones already started keep their copy.", variant: "success" });
  };
  const sample = { clientName: "Maya Chen", company: "Northwind Studio", projectTitle: "Website redesign", startDate: new Date().toISOString().slice(0, 10), deposit: t.depositPercent ? 45 * t.depositPercent : 0 };

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3"><Link href="/dashboard/onboarding/templates"><ArrowLeft className="size-4" /> Templates</Link></Button>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1.5 h-1 w-10 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" />
          <h1 className="text-3xl font-bold tracking-tight">Edit template</h1>
        </div>
        <div className="flex gap-2">
          {dirty && <Button variant="ghost" onClick={() => setT(stored ?? t)}>Discard changes</Button>}
          <Button variant="gradient" onClick={save} disabled={!dirty}><Save className="size-4" /> Save</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <section className="panel space-y-4 p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
              <div className="space-y-1.5">
                <Label htmlFor="t-name">Name</Label>
                <Input id="t-name" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-deposit">Deposit (%)</Label>
                <Input id="t-deposit" type="number" min={0} max={100} value={t.depositPercent} onChange={(e) => setT({ ...t, depositPercent: Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-desc">Description</Label>
              <Input id="t-desc" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} placeholder="When to use this template" />
            </div>
            <p className="text-xs text-muted-foreground">Set the deposit to 0 to skip the deposit step.</p>
          </section>

          <section className="panel p-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Welcome email</h2>
              <button onClick={() => setPreview((v) => !v)} className="text-xs font-medium text-primary hover:underline">{preview ? "Edit" : "Preview"}</button>
            </div>
            {preview ? (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <p className="font-semibold">{fill(t.welcomeSubject, sample, user?.name ?? "")}</p>
                <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{fill(t.welcomeBody, sample, user?.name ?? "")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="t-subj">Subject</Label>
                  <Input id="t-subj" value={t.welcomeSubject} onChange={(e) => setT({ ...t, welcomeSubject: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-body">Message</Label>
                  <Textarea id="t-body" rows={9} value={t.welcomeBody} onChange={(e) => setT({ ...t, welcomeBody: e.target.value })} />
                </div>
              </div>
            )}
          </section>

          <section className="panel p-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Intake questions</h2>
              <Button size="sm" variant="outline" onClick={() => setT({ ...t, questions: [...t.questions, { id: uid(), label: "", type: "short", options: [], required: true }] })}>
                <Plus className="size-3.5" /> Add question
              </Button>
            </div>
            {t.questions.length === 0 && <p className="text-sm text-muted-foreground">No questions — the intake step is done straight away.</p>}
            <ol className="space-y-3">
              {t.questions.map((q, i) => (
                <li key={q.id} className="rounded-xl border p-3">
                  <div className="flex gap-2">
                    <span className="mt-2.5 w-5 shrink-0 text-xs font-semibold text-muted-foreground">{i + 1}.</span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} placeholder="Question" aria-label={`Question ${i + 1}`} />
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="w-40">
                          <Select value={q.type} onChange={(e) => setQ(i, { type: e.target.value as QuestionType })} aria-label="Answer type" className="h-9">
                            <option value="short">Short answer</option>
                            <option value="long">Long answer</option>
                            <option value="choice">Multiple choice</option>
                          </Select>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox checked={q.required} onCheckedChange={(v) => setQ(i, { required: v })} /> Required
                        </label>
                      </div>
                      {q.type === "choice" && (
                        <Input
                          value={q.options.join(", ")}
                          onChange={(e) => setQ(i, { options: e.target.value.split(",") })}
                          placeholder="Options, separated by commas"
                          aria-label="Options"
                        />
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col">
                      <Button size="icon" variant="ghost" className="size-8" onClick={() => setT({ ...t, questions: move(t.questions, i, -1) })} disabled={i === 0} aria-label="Move up"><ArrowUp className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-8" onClick={() => setT({ ...t, questions: move(t.questions, i, 1) })} disabled={i === t.questions.length - 1} aria-label="Move down"><ArrowDown className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-8" onClick={() => setT({ ...t, questions: t.questions.filter((_, j) => j !== i) })} aria-label="Remove question"><Trash2 className="size-3.5 text-destructive" /></Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel space-y-3 p-4 sm:p-6">
            <h2 className="font-semibold">Terms</h2>
            <Textarea rows={7} value={t.terms} onChange={(e) => setT({ ...t, terms: e.target.value })} placeholder="Leave empty to skip the terms step." aria-label="Terms" />
          </section>

          <section className="panel p-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Kickoff checklist</h2>
              <Button size="sm" variant="outline" onClick={() => setT({ ...t, checklist: [...t.checklist, { id: uid(), label: "" }] })}><Plus className="size-3.5" /> Add item</Button>
            </div>
            <ul className="space-y-2">
              {t.checklist.map((c, i) => (
                <li key={c.id} className="flex gap-2">
                  <Input value={c.label} onChange={(e) => setT({ ...t, checklist: t.checklist.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Checklist item" aria-label={`Checklist item ${i + 1}`} />
                  <Button size="icon" variant="ghost" onClick={() => setT({ ...t, checklist: t.checklist.filter((_, j) => j !== i) })} aria-label="Remove item"><Trash2 className="size-4 text-destructive" /></Button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="panel h-fit p-4 sm:p-5 lg:sticky lg:top-4">
          <h2 className="text-sm font-semibold">Placeholders</h2>
          <p className="mt-1 text-xs text-muted-foreground">Use these in the email and terms. They&apos;re filled in for each client.</p>
          <ul className="mt-3 space-y-2">
            {PLACEHOLDERS.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-2 text-sm">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{p.key}</code>
                <span className="text-right text-xs text-muted-foreground">{p.desc}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
