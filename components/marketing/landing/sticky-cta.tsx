"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PERSONA_COPY } from "@/lib/landing";
import { usePersona } from "./persona";

/** Mobile-only bar that appears once the hero is out of view, and hides at the final call to action. */
export function StickyCta() {
  const { persona } = usePersona();
  const c = PERSONA_COPY[persona];
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const hero = document.getElementById("hero");
    const end = document.getElementById("final-cta");
    if (!hero || typeof IntersectionObserver === "undefined") return;
    let heroOut = false, endIn = false;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === hero) heroOut = !e.isIntersecting;
        if (e.target === end) endIn = e.isIntersecting;
      }
      setShow(heroOut && !endIn);
    });
    io.observe(hero);
    if (end) io.observe(end);
    return () => io.disconnect();
  }, []);
  return (
    <div className={cn("fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md transition-transform duration-300 md:hidden", show ? "translate-y-0" : "translate-y-full")}
      aria-hidden={!show}>
      <div className="flex gap-2">
        {persona === "investor" ? (
          <Button variant="outline" className="flex-1" asChild tabIndex={show ? 0 : -1}><Link href="#invest">How it works</Link></Button>
        ) : (
          <Button variant="outline" className="flex-1" asChild tabIndex={show ? 0 : -1}><Link href="#cards" data-cta="sticky-cards">Reserve a card</Link></Button>
        )}
        <Button variant="gradient" className="flex-[1.4]" asChild tabIndex={show ? 0 : -1}>
          <Link href={c.cta.href} data-cta="sticky-start">{c.sticky} <ArrowRight className="size-4" /></Link>
        </Button>
      </div>
    </div>
  );
}
