"use client";;
import { use } from "react";
import { AgreementDetail } from "@/components/marketplace/agreements";

export default function AgreementPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return <AgreementDetail id={decodeURIComponent(params.id)} base="/dashboard/marketplace" canRaise={true} />;
}
