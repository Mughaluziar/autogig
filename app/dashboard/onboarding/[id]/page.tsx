"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive, ArrowLeft, Check, CheckCircle2, ChevronDown, ClipboardList, Copy, ExternalLink, FileSignature, Mail, Plus,
  Receipt, Rocket, RotateCcw, Trash2, Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog, type Confirm } from "@/components/security/confirm-dialog";
import { ProgressRing } from "@/components/onboarding/bits";
import {
  progressOf, questionnaireText, stepsOf, uid, useDepositLookup, useOnboarding, type ClientOnboarding, type StepId, type StepState,
} from "@/components/onboarding/model";
import { effectiveStatus } from "@/lib/ledger";
import { useAuth } from "@/lib/auth";
import { cn, formatCurrency, formatRelative } from "@/lib/utils";

const ICON: Record<StepId, typeof Mail> = { welcome: Mail, intake: ClipboardList, terms: FileSignature, deposit: Receipt, kickoff: Rocket };
const fmtDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "");
const mailto = (to: string, subject: string, body: string) => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export default function OnboardingDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = React.use(props.params);
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { state, ready, updateClient, removeClient, invoiceDeposit } = useOnboarding();
  const depositOf = useDepositLookup();
  const [open, setOpen] = React.useState<StepId | null>(null);
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);

  const o = state.clients.find((x) => x.id === params.id);
  const invoice = o ? depositOf(o) : null;
  const steps = o ? stepsOf(o, invoice?.status === "Paid") : [];
  const progress = progressOf(steps);
  const nextOpen = steps.find((s) => !s.done)?.id ?? null;
  // Open the first unfinished step once; after that the user decides.
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (opened.current || !ready || !o) return;
    opened.current = true;
    setOpen(nextOpen);
  }, [ready, o, nextOpen]);

  if (!ready) return <div className="h-96 animate-pulse rounded-2xl bg-muted/60" />;
  if (!o) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <p className="font-semibold">Onboarding not found</p>
        <p className="mt-1 text-sm text-muted-foreground">It may have been deleted.</p>
        <Button asChild variant="outline" className="mt-4"><Link href="/dashboard/onboarding">Back to onboarding</Link></Button>
      </div>
    );
  }

  const patch = (fn: (x: ClientOnboarding) => ClientOnboarding, log?: string) => updateClient(o.id, fn, log);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${what} copied`, variant: "success" });
    } catch {
      toast({ title: "Couldn't copy", description: "Your browser blocked the clipboard." });
    }
  };
  const you = user?.name ?? "";

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3"><Link href="/dashboard/onboarding"><ArrowLeft className="size-4" /> All onboardings</Link></Button>

      <header className="panel mb-6 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <ProgressRing value={progress} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-bold tracking-tight">{o.clientName}</h1>
            <Badge variant={o.status === "completed" ? "success" : o.status === "archived" ? "secondary" : "default"} className="capitalize">{o.status}</Badge>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {o.projectTitle || "Untitled project"}{o.company ? ` · ${o.company}` : ""}{o.projectValue ? ` · ${formatCurrency(o.projectValue)}` : ""} · {o.templateName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.status === "active" ? (
            <Button
              variant={progress >= 100 ? "gradient" : "outline"}
              onClick={() => {
                patch((x) => ({ ...x, status: "completed", completedAt: new Date().toISOString() }), "Onboarding completed");
                toast({ title: `${o.clientName} is onboarded`, variant: "success" });
              }}
              title={progress < 100 ? "Some steps aren't done yet" : undefined}
            >
              <CheckCircle2 className="size-4" /> Complete
            </Button>
          ) : (
            <Button variant="outline" onClick={() => patch((x) => ({ ...x, status: "active", completedAt: undefined }), "Reopened")}>
              <RotateCcw className="size-4" /> Reopen
            </Button>
          )}
          {o.status !== "archived" && (
            <Button variant="ghost" size="icon" aria-label="Archive" title="Archive" onClick={() => patch((x) => ({ ...x, status: "archived" }), "Archived")}>
              <Archive className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete"
            title="Delete"
            onClick={() => setConfirm({
              title: `Delete ${o.clientName}'s onboarding?`,
              body: "Answers, notes and the checklist are removed. A deposit invoice already in Money stays there.",
              confirmLabel: "Delete",
              action: () => { removeClient(o.id); router.push("/dashboard/onboarding"); },
            })}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <StepPanel key={s.id} index={i + 1} step={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)}>
              {s.id === "welcome" && (
                <div className="space-y-3">
                  <Draft label="Subject" value={o.welcome.subject} onCommit={(v) => patch((x) => ({ ...x, welcome: { ...x.welcome, subject: v } }))} />
                  <Draft label="Message" multiline rows={9} value={o.welcome.body} onCommit={(v) => patch((x) => ({ ...x, welcome: { ...x.welcome, body: v } }))} />
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm"><a href={mailto(o.email, o.welcome.subject, o.welcome.body)}><ExternalLink className="size-3.5" /> Open in email app</a></Button>
                    <Button variant="outline" size="sm" onClick={() => copy(`${o.welcome.subject}\n\n${o.welcome.body}`, "Email")}><Copy className="size-3.5" /> Copy</Button>
                    <SentToggle
                      at={o.welcome.sentAt}
                      label="Mark as sent"
                      doneLabel="Sent"
                      onSet={(at) => patch((x) => ({ ...x, welcome: { ...x.welcome, sentAt: at } }), at ? "Welcome email sent" : "Welcome email marked unsent")}
                    />
                  </div>
                  {!o.email && <p className="text-xs text-muted-foreground">Add the client&apos;s email in Client details to address it automatically.</p>}
                </div>
              )}

              {s.id === "intake" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm"><a href={mailto(o.email, `A few questions about ${o.projectTitle || "the project"}`, questionnaireText(o, you))}><ExternalLink className="size-3.5" /> Email the questions</a></Button>
                    <Button variant="outline" size="sm" onClick={() => copy(questionnaireText(o, you), "Questionnaire")}><Copy className="size-3.5" /> Copy questions</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Record the answers here when they reply, or fill them in during your call.</p>
                  {o.questions.length === 0 && <p className="text-sm text-muted-foreground">This onboarding has no questions.</p>}
                  {o.questions.map((q) => (
                    <div key={q.id}>
                      {q.type === "choice" && q.options.length ? (
                        <div className="space-y-1.5">
                          <Label htmlFor={`q-${q.id}`}>{q.label}{!q.required && <span className="text-muted-foreground"> (optional)</span>}</Label>
                          <Select id={`q-${q.id}`} value={o.answers[q.id] ?? ""} onChange={(e) => patch((x) => ({ ...x, answers: { ...x.answers, [q.id]: e.target.value } }))}>
                            <option value="">Not answered</option>
                            {q.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </Select>
                        </div>
                      ) : (
                        <Draft
                          id={`q-${q.id}`}
                          label={`${q.label}${q.required ? "" : " (optional)"}`}
                          multiline={q.type === "long"}
                          rows={3}
                          value={o.answers[q.id] ?? ""}
                          placeholder="Their answer"
                          onCommit={(v) => patch((x) => ({ ...x, answers: { ...x.answers, [q.id]: v } }))}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {s.id === "terms" && o.terms && (
                <div className="space-y-3">
                  <Draft label="Terms" multiline rows={8} value={o.terms.text} onCommit={(v) => patch((x) => ({ ...x, terms: x.terms ? { ...x.terms, text: v } : x.terms }))} />
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <a href={mailto(o.email, `Terms for ${o.projectTitle || "our project"}`, `Hi ${o.clientName.split(" ")[0]},\n\nHere are the terms for ${o.projectTitle || "the project"}. Reply "I agree" to confirm.\n\n${o.terms.text}\n\n${you}`)}>
                        <ExternalLink className="size-3.5" /> Email the terms
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => copy(o.terms!.text, "Terms")}><Copy className="size-3.5" /> Copy</Button>
                    <SentToggle at={o.terms.sentAt} label="Mark as sent" doneLabel="Sent" onSet={(at) => patch((x) => ({ ...x, terms: x.terms ? { ...x.terms, sentAt: at } : x.terms }), at ? "Terms sent" : undefined)} />
                    <SentToggle at={o.terms.acceptedAt} label="Client agreed" doneLabel="Agreed" onSet={(at) => patch((x) => ({ ...x, terms: x.terms ? { ...x.terms, acceptedAt: at } : x.terms }), at ? "Client agreed to the terms" : "Terms agreement undone")} />
                  </div>
                  <p className="text-xs text-muted-foreground">Keep the client&apos;s written &ldquo;I agree&rdquo; reply as your record. This isn&apos;t a legal e-signature.</p>
                </div>
              )}

              {s.id === "deposit" && o.deposit && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-2xl font-bold">{formatCurrency(o.deposit.amount)}</span>
                    <span className="text-sm text-muted-foreground">{o.deposit.percent}% of {formatCurrency(o.projectValue)}</span>
                  </div>
                  {!o.deposit.invoicedAt ? (
                    <>
                      <p className="text-sm text-muted-foreground">Create the deposit invoice in Money, then share its pay link — your client can pay by debit card, credit card or crypto.</p>
                      <Button
                        variant="gradient"
                        size="sm"
                        onClick={() => {
                          const inv = invoiceDeposit(o);
                          toast({ title: `Deposit invoice ${inv?.number ?? ""} created`, description: "Open it in Money to share the pay link.", variant: "success" });
                        }}
                      >
                        <Receipt className="size-3.5" /> Create deposit invoice
                      </Button>
                    </>
                  ) : invoice ? (
                    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{invoice.number} · {invoice.description}</p>
                        <p className="text-xs text-muted-foreground">Created {fmtDay(o.deposit.invoicedAt)} · due {invoice.due}</p>
                      </div>
                      <Badge variant={invoice.status === "Paid" ? "success" : effectiveStatus(invoice) === "Overdue" ? "destructive" : "default"}>{effectiveStatus(invoice)}</Badge>
                      <Button asChild size="sm" variant="outline"><Link href={`/dashboard/money/invoices/${invoice.id}`}>Open in Money</Link></Button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                      The deposit invoice isn&apos;t in Money any more.{" "}
                      <button className="font-medium text-primary hover:underline" onClick={() => invoiceDeposit(o)}>Create it again</button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">This step completes when the invoice is marked paid in Money — automatically when the client pays through the pay link.</p>
                </div>
              )}

              {s.id === "kickoff" && <Checklist o={o} patch={patch} />}
            </StepPanel>
          ))}
        </ol>

        <aside className="space-y-4">
          <ClientDetails o={o} patch={patch} />
          <section className="panel p-4">
            <h2 className="mb-2 text-sm font-semibold">Notes</h2>
            <Draft label="Notes" hideLabel multiline rows={5} value={o.notes} placeholder="Anything to remember about this client…" onCommit={(v) => patch((x) => ({ ...x, notes: v }))} />
          </section>
          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold">Activity</h2>
            <ol className="space-y-2.5">
              {o.log.slice(0, 12).map((l, i) => (
                <li key={`${l.at}-${i}`} className="flex gap-2 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0 flex-1">{l.text}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(l.at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function StepPanel({ index, step, open, onToggle, children }: { index: number; step: StepState; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const Icon = ICON[step.id];
  return (
    <li className={cn("panel overflow-hidden", open && "ring-1 ring-primary/30")}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", step.done ? "bg-success/15 text-success" : "bg-primary/10 text-primary")}>
          {step.done ? <Check className="size-4" /> : <Icon className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold"><span className="text-muted-foreground">{index}.</span> {step.label}</span>
          <span className="block text-xs text-muted-foreground">{step.detail}</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t px-4 py-4 sm:px-5">{children}</div>}
    </li>
  );
}

/** A text field that saves when you leave it, so typing doesn't write on every key. */
function Draft({
  id, label, hideLabel, value, onCommit, multiline, rows, placeholder,
}: {
  id?: string; label: string; hideLabel?: boolean; value: string; onCommit: (v: string) => void; multiline?: boolean; rows?: number; placeholder?: string;
}) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  const fieldId = id ?? `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const commit = () => v !== value && onCommit(v);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId} className={hideLabel ? "sr-only" : undefined}>{label}</Label>
      {multiline ? (
        <Textarea id={fieldId} rows={rows} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />
      ) : (
        <Input id={fieldId} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />
      )}
    </div>
  );
}

function SentToggle({ at, label, doneLabel, onSet }: { at?: string; label: string; doneLabel: string; onSet: (at: string | undefined) => void }) {
  return at ? (
    <Button variant="ghost" size="sm" onClick={() => onSet(undefined)} title="Undo">
      <CheckCircle2 className="size-3.5 text-success" /> {doneLabel} {fmtDay(at)} <Undo2 className="size-3 text-muted-foreground" />
    </Button>
  ) : (
    <Button variant="default" size="sm" onClick={() => onSet(new Date().toISOString())}><Check className="size-3.5" /> {label}</Button>
  );
}

function Checklist({ o, patch }: { o: ClientOnboarding; patch: (fn: (x: ClientOnboarding) => ClientOnboarding, log?: string) => void }) {
  const [item, setItem] = React.useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item.trim()) return;
    patch((x) => ({ ...x, checklist: [...x.checklist, { id: uid(), label: item.trim(), done: false }] }));
    setItem("");
  };
  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {o.checklist.map((c) => (
          <li key={c.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/40">
            <Checkbox
              id={`c-${c.id}`}
              checked={c.done}
              onCheckedChange={(v) => patch((x) => ({ ...x, checklist: x.checklist.map((y) => (y.id === c.id ? { ...y, done: !!v, doneAt: v ? new Date().toISOString() : undefined } : y)) }), v ? `Done: ${c.label}` : undefined)}
            />
            <label htmlFor={`c-${c.id}`} className={cn("flex-1 text-sm", c.done && "text-muted-foreground line-through")}>{c.label}</label>
            <button
              onClick={() => patch((x) => ({ ...x, checklist: x.checklist.filter((y) => y.id !== c.id) }))}
              className="rounded p-1 text-muted-foreground opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
              aria-label={`Remove ${c.label}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add a checklist item" aria-label="New checklist item" />
        <Button type="submit" variant="outline" size="icon" aria-label="Add item"><Plus className="size-4" /></Button>
      </form>
    </div>
  );
}

function ClientDetails({ o, patch }: { o: ClientOnboarding; patch: (fn: (x: ClientOnboarding) => ClientOnboarding, log?: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [f, setF] = React.useState({ clientName: o.clientName, company: o.company, email: o.email, projectTitle: o.projectTitle, startDate: o.startDate });
  React.useEffect(() => setF({ clientName: o.clientName, company: o.company, email: o.email, projectTitle: o.projectTitle, startDate: o.startDate }), [o, editing]);
  const rows: [string, string][] = [
    ["Email", o.email || "—"], ["Company", o.company || "—"], ["Project", o.projectTitle || "—"],
    ["Value", o.projectValue ? formatCurrency(o.projectValue) : "—"], ["Start", o.startDate || "—"], ["Started", fmtDay(o.createdAt)],
  ];
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Client details</h2>
        <button onClick={() => setEditing((v) => !v)} className="text-xs font-medium text-primary hover:underline">{editing ? "Cancel" : "Edit"}</button>
      </div>
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.clientName.trim()) return;
            patch((x) => ({ ...x, ...f, clientName: f.clientName.trim() }), "Client details updated");
            setEditing(false);
          }}
        >
          {(["clientName", "company", "email", "projectTitle"] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`cd-${k}`} className="text-xs">{{ clientName: "Name", company: "Company", email: "Email", projectTitle: "Project" }[k]}</Label>
              <Input id={`cd-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} type={k === "email" ? "email" : "text"} />
            </div>
          ))}
          <div className="min-w-0 space-y-1">
            <Label htmlFor="cd-start" className="text-xs">Start date</Label>
            <Input id="cd-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </div>
          <Button type="submit" size="sm" className="w-full">Save</Button>
        </form>
      ) : (
        <dl className="space-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
