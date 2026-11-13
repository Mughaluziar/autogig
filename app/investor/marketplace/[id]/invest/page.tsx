"use client";
import { InvestFlow } from "@/components/marketplace/invest-flow";

export default function InvestPage({ params }: { params: { id: string } }) {
  return <InvestFlow id={decodeURIComponent(params.id)} base="/investor/marketplace" canRaise={false} verifyHref="/investor" />;
}
