"use client";
/**
 * Client onboarding — the freelancer's own checklist for bringing a new
 * client on board: welcome email, intake questions, terms, a deposit invoice
 * and a kickoff checklist. Clients don't log in anywhere; the freelancer
 * sends things from their own email and records what came back.
 *
 * Saved in the workspace slice `onboarding` (per user, on the server when a
 * backend is connected). The deposit is a real invoice in the Money ledger;
 * its paid state is read from there, so the two never disagree.
 */
import * as React from "react";
import { ClipboardList, FilePlus2, LayoutTemplate } from "lucide-react";
import { useWorkspaceSlice } from "@/lib/demo-store";
import { useLedger, todayStr } from "@/lib/ledger";
import type { SectionLink } from "@/components/security/section-nav";

export type QuestionType = "short" | "long" | "choice";
export type Question = { id: string; label: string; type: QuestionType; options: string[]; required: boolean };
export type ChecklistItem = { id: string; label: string };

export type Template = {
  id: string;
  name: string;
  description: string;
  questions: Question[];
  checklist: ChecklistItem[];
  /** Terms the client agrees to. Empty: no terms step. */
  terms: string;
  /** Deposit as % of the project value. 0: no deposit step. */
  depositPercent: number;
  welcomeSubject: string;
  welcomeBody: string;
  createdAt: string;
  updatedAt: string;
};

export type StepId = "welcome" | "intake" | "terms" | "deposit" | "kickoff";
export type LogEntry = { at: string; text: string };

export type ClientOnboarding = {
  id: string;
  clientName: string;
  company: string;
  email: string;
  projectTitle: string;
  projectValue: number;
  startDate: string;
  templateId: string;
  templateName: string;
  questions: Question[];
  answers: Record<string, string>;
  checklist: (ChecklistItem & { done: boolean; doneAt?: string })[];
  terms: { text: string; sentAt?: string; acceptedAt?: string } | null;
  deposit: { percent: number; amount: number; description: string; invoicedAt?: string; invoiceId?: string; invoiceNumber?: string } | null;
  welcome: { subject: string; body: string; sentAt?: string };
  status: "active" | "completed" | "archived";
  notes: string;
  log: LogEntry[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type OnboardingState = { v: 1; templates: Template[]; clients: ClientOnboarding[] };

export const ONBOARDING_LINKS: SectionLink[] = [
  { href: "/dashboard/onboarding", label: "Clients", icon: ClipboardList },
  { href: "/dashboard/onboarding/new", label: "Start onboarding", icon: FilePlus2 },
  { href: "/dashboard/onboarding/templates", label: "Templates", icon: LayoutTemplate },
];

export const PLACEHOLDERS = [
  { key: "{{client}}", desc: "Client's first name" },
  { key: "{{company}}", desc: "Client's company" },
  { key: "{{project}}", desc: "Project title" },
  { key: "{{start}}", desc: "Start date" },
  { key: "{{deposit}}", desc: "Deposit amount" },
  { key: "{{you}}", desc: "Your name" },
];

export const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const q = (label: string, type: QuestionType = "short", required = true, options: string[] = []): Question => ({ id: uid(), label, type, options, required });
const c = (label: string): ChecklistItem => ({ id: uid(), label });

// Starter templates — product content a new account can edit or delete.
function starterTemplates(): Template[] {
  const stamp = "2026-01-01T00:00:00.000Z";
  return [
    {
      id: "tpl-project", name: "Fixed-price project", description: "Website, app or design project with a deposit up front.",
      questions: [
        q("What's the main goal of this project?", "long"),
        q("Who is it for (your audience or users)?", "long"),
        q("Links to anything you like (sites, apps, brands)", "long", false),
        q("Hard deadline or launch date?", "short", false),
        q("Who signs off on the work?"),
        q("Preferred way to communicate", "choice", true, ["Email", "Slack", "WhatsApp", "Video calls"]),
      ],
      checklist: [c("Shared project folder created"), c("Kickoff call booked"), c("Access and logins received"), c("Milestones agreed"), c("Project added to calendar")],
      terms: "Scope: as described in the proposal for {{project}}. Changes outside it are quoted separately.\nPayment: {{deposit}} deposit before work starts; the balance on delivery.\nRevisions: two rounds per milestone.\nOwnership: you own the final work once it's paid in full.\nCancellation: the deposit covers work already started and isn't refundable.",
      depositPercent: 30,
      welcomeSubject: "Welcome aboard — next steps for {{project}}",
      welcomeBody: "Hi {{client}},\n\nThanks for choosing to work together on {{project}} — I'm excited to get started on {{start}}.\n\nHere's what happens next:\n1. I'll send a short questionnaire so I understand your goals.\n2. You'll get the project terms to review.\n3. A {{deposit}} deposit invoice secures your start date.\n4. We'll book a kickoff call.\n\nAny questions in the meantime, just reply to this email.\n\nBest,\n{{you}}",
      createdAt: stamp, updatedAt: stamp,
    },
    {
      id: "tpl-retainer", name: "Monthly retainer", description: "Ongoing work billed monthly, first month up front.",
      questions: [
        q("What should I focus on in the first month?", "long"),
        q("How many hours or deliverables do you expect each month?"),
        q("Who's my day-to-day contact?"),
        q("Tools you already use", "long", false),
        q("Reporting cadence", "choice", true, ["Weekly", "Every two weeks", "Monthly"]),
      ],
      checklist: [c("Added to client's tools"), c("Recurring check-in booked"), c("First month's priorities agreed"), c("Monthly invoice reminder set")],
      terms: "Retainer: billed monthly in advance for {{project}}.\nUnused hours don't roll over.\nEither side can end the retainer with 30 days' notice.",
      depositPercent: 100,
      welcomeSubject: "Getting our retainer started",
      welcomeBody: "Hi {{client}},\n\nWelcome! I'm looking forward to working with {{company}} every month.\n\nTo get going, I'll send a few questions about priorities and the first month's invoice ({{deposit}}). Once that's sorted we'll set up a regular check-in.\n\nTalk soon,\n{{you}}",
      createdAt: stamp, updatedAt: stamp,
    },
    {
      id: "tpl-quick", name: "Quick gig", description: "Small job — no deposit, just the essentials.",
      questions: [q("What do you need done?", "long"), q("When do you need it by?"), q("Any files or examples to share?", "long", false)],
      checklist: [c("Files received"), c("Delivery date confirmed")],
      terms: "",
      depositPercent: 0,
      welcomeSubject: "Thanks — let's get {{project}} done",
      welcomeBody: "Hi {{client}},\n\nThanks for the work! I'll get started on {{project}} right away. Reply with any files or details and I'll take it from there.\n\n{{you}}",
      createdAt: stamp, updatedAt: stamp,
    },
  ];
}

export const INITIAL: OnboardingState = { v: 1, templates: starterTemplates(), clients: [] };

export function fill(text: string, o: Pick<ClientOnboarding, "clientName" | "company" | "projectTitle" | "startDate"> & { deposit?: number }, you: string) {
  const first = o.clientName.trim().split(/\s+/)[0] || "there";
  const start = o.startDate ? new Date(`${o.startDate}T00:00:00`).toLocaleDateString("en", { month: "long", day: "numeric" }) : "our start date";
  const deposit = o.deposit ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(o.deposit) : "the";
  return text
    .replace(/\{\{client\}\}/g, first)
    .replace(/\{\{company\}\}/g, o.company || o.clientName || "your company")
    .replace(/\{\{project\}\}/g, o.projectTitle || "the project")
    .replace(/\{\{start\}\}/g, start)
    .replace(/\{\{deposit\}\}/g, deposit)
    .replace(/\{\{you\}\}/g, you || "Me");
}

export type StepState = { id: StepId; label: string; done: boolean; detail: string };

/** Steps that apply to this onboarding, with their state. */
export function stepsOf(o: ClientOnboarding, depositPaid: boolean): StepState[] {
  const required = o.questions.filter((x) => x.required);
  const answered = o.questions.filter((x) => (o.answers[x.id] ?? "").trim()).length;
  const intakeDone = required.length ? required.every((x) => (o.answers[x.id] ?? "").trim()) : answered > 0 || o.questions.length === 0;
  const doneItems = o.checklist.filter((x) => x.done).length;
  const steps: StepState[] = [
    { id: "welcome", label: "Welcome email", done: !!o.welcome.sentAt, detail: o.welcome.sentAt ? "Sent" : "Not sent yet" },
    { id: "intake", label: "Intake questions", done: intakeDone, detail: `${answered} of ${o.questions.length} answered` },
  ];
  if (o.terms) steps.push({ id: "terms", label: "Terms agreed", done: !!o.terms.acceptedAt, detail: o.terms.acceptedAt ? "Accepted" : o.terms.sentAt ? "Sent, waiting" : "Not sent yet" });
  if (o.deposit) steps.push({ id: "deposit", label: "Deposit paid", done: depositPaid, detail: depositPaid ? "Paid" : o.deposit.invoicedAt ? "Invoice sent" : "No invoice yet" });
  steps.push({ id: "kickoff", label: "Kickoff checklist", done: o.checklist.length > 0 && doneItems === o.checklist.length, detail: `${doneItems} of ${o.checklist.length} done` });
  return steps;
}

export const progressOf = (steps: StepState[]) => (steps.length ? Math.round((steps.filter((s) => s.done).length / steps.length) * 100) : 0);

/** The deposit invoice in the Money ledger, matched by client + description. */
export function useDepositLookup() {
  const ledger = useLedger();
  return React.useCallback(
    (o: ClientOnboarding) => {
      if (!o.deposit?.invoicedAt) return null;
      const d = o.deposit;
      return ledger.invoices.find((i) => (d.invoiceId ? i.id === d.invoiceId : i.client === o.clientName && i.description === d.description)) ?? null;
    },
    [ledger.invoices]
  );
}

export function useOnboarding() {
  const [raw, setRaw, ready] = useWorkspaceSlice<OnboardingState>("onboarding", INITIAL);
  const state: OnboardingState = raw?.v === 1 ? raw : INITIAL;
  const ledger = useLedger();

  const update = React.useCallback((fn: (s: OnboardingState) => OnboardingState) => setRaw((cur) => fn(cur?.v === 1 ? cur : INITIAL)), [setRaw]);

  const updateClient = React.useCallback(
    (id: string, fn: (o: ClientOnboarding) => ClientOnboarding, logText?: string) =>
      update((s) => ({
        ...s,
        clients: s.clients.map((o) => {
          if (o.id !== id) return o;
          const next = fn(o);
          return { ...next, updatedAt: now(), log: logText ? [{ at: now(), text: logText }, ...next.log].slice(0, 50) : next.log };
        }),
      })),
    [update]
  );

  const createClient = React.useCallback(
    (input: { clientName: string; company: string; email: string; projectTitle: string; projectValue: number; startDate: string; templateId: string; you: string }) => {
      const t = state.templates.find((x) => x.id === input.templateId) ?? state.templates[0];
      const id = uid();
      const deposit = t && t.depositPercent > 0 ? Math.round(input.projectValue * t.depositPercent) / 100 : 0;
      const base = { clientName: input.clientName, company: input.company, projectTitle: input.projectTitle, startDate: input.startDate, deposit };
      const record: ClientOnboarding = {
        id, clientName: input.clientName.trim(), company: input.company.trim(), email: input.email.trim(), projectTitle: input.projectTitle.trim(),
        projectValue: input.projectValue, startDate: input.startDate, templateId: t?.id ?? "", templateName: t?.name ?? "Custom",
        questions: (t?.questions ?? []).map((x) => ({ ...x })), answers: {},
        checklist: (t?.checklist ?? []).map((x) => ({ ...x, done: false })),
        terms: t?.terms.trim() ? { text: fill(t.terms, base, input.you) } : null,
        deposit: t && t.depositPercent > 0 && input.projectValue > 0
          ? { percent: t.depositPercent, amount: deposit, description: `Deposit (${t.depositPercent}%) — ${input.projectTitle.trim() || "project"}` }
          : null,
        welcome: { subject: fill(t?.welcomeSubject ?? "Welcome aboard", base, input.you), body: fill(t?.welcomeBody ?? "", base, input.you) },
        status: "active", notes: "", log: [{ at: now(), text: `Onboarding started from "${t?.name ?? "Custom"}"` }],
        createdAt: now(), updatedAt: now(),
      };
      update((s) => ({ ...s, clients: [record, ...s.clients] }));
      return id;
    },
    [state.templates, update]
  );

  const removeClient = React.useCallback((id: string) => update((s) => ({ ...s, clients: s.clients.filter((o) => o.id !== id) })), [update]);

  /** Creates the deposit invoice in Money, due in 7 days. */
  const invoiceDeposit = React.useCallback(
    (o: ClientOnboarding) => {
      if (!o.deposit) return;
      const due = new Date(Date.now() + 7 * 86_400_000);
      const dueStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
      const inv = ledger.addInvoice({ client: o.clientName, email: o.email, amount: o.deposit.amount, issued: todayStr(), due: dueStr, description: o.deposit.description, status: "Sent" });
      updateClient(
        o.id,
        (x) => ({ ...x, deposit: x.deposit ? { ...x.deposit, invoicedAt: now(), invoiceId: inv?.id, invoiceNumber: inv?.number } : null }),
        `Deposit invoice ${inv?.number ?? ""} created in Money`.replace("  ", " ")
      );
      return inv;
    },
    [ledger, updateClient]
  );

  const saveTemplate = React.useCallback(
    (t: Template) =>
      update((s) => ({
        ...s,
        templates: s.templates.some((x) => x.id === t.id)
          ? s.templates.map((x) => (x.id === t.id ? { ...t, updatedAt: now() } : x))
          : [...s.templates, { ...t, createdAt: now(), updatedAt: now() }],
      })),
    [update]
  );
  const removeTemplate = React.useCallback((id: string) => update((s) => ({ ...s, templates: s.templates.filter((t) => t.id !== id) })), [update]);

  return { state, ready, updateClient, createClient, removeClient, invoiceDeposit, saveTemplate, removeTemplate };
}

export function blankTemplate(): Template {
  return {
    id: `tpl-${uid()}`, name: "New template", description: "",
    questions: [q("What's the main goal of this project?", "long")], checklist: [c("Kickoff call booked")],
    terms: "", depositPercent: 0, welcomeSubject: "Welcome aboard — {{project}}",
    welcomeBody: "Hi {{client}},\n\nThanks for working with me on {{project}}. Here's what happens next…\n\n{{you}}",
    createdAt: now(), updatedAt: now(),
  };
}

export const questionnaireText = (o: ClientOnboarding, you: string) =>
  `Hi ${o.clientName.trim().split(/\s+/)[0] || "there"},\n\nA few quick questions so I can get ${o.projectTitle || "the project"} right:\n\n${o.questions
    .map((x, i) => `${i + 1}. ${x.label}${x.type === "choice" && x.options.length ? ` (${x.options.join(" / ")})` : ""}${x.required ? "" : " (optional)"}`)
    .join("\n")}\n\nJust reply to this email with your answers.\n\nThanks,\n${you}`;

export const today = todayStr;
