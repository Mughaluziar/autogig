import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";

export const metadata: Metadata = {
  title: "Checkout · Autopilot",
  description: "Start your free trial or top up credits. Payments are processed securely by Stripe.",
  robots: { index: false, follow: false },
};

export default function CheckoutPage({ searchParams }: { searchParams: { plan?: string; pack?: string; cancelled?: string } }) {
  return <CheckoutView plan={searchParams.plan} pack={searchParams.pack} cancelled={searchParams.cancelled === "1"} />;
}
