"use client";
import { StatementsView } from "@/components/banking/statements";

export default function StatementsPage() {
  return <StatementsView base="/dashboard/banking" full={true} />;
}
