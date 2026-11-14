import type { Metadata } from "next";
import { PayView } from "./pay-view";

// The URL carries the link token: keep it out of search engines and out of
// the Referer sent to other sites.
export const metadata: Metadata = {
  title: "Pay invoice · Autopilot",
  description: "Pay your invoice securely by debit card, credit card or crypto.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PayPage(
  props: { params: Promise<{ token: string }>; searchParams: Promise<{ status?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const status = searchParams.status === "success" || searchParams.status === "cancelled" ? searchParams.status : null;
  return <PayView token={params.token} returnStatus={status} />;
}
