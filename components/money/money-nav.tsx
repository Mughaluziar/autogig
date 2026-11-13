"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { DEMO_MODE } from "@/lib/auth";
import { useMoney } from "./money-provider";

const TABS = [
  { href: "/dashboard/money", label: "Overview" },
  { href: "/dashboard/money/invoices", label: "Invoices" },
  { href: "/dashboard/money/transactions", label: "Transactions" },
  { href: "/dashboard/money/payments", label: "Payments" },
  { href: "/dashboard/money/plan", label: "Plan & credits" },
];

export function MoneyHeader() {
  const pathname = usePathname();
  const { L, openTxn } = useMoney();
  // The builder is a focused, full-page flow: no tabs above it.
  const focused = pathname.startsWith("/dashboard/money/invoices/new");
  const active = (href: string) => (href === "/dashboard/money" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const count = (href: string) => (href.endsWith("/invoices") ? L.invoices.length : href.endsWith("/transactions") ? L.txns.length : 0);

  if (focused) return null;
  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1.5 h-1 w-10 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" />
          <h1 className="text-3xl font-bold tracking-tight">Money</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            Invoice clients, get paid by card or crypto through your own pay link, and see exactly what you earn. {DEMO_MODE ? "Saved in this browser." : "Saved to your account."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dropdown
            align="right"
            trigger={<Button variant="outline" className="gap-1.5">Record <ChevronDown className="size-4" /></Button>}
          >
            <DropdownItem onClick={() => openTxn("income")}><ArrowDownLeft className="size-4 text-success" /> Income received</DropdownItem>
            <DropdownItem onClick={() => openTxn("expense")}><ArrowUpRight className="size-4 text-muted-foreground" /> Expense</DropdownItem>
          </Dropdown>
          <Button variant="gradient" asChild className="flex-1 sm:flex-none">
            <Link href="/dashboard/money/invoices/new"><Plus className="size-4" /> New invoice</Link>
          </Button>
        </div>
      </div>

      <nav aria-label="Money sections" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex min-w-max items-center gap-1 rounded-xl bg-muted/70 p-1">
          {TABS.map((t) => {
            const on = active(t.href);
            const n = count(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
                  on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
                {n > 0 && <span className={cn("rounded-full px-1.5 text-[10px] font-semibold", on ? "bg-primary/15 text-primary" : "bg-background/60")}>{n}</span>}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
