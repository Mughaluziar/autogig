"use client";
import { PageHeader } from "@/components/shared/page-header";
import { CreditAdmin } from "@/components/credit/admin";

export default function CreditAdminPage() {
  return (
    <>
      <PageHeader title="Credit treasury and review" description="Platform owners only: review applications, make simulated offers, watch the demo treasury and the audit history." />
      <CreditAdmin />
    </>
  );
}
