"use client";
import { PortfolioView } from "@/components/marketplace/portfolio";

export default function MarketplacePortfolioPage() {
  return <PortfolioView base="/dashboard/marketplace" canRaise={true} poolHref="/dashboard/capital?tab=invest" />;
}
