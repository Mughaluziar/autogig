"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Inbox } from "@/components/messages/inbox";
import { API_URL } from "@/lib/api";

export default function FreelancerMessagesPage() {
  return (
    <>
      <PageHeader title="Messages" description="Talk to the agencies behind the specs you're bidding on and the contracts you hold." />
      {API_URL ? (
        <React.Suspense fallback={<div className="h-[480px] animate-pulse rounded-xl border bg-card" aria-busy="true" />}>
          <FreelancerInbox />
        </React.Suspense>
      ) : (
        <EmptyState title="Messages need the backend" description="This demo build has no account data, so there is nobody to message." />
      )}
    </>
  );
}

function FreelancerInbox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("thread");
  const select = (id: string | null) => router.replace(id ? `${pathname}?thread=${encodeURIComponent(id)}` : pathname, { scroll: false });
  return <Inbox side="freelancer" selectedId={selected} onSelect={select} />;
}
