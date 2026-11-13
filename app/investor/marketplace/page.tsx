"use client";
import { MarketplaceBrowse } from "@/components/marketplace/browse";

export default function MarketplacePage() {
  return <MarketplaceBrowse base="/investor/marketplace" canRaise={false} verifyHref="/investor" poolHref="/investor" />;
}
