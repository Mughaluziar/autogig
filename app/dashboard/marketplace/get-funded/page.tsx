"use client";
import { Frame, marketLinks } from "@/components/marketplace/common";
import { GetMoneyHub } from "@/components/marketplace/get-funded";

export default function GetFundedPage() {
  return (
    <Frame kind="market" links={marketLinks("/dashboard/marketplace", { raise: true })} title="Get money"
      description="Every way to get cash on Autopilot, side by side: credit from your projects, upfront USDC, marketplace funding and business financing.">
      <GetMoneyHub capitalHref="/dashboard/capital" marketBase="/dashboard/marketplace" bankingBase="/dashboard/banking" />
    </Frame>
  );
}
