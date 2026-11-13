"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SectionNav } from "@/components/security/section-nav";
import { ConfirmDialog, type Confirm } from "@/components/security/confirm-dialog";
import { ONBOARDING_LINKS, blankTemplate, uid, useOnboarding, type Template } from "@/components/onboarding/model";
import { formatRelative } from "@/lib/utils";

export default function OnboardingTemplatesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { state, ready, saveTemplate, removeTemplate } = useOnboarding();
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);

  const create = (from?: Template) => {
    const t: Template = from
      ? { ...from, id: `tpl-${uid()}`, name: `${from.name} (copy)`, questions: from.questions.map((q) => ({ ...q, id: uid() })), checklist: from.checklist.map((c) => ({ ...c, id: uid() })) }
      : blankTemplate();
    saveTemplate(t);
    router.push(`/dashboard/onboarding/templates/${t.id}`);
  };

  const usedBy = (id: string) => state.clients.filter((o) => o.templateId === id && o.status === "active").length;

  return (
    <>
      <PageHeader
        title="Onboarding templates"
        description="Your repeatable onboarding playbooks: the questions you ask, the terms you use, the deposit you take and your kickoff checklist."
        actions={<Button variant="gradient" onClick={() => create()} disabled={!ready}><Plus className="size-4" /> New template</Button>}
      />
      <SectionNav links={ONBOARDING_LINKS} />

      {!ready ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted/60" />)}</div>
      ) : state.templates.length === 0 ? (
        <div className="panel flex flex-col items-center px-6 py-12 text-center">
          <LayoutTemplate className="size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No templates</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Templates save you setting up the same questions and terms for every client.</p>
          <Button className="mt-4" variant="outline" onClick={() => create()}><Plus className="size-4" /> Create a template</Button>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {state.templates.map((t) => (
            <li key={t.id} className="panel flex flex-col p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{t.description || "No description"}</p>
                </div>
                {usedBy(t.id) > 0 && <Badge variant="secondary" className="shrink-0">{usedBy(t.id)} active</Badge>}
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/50 p-2"><dt className="text-[11px] text-muted-foreground">Questions</dt><dd className="font-semibold">{t.questions.length}</dd></div>
                <div className="rounded-lg bg-muted/50 p-2"><dt className="text-[11px] text-muted-foreground">Checklist</dt><dd className="font-semibold">{t.checklist.length}</dd></div>
                <div className="rounded-lg bg-muted/50 p-2"><dt className="text-[11px] text-muted-foreground">Deposit</dt><dd className="font-semibold">{t.depositPercent ? `${t.depositPercent}%` : "—"}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">{t.terms.trim() ? "Includes terms" : "No terms step"} · edited {formatRelative(t.updatedAt)}</p>
              <div className="mt-4 flex gap-2">
                <Button asChild size="sm" variant="outline" className="flex-1"><Link href={`/dashboard/onboarding/templates/${t.id}`}><Pencil className="size-3.5" /> Edit</Link></Button>
                <Button size="sm" variant="ghost" onClick={() => create(t)} aria-label={`Duplicate ${t.name}`}><Copy className="size-3.5" /></Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${t.name}`}
                  onClick={() => setConfirm({
                    title: `Delete "${t.name}"?`,
                    body: "Onboardings already started from it keep their own copy.",
                    confirmLabel: "Delete",
                    action: () => { removeTemplate(t.id); toast({ title: "Template deleted", variant: "success" }); },
                  })}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
