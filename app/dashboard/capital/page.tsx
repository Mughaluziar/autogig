"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Landmark } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EarlyPayPanel } from "@/components/capital/early-pay-panel";
import { InvestPanel } from "@/components/capital/invest-panel";
import { OperatorPanel } from "@/components/capital/operator-panel";
import { ProtectionPanel } from "@/components/capital/protection-panel";
import { SimulatedBanner, VerificationCard } from "@/components/capital/verification-card";
import { GetMoneyHub } from "@/components/marketplace/get-funded";
import { TokenAdminPanel } from "@/components/token/token-admin-panel";
import { API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCapitalData } from "@/lib/capital";

const TABS = ["early", "protection", "invest", "operator", "token"];

export default function CapitalPage() {
  const { user } = useAuth();
  const data = useCapitalData({ freelancer: true, investor: true });
  const profile = data.overview?.profile;
  const verified = profile?.kyc.status === "verified";
  const [tab, setTab] = React.useState("early");
  // ?tab=early|protection|invest opens a tab directly (links from Get money and the Marketplace).
  React.useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.includes(t)) {
      setTab(t);
      requestAnimationFrame(() => document.getElementById("capital-tools")?.scrollIntoView({ block: "start" }));
    }
  }, []);

  return (
    <>
      <PageHeader
        title="Capital"
        description="Get money when you need it: credit from your verified projects, upfront USDC, marketplace funding or business financing. Then cash out to your bank."
        actions={
          <>
            <Badge variant="warning">Simulated settlement</Badge>
            <Button size="sm" variant="outline" asChild><Link href="/dashboard/marketplace">Marketplace <ArrowRight /></Link></Button>
          </>
        }
      />
      <SimulatedBanner />
      {!API_URL ? (
        <EmptyState icon={<Landmark className="size-6" />} title="Needs the backend"
          description="The capital program keeps a server-side ledger, so it isn't available in the frontend-only demo." />
      ) : !data.loaded || !data.overview || !profile ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">Get money</h2>
            <GetMoneyHub capitalHref="/dashboard/capital" earlyPayHref="#capital-tools" marketBase="/dashboard/marketplace" bankingBase="/dashboard/banking" />
          </section>
          <section id="capital-tools" className="scroll-mt-20">
            <VerificationCard profile={profile} defaultRoles={["freelancer"]} onSaved={data.refresh} />
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="early">Early payment</TabsTrigger>
                <TabsTrigger value="protection">Insurance</TabsTrigger>
                <TabsTrigger value="invest">Invest</TabsTrigger>
                {user?.owner && <TabsTrigger value="operator">Operator</TabsTrigger>}
                {user?.owner && <TabsTrigger value="token">Token</TabsTrigger>}
              </TabsList>
              <TabsContent value="early">
                <EarlyPayPanel orders={data.orders} advances={data.advances} verified={verified} onChanged={data.refresh} />
              </TabsContent>
              <TabsContent value="protection">
                <ProtectionPanel orders={data.orders} coverages={data.coverages} claims={data.claims} verified={verified}
                  policy={data.overview.pool.policy} onChanged={data.refresh} />
              </TabsContent>
              <TabsContent value="invest">
                <InvestPanel pool={data.overview.pool} position={data.position} onChanged={data.refresh} />
              </TabsContent>
              {user?.owner && (
                <TabsContent value="operator"><OperatorPanel onChanged={data.refresh} /></TabsContent>
              )}
              {user?.owner && (
                <TabsContent value="token"><TokenAdminPanel /></TabsContent>
              )}
            </Tabs>
          </section>
        </div>
      )}
    </>
  );
}
