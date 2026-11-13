"use client";
import { BankAccountsView } from "@/components/banking/accounts";

export default function BankAccountsPage() {
  return <BankAccountsView base="/dashboard/banking" full={true} />;
}
