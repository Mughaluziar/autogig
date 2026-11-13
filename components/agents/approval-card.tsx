"use client";
import * as React from "react";
import { Check, ExternalLink, MessageCircle, Pencil, PenLine, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn, formatRelative } from "@/lib/utils";
import { formatBudget, type Approval } from "@/lib/fleet";
import { useFleet } from "./fleet-provider";

const KIND_LABEL: Record<Approval["kind"], { label: string; icon: React.ComponentType<{ className?: string }>; verb: string }> = {
  proposal: { label: "Proposal", icon: PenLine, verb: "Approve & open listing" },
  reply: { label: "Reply", icon: MessageCircle, verb: "Approve & open thread" },
  "follow-up": { label: "Follow-up", icon: Undo2, verb: "Approve & open" },
};

function MatchRing({ score }: { score: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-11 shrink-0" title={`${score}% match`}>
      <svg viewBox="0 0 40 40" className="size-11 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" className="stroke-muted" strokeWidth="4" />
        <circle cx="20" cy="20" r={r} fill="none" stroke="hsl(var(--primary))" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold">{score}</span>
    </div>
  );
}

export function ApprovalCard({ approval, compact }: { approval: Approval; compact?: boolean }) {
  const { resolveApproval } = useFleet();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState(approval.body);
  const [expanded, setExpanded] = React.useState(!compact);
  React.useEffect(() => setBody(approval.body), [approval.body]);
  const meta = KIND_LABEL[approval.kind];
  const pending = approval.status === "pending";

  const approve = () => {
    resolveApproval(approval.id, "approved", body);
    toast({
      title: "Copied to your clipboard",
      description: approval.url
        ? `Paste it on ${approval.job?.source || "the platform"} and send it.${approval.kind === "proposal" ? " It's now marked Applied in your Job Radar pipeline." : ""}`
        : "Paste it where you reply to this client.",
      variant: "success",
    });
  };

  return (
    <article className={cn("panel p-4", !pending && "opacity-70")}>
      <div className="flex items-start gap-3">
        {approval.matchScore != null ? <MatchRing score={approval.matchScore} /> : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><meta.icon className="size-5" /></span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">{meta.label}</span>
            <span>by {approval.agentName}</span>
            <span>· {formatRelative(approval.createdAt)}</span>
            {approval.aiGenerated === false && <span className="rounded-full bg-muted px-2 py-0.5">Template</span>}
            {!pending && (
              <span className={cn("rounded-full px-2 py-0.5 font-medium", approval.status === "approved" ? "bg-success/15 text-success" : "bg-muted")}>
                {approval.status === "approved" ? "Approved" : "Rejected"}
              </span>
            )}
          </div>
          <h3 className="mt-1 break-words font-semibold leading-snug">{approval.title}</h3>
          {approval.subtitle && <p className="mt-0.5 break-words text-sm text-muted-foreground">{approval.subtitle}</p>}
          {approval.job && (
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-md bg-muted px-1.5 py-0.5">{formatBudget(approval.job)}</span>
              {approval.job.tags.slice(0, 4).map((t) => <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">{t}</span>)}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        {editing ? (
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="text-sm" aria-label="Edit draft" />
        ) : (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full text-left">
            <p className={cn("whitespace-pre-line rounded-xl bg-muted/50 p-3 text-sm leading-relaxed", !expanded && "line-clamp-3")}>{body}</p>
          </button>
        )}
      </div>

      {pending && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="gradient" onClick={approve}><Check /> {meta.verb}</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
            <Pencil /> {editing ? "Done editing" : "Edit"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => resolveApproval(approval.id, "rejected")}><X /> Reject</Button>
          {approval.url && (
            <a href={approval.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              View listing <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </article>
  );
}
