import type { Metadata } from "next";
import { CheckoutSuccess } from "@/components/checkout/checkout-success";

export const metadata: Metadata = {
  title: "You're all set · Autopilot",
  robots: { index: false, follow: false },
};

export default function CheckoutSuccessPage({ searchParams }: { searchParams: { plan?: string; pack?: string } }) {
  return <CheckoutSuccess plan={searchParams.plan} pack={searchParams.pack} />;
}
