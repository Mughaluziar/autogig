"use client";
import { MoneyProvider } from "@/components/money/money-provider";
import { MoneyHeader } from "@/components/money/money-nav";

export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  return (
    <MoneyProvider>
      <MoneyHeader />
      {children}
    </MoneyProvider>
  );
}
