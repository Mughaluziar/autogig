"use client";
import { PageHeader } from "@/components/shared/page-header";
import { CreditBorrower } from "@/components/credit/borrower";

export default function FreelancerCreditPage() {
  return (
    <>
      <PageHeader title="Project credit" description="Ask for funds before a project starts. Simulated: the platform reviews your application and may make an example offer." />
      <CreditBorrower verifyHref="/dashboard/capital" />
    </>
  );
}
