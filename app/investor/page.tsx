"use client";
import Link from "next/link";
import { ArrowRight, Landmark, Layers, Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { InvestPanel } from "@/components/capital/invest-panel";
import { SimulatedBanner, VerificationCard } from "@/components/capital/verification-card";
import { API_URL } from "@/lib/api";
import { useCapitalData } from "@/lib/capital";

const NEXT = [
  { href: "/investor/marketplace", icon: Layers, title: "Marketplace", desc: "Back verified freelancers and agencies, or the whole platform through the Index." },
  { href: "/investor/marketplace/portfolio", icon: Landmark, title: "Investment portfolio", desc: "Positions, distributions received and where your risk sits." },
  { href: "/investor/banking", icon: Wallet, title: "Banking", desc: "Link a bank, add money to invest and withdraw distributions." },
];

export default function InvestorHome() {
  const data = useCapitalData({ investor: true });
  const profile = data.overview?.profile;
  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Fund early payments for freelancers whose orders are verified by the marketplace's own API, or invest in individual raises on the marketplace."
        actions={<Badge variant="warning">Simulated settlement</Badge>}
      />
      <SimulatedBanner />
      {!API_URL ? (
        <EmptyState icon={<Landmark className="size-6" />} title="Needs the backend"
          description="The investor pool keeps a server-side ledger, so it isn't available in the frontend-only demo." />
      ) : !data.loaded || !data.overview || !profile ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <VerificationCard profile={profile} defaultRoles={["investor"]} onSaved={data.refresh} />
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {NEXT.map(({ href, icon: Icon, title, desc }) => (
              <Link key={href} href={href} className="panel group flex flex-col p-4 transition-colors hover:border-primary/50">
                <Icon className="size-5 text-primary" />
                <p className="mt-2 flex items-center gap-1 font-semibold">{title} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></p>
                <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
              </Link>
            ))}
          </div>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Early-payment pool</h2>
          <InvestPanel pool={data.overview.pool} position={data.position} onChanged={data.refresh} />
        </>
      )}
    </>
  );
}
