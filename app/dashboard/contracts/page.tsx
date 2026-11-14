"use client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

/** Not built yet. Pool contracts and milestones live under Freelancer Pool. */
export default function ContractsPage() {
  return (
    <>
      <PageHeader title="Contracts" description="This area isn't available yet." />
      <EmptyState
        title="Coming soon"
        description="A dedicated contracts view hasn't been built. Contracts and milestones with freelancers are managed in Freelancer Pool."
      />
    </>
  );
}
