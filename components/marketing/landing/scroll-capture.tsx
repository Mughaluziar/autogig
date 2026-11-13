"use client";
import * as React from "react";
import { X } from "lucide-react";
import { PERSONA_COPY } from "@/lib/landing";
import { EmailCapture } from "./email-capture";
import { usePersona } from "./persona";

const SEEN_KEY = "autopilot-capture-seen";

/**
 * Desktop-only nudge: shown once per session, after the visitor has read
 * most of the page or moves to leave it. Never on phones (the sticky bar
 * covers that), never once they've reached the final call to action.
 */
export function ScrollCapture() {
  const { persona } = usePersona();
  const c = PERSONA_COPY[persona];
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!window.matchMedia?.("(min-width: 1024px)").matches) return;
    try { if (sessionStorage.getItem(SEEN_KEY)) return; } catch { /* storage blocked */ }
    let fired = false;
    const fire = () => {
      if (fired) return;
      const end = document.getElementById("final-cta");
      if (end && end.getBoundingClientRect().top < window.innerHeight) return;
      fired = true;
      setOpen(true);
      try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked */ }
      cleanup();
    };
    const onScroll = () => {
      const depth = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
      if (depth > 0.6) fire();
    };
    const onLeave = (e: MouseEvent) => { if (e.clientY <= 0 && window.scrollY > 600) fire(); };
    const cleanup = () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mouseout", onLeave);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("mouseout", onLeave);
    return cleanup;
  }, []);

  if (!open) return null;
  return (
    <div role="dialog" aria-labelledby="capture-title" className="fixed bottom-6 right-6 z-50 hidden w-[380px] animate-fade-in rounded-2xl border bg-card p-5 shadow-2xl lg:block">
      <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
        <X className="size-4" />
      </button>
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Before you go</p>
      <p id="capture-title" className="mt-1 pr-6 text-lg font-bold leading-snug">
        {persona === "investor" ? "Get first look at the marketplace." : "Your first matches are one scan away."}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {persona === "investor" ? "Create an investor account and complete verification in minutes." : "Free plan, no card. Connect a platform and see ranked jobs and gigs in two minutes."}
      </p>
      <EmailCapture id="capture-email" cta={persona === "investor" ? "Continue" : "Start free"} href={c.cta.href} className="mt-4 max-w-none sm:flex-col" />
    </div>
  );
}
