"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/#auto-find", label: "Find work" },
  { href: "/#insurance", label: "Protection" },
  { href: "/#cards", label: "Cards", badge: "Soon" },
  { href: "/#funding", label: "Funding" },
  { href: "/#invest", label: "Invest" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-purple-500 text-white">
            <Bot className="size-5" />
          </span>
          <span className="text-lg">Autopilot</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {navLinks.map((l: any) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-primary",
                pathname === l.href ? "text-primary" : "text-muted-foreground"
              )}
            >
              {l.label}
              {l.badge && <span className="ml-1.5 rounded-full bg-fuchsia-500/15 px-1.5 py-px text-[10px] font-semibold text-fuchsia-500">{l.badge}</span>}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle />
          <Button variant="ghost" asChild>
            <Link href="/login">Login</Link>
          </Button>
          <Button variant="gradient" asChild>
            <Link href="/signup" data-cta="header-start">Start free</Link>
          </Button>
        </div>

        <button className="lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>

      {open && (
        <div className="border-t lg:hidden">
          <nav className="container flex flex-col py-3">
            {navLinks.map((l: any) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 flex gap-2 px-3">
              <Button variant="outline" className="flex-1" asChild>
                <Link href="/login">Login</Link>
              </Button>
              <Button variant="gradient" className="flex-1" asChild>
                <Link href="/signup">Start free</Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
