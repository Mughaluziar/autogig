"use client";
import { FinancingView } from "@/components/banking/financing";

export default function FinancingPage() {
  return <FinancingView base="/dashboard/banking" accountsHref="/dashboard/orders" />;
}
