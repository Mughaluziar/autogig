"use client";
import { MarketplaceBrowse } from "@/components/marketplace/browse";

export default function MarketplacePage() {
  return <MarketplaceBrowse base="/dashboard/marketplace" canRaise={true} verifyHref="/dashboard/capital" poolHref="/dashboard/capital?tab=invest" />;
}
