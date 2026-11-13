"use client";
import { StatementsView } from "@/components/banking/statements";

export default function StatementsPage() {
  return <StatementsView base="/investor/banking" full={false} />;
}
