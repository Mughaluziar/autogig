import { ExternalLink, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Upwork is human-in-the-loop only. Shown wherever an Upwork proposal is drafted
 * so nobody mistakes the draft for a submitted proposal.
 */
export function ManualSubmitNotice({ url, className }: { url?: string; className?: string }) {
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm", className)}>
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">You submit this one yourself</p>
        <p className="text-xs text-muted-foreground">
          Review and edit the draft, copy it, then paste it into the proposal form on Upwork and send it from your own account.
          Autopilot never logs in to Upwork, never stores your Upwork password or cookies, and never submits a proposal for you.
        </p>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Open the original job on Upwork <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}
