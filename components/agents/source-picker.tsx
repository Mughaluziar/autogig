"use client";
import * as React from "react";
import { Check } from "lucide-react";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import { HAS_BACKEND, useFleet } from "./fleet-provider";

type SourceRow = { id: string; name: string; enabled: boolean; kind: string; reason?: string };

/** Job Radar sources enabled on this server, plus any Scout has already seen. */
export function useSourceNames(): { names: string[]; loading: boolean } {
  const { fleet } = useFleet();
  const [server, setServer] = React.useState<SourceRow[] | null>(null);
  React.useEffect(() => {
    if (!HAS_BACKEND) return;
    let cancelled = false;
    apiGet<{ sources: SourceRow[] }>("/api/radar/sources").then((res) => {
      if (!cancelled) setServer(res?.sources ?? []);
    });
    return () => { cancelled = true; };
  }, []);
  const seen = Object.keys(fleet.sources ?? {});
  const names = Array.from(new Set([...(server ?? []).filter((s) => s.enabled).map((s) => s.name), ...seen])).sort();
  return { names, loading: HAS_BACKEND && server === null };
}

/** Toggle chips; an empty selection means "every source". */
export function SourcePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { names, loading } = useSourceNames();
  const all = value.length === 0;
  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((v) => v !== name) : [...value, name]);
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange([])}
        className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", all ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
      >
        {all && <Check className="size-3" />} Every source
      </button>
      {names.map((n) => {
        const on = value.includes(n);
        return (
          <button
            key={n}
            type="button"
            onClick={() => toggle(n)}
            className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", on ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {on && <Check className="size-3" />} {n}
          </button>
        );
      })}
      {loading && <span className="px-1 py-1 text-xs text-muted-foreground">Loading sources…</span>}
      {!loading && names.length === 0 && (
        <span className="px-1 py-1 text-xs text-muted-foreground">Sources appear here after Scout's first scan.</span>
      )}
      {value.filter((v) => !names.includes(v)).map((n) => (
        <button key={n} type="button" onClick={() => toggle(n)} className="inline-flex items-center gap-1 rounded-full border border-primary/60 bg-primary/15 px-2.5 py-1 text-xs text-primary">
          <Check className="size-3" /> {n}
        </button>
      ))}
    </div>
  );
}
