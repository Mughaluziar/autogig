import { Building2, Layers, LineChart, User } from "lucide-react";

/* Illustrative marketplace listings — the shape of the product, not real offerings. */
const LISTINGS = [
  { icon: Layers, name: "Platform Index", kind: "Index", terms: "Spread evenly across top-rated freelancers", raised: 72, tag: "Lower concentration risk", tone: "text-success" },
  { icon: Building2, name: "Northwind Studio", kind: "Agency", terms: "8% of eligible revenue · 24 months", raised: 58, tag: "Revenue share", tone: "text-primary" },
  { icon: User, name: "Mobile developer, 6 yrs", kind: "Freelancer", terms: "Project funding · $6,000 · equipment", raised: 35, tag: "Project funding", tone: "text-fuchsia-500" },
];

export function MarketplacePreview() {
  return (
    <div className="relative mx-auto w-full min-w-0 max-w-xl" aria-label="Illustrative preview of the investment marketplace">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/30 via-fuchsia-400/15 to-cyan-400/20 blur-2xl" />
      <div className="panel overflow-hidden text-left">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><LineChart className="size-4 text-primary" /> Marketplace</p>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Illustrative</span>
        </div>
        <ul className="divide-y">
          {LISTINGS.map((l) => (
            <li key={l.name} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-purple-500 text-white"><l.icon className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{l.name} <span className="font-normal text-muted-foreground">· {l.kind}</span></p>
                  <p className="truncate text-xs text-muted-foreground">{l.terms}</p>
                </div>
                <span className={`shrink-0 text-[11px] font-semibold ${l.tone}`}>{l.tag}</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-gradient-to-r from-primary via-fuchsia-400 to-cyan-400" style={{ width: `${l.raised}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-3 gap-2 border-t px-4 py-3 text-center">
          {[["Invest", "Directly or by index"], ["Track", "Performance & risk"], ["Receive", "Distributions"]].map(([a, b]) => (
            <div key={a}><p className="text-sm font-bold">{a}</p><p className="text-[10px] text-muted-foreground">{b}</p></div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-center text-[11px] text-muted-foreground">Illustrative listings. Accredited or professional investors only; capital at risk.</p>
    </div>
  );
}
