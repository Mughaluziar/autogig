"use client";
import { TransfersView } from "@/components/banking/transfers";

export default function TransfersPage() {
  return <TransfersView base="/dashboard/banking" full={true} />;
}
