"use client";
import * as React from "react";
import { CheckCircle2, Circle, CircleDashed, Loader2, PauseCircle, Send, ShieldCheck, Sparkles, X, Zap, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ApplyJob, Listing } from "./types";

const GENERIC_COMPANY = /(employer|client)$/i;

/** Checks computed from the draft itself — not a static checklist. */
export function proposalChecks(text: string, listing: Listing) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lower = text.toLowerCase();
  const titleWords = listing.title.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 3);
  const checks = [
    { label: "Refers to this listing, not a generic pitch", ok: titleWords.some((w) => lower.includes(w)) },
    ...(!GENERIC_COMPANY.test(listing.company) && listing.company.length > 1
      ? [{ label: `Mentions ${listing.company}`, ok: lower.includes(listing.company.toLowerCase().split(" ")[0]) }] : []),
    { label: "Lays out concrete next steps", ok: /\b(1\)|1\.|first|step|plan|then|week)\b/i.test(text) },
    { label: "Ends with a question", ok: /\?\s*$/.test(text.trim()) },
    { label: "Short enough to read in 30 seconds (under 220 words)", ok: words > 0 && words <= 220 },
  ];
  return { words, checks };
}

export function Composer({ listing, label, text, setText, generate, generating, save, saving, placeholder }: {
  listing: Listing; label: string; text: string; setText: (v: string) => void;
  generate: (tone: string) => void; generating: boolean; save: () => void; saving: boolean; placeholder: string;
}) {
  const [tone, setTone] = React.useState("professional");
  const { words, checks } = proposalChecks(text, listing);
  const passed = checks.filter((c) => c.ok).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={tone} onChange={(e) => setTone(e.target.value)} className="h-9 w-36 text-xs" aria-label="Tone">
          <option value="professional">Professional</option>
          <option value="friendly and warm">Friendly</option>
          <option value="concise and direct">Concise</option>
          <option value="confident and persuasive">Persuasive</option>
        </Select>
        <Button size="sm" variant="gradient" onClick={() => generate(tone)} disabled={generating}>
          {generating ? <Loader2 className="animate-spin" /> : <Sparkles />} {text ? "Rewrite with AI" : "Write with AI"}
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={save} disabled={saving || !text.trim()}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} Save draft
        </Button>
      </div>
      <Textarea rows={11} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
        aria-label={label} className="text-sm leading-relaxed" />
      <div className="rounded-xl bg-muted/40 p-3">
        <p className="mb-2 flex items-center justify-between text-xs font-semibold">
          Quality check <span className="font-normal tabular-nums text-muted-foreground">{words} words · {passed}/{checks.length}</span>
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {checks.map((c) => (
            <li key={c.label} className={cn("flex items-start gap-1.5 text-[11px]", c.ok ? "text-foreground" : "text-muted-foreground")}>
              {c.ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-success" /> : <Circle className="mt-px size-3.5 shrink-0" />}
              {c.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The automation engine's prepared steps, with approve/cancel. */
export function AutoApplyPanel({ job, busy, onPrepare, onApprove, onCancel, disabled, note }: {
  job: ApplyJob | null; busy: boolean; onPrepare: () => void; onApprove: () => void; onCancel: () => void;
  disabled?: boolean; note: string;
}) {
  return (
    <div className="rounded-xl border p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Zap className="size-4 text-primary" /> Auto-apply
        {job && job.engine !== "worker" && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Simulation</span>}
        {job && <span className="ml-auto text-xs font-normal capitalize text-muted-foreground">{job.status.replace("_", " ")}</span>}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      {!job ? (
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onPrepare} disabled={busy || disabled}>
          {busy ? <Loader2 className="animate-spin" /> : <Zap />} Prepare it for me
        </Button>
      ) : (
        <>
          <ol className="mt-3 space-y-1.5">
            {job.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                {s.status === "done" ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-success" />
                  : s.status === "paused" ? <PauseCircle className="mt-px size-3.5 shrink-0 text-warning" />
                  : s.status === "failed" ? <X className="mt-px size-3.5 shrink-0 text-destructive" />
                  : <CircleDashed className="mt-px size-3.5 shrink-0 text-muted-foreground" />}
                <span className={cn(s.status === "paused" && "font-medium text-warning")}>
                  {s.step}{s.detail && <span className="block text-muted-foreground">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
          {job.status === "needs_approval" && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-warning/10 p-2.5">
              <ShieldCheck className="size-4 shrink-0 text-warning" />
              <p className="flex-1 text-[11px] text-muted-foreground">Ready. Nothing is sent until you approve.</p>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onCancel}>Cancel</Button>
              <Button size="sm" variant="gradient" className="h-8 text-xs" onClick={onApprove} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Approve
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function StepHeading({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{n}</span>
      <div>
        <h2 className="font-semibold leading-7">{title}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
