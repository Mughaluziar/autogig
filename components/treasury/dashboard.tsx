"use client";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PeriodReport } from "@/components/treasury/period-report";
import { BalanceGroups, IntegrityChecks, KeyFigures, TreasuryGate, TreasuryNotice } from "@/components/treasury/sections";
import { useTreasuryOverview } from "@/lib/treasury";

/** Owner treasury: integrity first (a failing check means no figure below should be trusted), then figures and reports. */
export function TreasuryDashboard() {
  const { data, loaded, denied, failed, refresh } = useTreasuryOverview();
  return (
    <TreasuryGate loaded={loaded} denied={denied} failed={failed} retry={refresh}>
      {data && (
        <div className="space-y-6">
          <TreasuryNotice />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>As of {new Date(data.asOf).toLocaleString()} · journal entry #{data.seq.toLocaleString("en-US")}</span>
            <Button variant="outline" size="sm" onClick={refresh}><RefreshCw /> Refresh</Button>
          </div>
          <IntegrityChecks checks={data.checks} ok={data.ok} />
          <KeyFigures kpis={data.kpis} />
          <BalanceGroups groups={data.groups} />
          <PeriodReport />
        </div>
      )}
    </TreasuryGate>
  );
}
