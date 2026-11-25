"use client";
import Link from "next/link";
import {
  Bitcoin, Bot, Briefcase, CreditCard, Landmark, LineChart, PenLine, PieChart, Radar, Receipt, Rocket, ShieldCheck, Sparkles, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type Persona } from "@/lib/landing";
import { usePersona } from "./persona";

type Tile = { icon: React.ElementType; title: string; desc: string; href: string; status: string; for: Persona[] };

const TILES: Tile[] = [
  { icon: Radar, title: "Auto job finding", desc: "Roles from job boards and talent networks, ranked by fit", href: "#auto-find", status: "Live", for: ["freelancer", "agency"] },
  { icon: Briefcase, title: "Auto gig finding", desc: "Projects and buyer requests on Upwork, Fiverr and more", href: "#auto-find", status: "Live", for: ["freelancer", "agency"] },
  { icon: PenLine, title: "AI proposals & gigs", desc: "Tailored bids and full gig listings, ready to review", href: "#auto-find", status: "Live", for: ["freelancer", "agency"] },
  { icon: Bot, title: "Agent fleet", desc: "Agents that scout, write and follow up inside your rules", href: "/signup", status: "Live", for: ["agency"] },
  { icon: ShieldCheck, title: "Freelancer protection", desc: "Up to 80% of a new order covered if it's cancelled", href: "#insurance", status: "Simulated demo", for: ["freelancer", "agency"] },
  { icon: Receipt, title: "Invoices & milestones", desc: "Paid in-app by debit card, credit card or crypto", href: "#get-paid", status: "Live", for: ["freelancer", "agency"] },
  { icon: Zap, title: "Early pay", desc: "Up to 70% of a verified order today, flat 3% fee", href: "#get-paid", status: "Simulated demo", for: ["freelancer"] },
  { icon: CreditCard, title: "Debit & credit cards", desc: "Spend earnings instantly, credit built for gig income", href: "#cards", status: "Coming soon", for: ["freelancer", "agency"] },
  { icon: Landmark, title: "Business financing", desc: "Up to $250,000, based on business performance", href: "#funding", status: "Simulated demo", for: ["agency", "freelancer"] },
  { icon: Rocket, title: "Project funding", desc: "Agencies borrow up to $10,000 to hire or expand", href: "#funding", status: "Simulated demo", for: ["agency"] },
  { icon: Bitcoin, title: "Investment marketplace", desc: "Back freelancers, agencies or the Platform Index", href: "#invest", status: "Simulated demo", for: ["investor"] },
  { icon: PieChart, title: "Investment portfolios", desc: "Performance, distributions and risk in one view", href: "#invest", status: "Simulated demo", for: ["investor"] },
  { icon: LineChart, title: "Revenue sharing", desc: "A defined share of eligible revenue, for a defined period", href: "#invest", status: "Simulated demo", for: ["investor", "agency"] },
];

const STATUS_TONE: Record<string, string> = {
  Live: "bg-success/15 text-success",
  Beta: "bg-primary/15 text-primary",
  "Early access": "bg-fuchsia-500/15 text-fuchsia-500",
  "Simulated demo": "bg-warning/15 text-warning",
  "Coming soon": "bg-warning/15 text-warning",
};

/** Everything Autopilot offers, with the tiles that matter to this visitor first. */
export function OfferGrid() {
  const { persona } = usePersona();
  const tiles = [...TILES].sort((a, b) => Number(b.for.includes(persona)) - Number(a.for.includes(persona)));
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {tiles.map((t) => {
        const mine = t.for.includes(persona);
        return (
          <Link key={t.title} href={t.href} data-cta={`offer-${t.title.toLowerCase().replace(/\W+/g, "-")}`}
            className={cn("group relative flex min-w-0 flex-col rounded-2xl border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg",
              mine && "border-primary/40 ring-1 ring-primary/20")}>
            <div className="flex items-start justify-between gap-2">
              <span className={cn("flex size-10 items-center justify-center rounded-xl text-white", mine ? "bg-gradient-to-br from-primary to-fuchsia-500" : "bg-gradient-to-br from-zinc-500 to-zinc-700")}>
                <t.icon className="size-5" />
              </span>
              {mine && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"><Sparkles className="size-3" />For you</span>}
            </div>
            <p className="mt-3 text-sm font-bold leading-snug sm:text-base">{t.title}</p>
            <p className="mt-1 flex-1 text-xs text-muted-foreground sm:text-sm">{t.desc}</p>
            <span className={cn("mt-3 w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_TONE[t.status])}>{t.status}</span>
          </Link>
        );
      })}
    </div>
  );
}
