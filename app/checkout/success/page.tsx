import type { Metadata } from "next";
import { CheckoutSuccess } from "@/components/checkout/checkout-success";

export const metadata: Metadata = {
  title: "You're all set · Autopilot",
  robots: { index: false, follow: false },
};

export default async function CheckoutSuccessPage(props: { searchParams: Promise<{ plan?: string; pack?: string }> }) {
  const searchParams = await props.searchParams;
  return <CheckoutSuccess plan={searchParams.plan} pack={searchParams.pack} />;
}
