"use client";
import { InvestFlow } from "@/components/marketplace/invest-flow";

export default function InvestPage({ params }: { params: { id: string } }) {
  return <InvestFlow id={decodeURIComponent(params.id)} base="/dashboard/marketplace" canRaise={true} verifyHref="/dashboard/capital" />;
}
