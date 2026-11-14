import { LegalPage } from "@/components/marketing/legal-page";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="November 14, 2026">
      <p>
        These Terms of Service govern your use of the Autopilot platform. By accessing or using the platform, you
        agree to be bound by these terms once they are finalised. When you create an account, or when these terms change, we record which version you accepted and when.
      </p>
      <h2>1. Use of Service</h2>
      <p>
        You agree to use the platform in compliance with all applicable laws and third-party platform terms of
        service. Automated interactions with external marketplaces must respect their respective policies.
      </p>
      <h2>2. Accounts</h2>
      <p>
        You are responsible for maintaining the confidentiality of your account credentials and for all activity
        under your account as an agency, freelancer or investor.
      </p>
      <h2>3. Payments</h2>
      <p>
        Invoice and milestone payments are processed by Stripe through Stripe Checkout, and only where the
        operator has switched online payment on; otherwise no payment is taken. Autopilot is not a bank, a trustee
        or an escrow agent and does not hold client funds on a client&apos;s behalf. Any marketplace, balance or
        settlement figures shown in the app that are labelled as simulated are illustrations only and do not
        represent real money. Fees, refunds and payment disputes are handled under the payment provider&apos;s
        rules and any agreement between you and the other party.
      </p>
      <h2>3A. Third-party marketplaces</h2>
      <p>
        Autopilot helps you find jobs and draft proposals. It does not log in to, or submit anything on, your
        Upwork, Fiverr or other marketplace accounts. You review, edit and submit every proposal yourself, and you
        remain responsible for following each marketplace&apos;s terms.
      </p>
      <h2>4. Freelancer Obligations</h2>
      <p>
        Freelancers agree to deliver the work they bid on, which the agency reviews and approves milestone by
        milestone, and to keep confidential what the agency asks them to keep confidential.
      </p>
      <h2>4A. Demonstration modules</h2>
      <p>
        Banking, Marketplace, Capital and the pool token are demonstrations. They record entries in Autopilot&apos;s
        own ledger, move no real money, and are not financial, investment or insurance services. They are available
        only to accounts the operator has invited.
      </p>
      <h2>5. Limitation of Liability</h2>
      <p>
        The platform is provided "as is" without warranties of any kind.
      </p>
    </LegalPage>
  );
}
