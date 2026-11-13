"use client";
import { AgreementsList } from "@/components/marketplace/agreements";

export default function AgreementsPage() {
  return <AgreementsList base="/investor/marketplace" canRaise={false} />;
}
