import { LegalPage } from "@/components/marketing/legal-page";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="September 16, 2026">
      <p>
        These Terms of Service govern your use of the Autopilot platform. By accessing or using the platform, you
        agree to be bound by these terms once they are finalised.
      </p>
      <h2>1. Use of Service</h2>
      <p>
        You agree to use the platform in compliance with all applicable laws and third-party platform terms of
        service. Automated interactions with external marketplaces must respect their respective policies.
      </p>
      <h2>2. Accounts</h2>
      <p>
        You are responsible for maintaining the confidentiality of your account credentials and for all activity
        under your account across Admin, Freelancer, and Client roles.
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
        Freelancers agree to deliver work that passes automated quality gates and to comply with confidentiality
        and NDA-shielding requirements.
      </p>
      <h2>5. Limitation of Liability</h2>
      <p>
        The platform is provided "as is" without warranties of any kind.
      </p>
    </LegalPage>
  );
}
