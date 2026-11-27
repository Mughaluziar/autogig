"use client";
import { TransactionsView } from "@/components/banking/history";

export default function TransactionsPage() {
  return <TransactionsView base="/dashboard/banking" full={true} />;
}
