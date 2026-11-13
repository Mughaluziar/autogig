"use client";
import { PortfolioView } from "@/components/marketplace/portfolio";

export default function MarketplacePortfolioPage() {
  return <PortfolioView base="/investor/marketplace" canRaise={false} poolHref="/investor" />;
}
