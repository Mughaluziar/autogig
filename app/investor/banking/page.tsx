"use client";
import { BankingOverviewView } from "@/components/banking/overview";

export default function BankingPage() {
  return <BankingOverviewView base="/investor/banking" marketBase="/investor/marketplace" full={false} />;
}
