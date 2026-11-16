"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { CreditBorrower } from "@/components/credit/borrower";

export default function CreditPage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Project credit" description="Ask for funds before a project starts. Simulated: the platform reviews your application and may make an example offer."
        actions={user?.owner ? <Button asChild variant="outline" size="sm"><Link href="/dashboard/credit/admin">Treasury and review</Link></Button> : undefined} />
      <CreditBorrower verifyHref="/dashboard/capital" />
    </>
  );
}
