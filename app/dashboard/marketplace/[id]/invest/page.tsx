"use client";;
import { use } from "react";
import { InvestFlow } from "@/components/marketplace/invest-flow";

export default function InvestPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return <InvestFlow id={decodeURIComponent(params.id)} base="/dashboard/marketplace" canRaise={true} verifyHref="/dashboard/capital" />;
}
