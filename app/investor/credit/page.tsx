"use client";
import { PageHeader } from "@/components/shared/page-header";
import { CreditInvestor } from "@/components/credit/investor";

export default function InvestorCreditPage() {
  return (
    <>
      <PageHeader title="AutoGig funding pool" description="A simulated funding pool for project credit. Add demo contributions, see where they are allocated and read a simulated statement." />
      <CreditInvestor />
    </>
  );
}
