"use client";
import * as React from "react";
import { Briefcase, Building2, LineChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { PERSONAS, PERSONA_COPY, PERSONA_KEY, type Persona } from "@/lib/landing";

type Ctx = { persona: Persona; setPersona: (p: Persona) => void };
const PersonaContext = React.createContext<Ctx>({ persona: "freelancer", setPersona: () => {} });

const isPersona = (v: unknown): v is Persona => typeof v === "string" && (PERSONAS as string[]).includes(v);

/**
 * Who's reading: freelancer (default), agency or investor. A `?for=` link
 * (from an ad or an email) wins, then the visitor's last choice. Server HTML
 * is the freelancer pitch, so the page is complete without JavaScript.
 */
export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [persona, setState] = React.useState<Persona>("freelancer");
  React.useEffect(() => {
    let next: string | null = null;
    try {
      next = new URLSearchParams(window.location.search).get("for") || localStorage.getItem(PERSONA_KEY);
    } catch { /* storage blocked */ }
    if (isPersona(next)) setState(next);
  }, []);
  const setPersona = React.useCallback((p: Persona) => {
    setState(p);
    try { localStorage.setItem(PERSONA_KEY, p); } catch { /* storage blocked */ }
  }, []);
  const value = React.useMemo(() => ({ persona, setPersona }), [persona, setPersona]);
  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export const usePersona = () => React.useContext(PersonaContext);

const ICONS: Record<Persona, React.ElementType> = { freelancer: Briefcase, agency: Building2, investor: LineChart };

/** "I'm a… Freelancer / Agency / Investor" segmented control. */
export function PersonaSwitcher({ className }: { className?: string }) {
  const { persona, setPersona } = usePersona();
  return (
    <div className={cn("flex flex-col items-center gap-2 lg:items-start", className)}>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">I&apos;m a…</p>
      <div role="radiogroup" aria-label="Show me the pitch for" className="inline-flex w-full max-w-sm rounded-full border bg-card/80 p-1 shadow-sm backdrop-blur sm:w-auto">
        {PERSONAS.map((p) => {
          const Icon = ICONS[p];
          const on = p === persona;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPersona(p)}
              data-cta={`persona-${p}`}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition sm:flex-none sm:px-4",
                on ? "bg-gradient-to-r from-primary to-purple-500 text-white shadow-md" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" /> {PERSONA_COPY[p].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
