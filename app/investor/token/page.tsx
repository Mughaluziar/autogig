"use client";
import { Coins } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { HoldingCard, SubscribeCard, SubscriptionList, TestnetBanner, WalletCard } from "@/components/token/investor-token";
import { API_URL } from "@/lib/api";
import { useTokenMe } from "@/lib/token";

export default function InvestorTokenPage() {
  const { data: me, loaded, refresh } = useTokenMe();
  return (
    <>
      <PageHeader
        title="Pool token"
        description="Hold your pool shares as a permissioned token in a wallet you control. Only verified investors' registered wallets can hold or receive it."
        actions={me?.enabled ? <Badge variant={me.chain.mainnet ? "default" : "warning"}>{me.chain.name}</Badge> : undefined}
      />
      {!API_URL ? (
        <EmptyState icon={<Coins className="size-6" />} title="Needs the backend"
          description="The token program reads the chain and the pool ledger on the server, so it isn't available in the frontend-only demo." />
      ) : !loaded ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !me || !me.enabled ? (
        <EmptyState icon={<Coins className="size-6" />} title="Not open yet"
          description="The pool token isn't available. It opens only after legal approval, an independent security audit and the platform owner's authorization. You can still invest in the pool from the Portfolio page." />
      ) : me.missingConfig.length > 0 ? (
        <EmptyState icon={<Coins className="size-6" />} title="Being set up"
          description="The token contracts aren't connected yet. Check back soon." />
      ) : (
        <>
          <TestnetBanner me={me} />
          <div className="grid gap-4 lg:grid-cols-2">
            <WalletCard me={me} onChanged={refresh} />
            <HoldingCard me={me} />
            <div className="lg:col-span-2"><SubscribeCard me={me} onChanged={refresh} /></div>
            <div className="lg:col-span-2"><SubscriptionList me={me} /></div>
          </div>
        </>
      )}
    </>
  );
}
