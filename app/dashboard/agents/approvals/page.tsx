"use client";
import * as React from "react";
import Link from "next/link";
import { CheckCheck, Inbox, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pendingApprovals, type ApprovalKind } from "@/lib/fleet";
import { useFleet } from "@/components/agents/fleet-provider";
import { ApprovalCard } from "@/components/agents/approval-card";

const KINDS: { id: "all" | ApprovalKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "proposal", label: "Proposals" },
  { id: "reply", label: "Replies" },
  { id: "follow-up", label: "Follow-ups" },
];

export default function ApprovalsPage() {
  const { fleet, ready, resolveApproval } = useFleet();
  const [view, setView] = React.useState<"pending" | "history">("pending");
  const [kind, setKind] = React.useState<(typeof KINDS)[number]["id"]>("all");
  const [sort, setSort] = React.useState<"best" | "newest">("best");
  const pending = pendingApprovals(fleet);
  const list = (view === "pending" ? pending : fleet.approvals.filter((a) => a.status !== "pending"))
    .filter((a) => kind === "all" || a.kind === kind)
    .sort((a, b) => (view === "pending" && sort === "best"
      ? (b.matchScore ?? 0) - (a.matchScore ?? 0) || b.createdAt.localeCompare(a.createdAt)
      : (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt)));
  const weekAgo = Date.now() - 7 * 86_400_000;
  const approvedWeek = fleet.approvals.filter((a) => a.status === "approved" && Date.parse(a.resolvedAt ?? "") > weekAgo).length;

  const rejectShown = () => {
    if (!window.confirm(`Reject all ${list.length} shown drafts?`)) return;
    list.forEach((a) => resolveApproval(a.id, "rejected"));
  };

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 h-1 w-10 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" />
          <h1 className="text-3xl font-bold tracking-tight">Approvals</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            Everything your agents drafted for clients. Approving copies the text and opens the listing or thread, so you send it yourself.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCheck className="size-4 text-success" /> {approvedWeek} approved this week
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-muted p-1">
          {(["pending", "history"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", view === v ? "bg-background shadow-sm" : "text-muted-foreground")}>
              {v === "pending" ? `Waiting (${pending.length})` : "History"}
            </button>
          ))}
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => setKind(k.id)}
              className={cn("shrink-0 rounded-full px-3 py-1 text-xs", kind === k.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>
              {k.label}
            </button>
          ))}
        </div>
        {view === "pending" && (
          <div className="ml-auto flex items-center gap-2">
            <select value={sort} onChange={(e) => setSort(e.target.value as "best" | "newest")} className="h-8 rounded-md border border-input bg-background px-2 text-xs" aria-label="Sort">
              <option value="best">Best match first</option>
              <option value="newest">Newest first</option>
            </select>
            {list.length > 1 && <Button size="sm" variant="ghost" className="h-8" onClick={rejectShown}><X /> Reject shown</Button>}
          </div>
        )}
      </div>

      {!ready ? (
        <div className="panel h-40 animate-pulse" />
      ) : list.length === 0 ? (
        <div className="panel flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Inbox className="size-6" /></span>
          <p className="font-medium">{view === "pending" ? "You're all caught up" : "No history yet"}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {view === "pending" ? "When Writer, Closer or Applier draft something, it waits here for you." : "Approved and rejected drafts show up here."}
          </p>
          {view === "pending" && <Button variant="outline" asChild><Link href="/dashboard/agents">Back to the fleet</Link></Button>}
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {list.map((a) => <ApprovalCard key={a.id} approval={a} />)}
        </div>
      )}
    </>
  );
}
