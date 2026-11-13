"use client";
import { BankingOverviewView } from "@/components/banking/overview";

export default function BankingPage() {
  return <BankingOverviewView base="/dashboard/banking" marketBase="/dashboard/marketplace" full={true} />;
}
