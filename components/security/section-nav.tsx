"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SectionLink = { href: string; label: string; icon: LucideIcon };

/** Pill navigation between a section's pages (Overview · API keys · …).
 *  Scrolls sideways on narrow screens instead of wrapping. */
export function SectionNav({ links, className }: { links: SectionLink[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Section" className={cn("-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0", className)}>
      <div className="inline-flex min-w-max items-center gap-1 rounded-xl border bg-card/60 p-1">
        {links.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <l.icon className="size-4" />
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
