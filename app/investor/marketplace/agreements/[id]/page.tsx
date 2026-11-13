"use client";
import { AgreementDetail } from "@/components/marketplace/agreements";

export default function AgreementPage({ params }: { params: { id: string } }) {
  return <AgreementDetail id={decodeURIComponent(params.id)} base="/investor/marketplace" canRaise={false} />;
}
