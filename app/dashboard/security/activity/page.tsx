"use client";
import * as React from "react";
import { History, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Input } from "@/components/ui/input";
import { SectionNav } from "@/components/security/section-nav";
import { EventIcon } from "@/components/security/event-icon";
import { BackendNotice, LoadError } from "@/components/security/backend-notice";
import { SERVER_FEATURES, useApi } from "@/components/security/use-api";
import { KIND_LABEL, SECURITY_LINKS, entryTime, kindOf, type ActivityEntry, type SecurityKind } from "@/components/security/security";
import { cn } from "@/lib/utils";

const FILTERS: ("security" | SecurityKind | "all")[] = ["security", "signin", "account", "keys", "team", "all"];
const FILTER_LABEL: Record<(typeof FILTERS)[number], string> = { security: "All security", all: "Everything", ...KIND_LABEL };

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export default function SecurityActivityPage() {
  const { data, loading, error, reload } = useApi<ActivityEntry[]>("/api/audit-log");
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("security");
  const [q, setQ] = React.useState("");

  const entries = (data ?? []).filter((e) => {
    const kind = kindOf(e);
    if (filter === "security" ? kind === "other" : filter !== "all" && kind !== filter) return false;
    return !q.trim() || e.action.toLowerCase().includes(q.trim().toLowerCase());
  });
  const counts = Object.fromEntries(FILTERS.map((f) => [f, (data ?? []).filter((e) => {
    const k = kindOf(e);
    return f === "all" || (f === "security" ? k !== "other" : k === f);
  }).length]));

  const groups: { day: string; items: ActivityEntry[] }[] = [];
  for (const e of entries) {
    const day = dayLabel(entryTime(e));
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <>
      <PageHeader title="Account activity" description="Sign-ins, password and email changes, API keys and team changes — kept for 180 days." />
      <SectionNav links={SECURITY_LINKS} />

      {!SERVER_FEATURES ? (
        <BackendNotice feature="Account activity" />
      ) : error ? (
        <LoadError message={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="h-64 animate-pulse rounded-2xl bg-muted/60" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
              <div className="inline-flex min-w-max gap-1 rounded-lg bg-muted p-1">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn("rounded-md px-3 py-1.5 text-sm font-medium", filter === f ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {FILTER_LABEL[f]} <span className="text-xs text-muted-foreground">{counts[f]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="relative lg:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activity" className="pl-9" aria-label="Search activity" />
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="panel flex flex-col items-center px-6 py-12 text-center">
              <History className="size-8 text-muted-foreground" />
              <p className="mt-3 font-medium">Nothing here</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">{(data ?? []).length ? "No activity matches this filter." : "Activity appears as you sign in and change settings."}</p>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.day} className="panel overflow-hidden">
                <header className="border-b bg-muted/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5">{g.day}</header>
                <ul className="divide-y">
                  {g.items.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                      <EventIcon entry={e} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{e.action}</p>
                        <p className="text-xs text-muted-foreground">{e.agent === "Operator" ? "You" : e.agent} · {KIND_LABEL[kindOf(e)]}</p>
                      </div>
                      <time className="shrink-0 text-xs text-muted-foreground" dateTime={entryTime(e)}>
                        {new Date(entryTime(e)).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}
                      </time>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          <p className="text-xs text-muted-foreground">Don&apos;t recognise a sign-in? Change your password and revoke any API keys you didn&apos;t create.</p>
        </div>
      )}
    </>
  );
}
