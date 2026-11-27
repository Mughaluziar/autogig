"use client";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { TreasuryDashboard } from "@/components/treasury/dashboard";

export default function TreasuryPage() {
  return (
    <>
      <PageHeader title="Treasury and reporting"
        description="Platform owners only: balances across every simulated program, integrity checks on the ledger, period reports and the journal export."
        actions={<Badge variant="warning">Simulated</Badge>} />
      <TreasuryDashboard />
    </>
  );
}
