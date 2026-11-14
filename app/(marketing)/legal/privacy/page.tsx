import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="November 14, 2026">
      <p>
        This Privacy Policy describes what Autopilot stores about you and what you can do with it. It is a draft
        that has not been reviewed by a lawyer; the descriptions below match how the product works today.
      </p>
      <h2>1. What we collect</h2>
      <p>
        Your account details (name, email, role, company, an optional profile), the work you create in the app
        (workspace, gigs, proposals, saved bids, settings, API key names), emails you forward to your Autopilot
        inbox address, the contracts, bids and recorded payouts you share with other users, and a record of the
        Terms and Privacy Policy versions you accepted and when. We set two cookies, a session cookie and a CSRF
        cookie, that are needed to keep you signed in. We do not install advertising or analytics trackers.
      </p>
      <h2>2. How we use it</h2>
      <p>
        To run your account, match and draft proposals, coordinate freelancers and agencies, and keep the service
        secure. Proposal drafts are produced by sending the job text and the profile details you saved to an AI
        provider with a prompt; nothing is sent to a marketplace for you. Every draft is reviewed and submitted by
        you.
      </p>
      <h2>3. Who else receives data</h2>
      <p>
        Service providers process data for us: the database host (MongoDB Atlas), the API and web hosts (Render,
        Vercel), the AI provider (Groq) for drafting, an email provider for account emails, and, only if the
        operator turns it on, Stripe for card payments, Sentry for error reports and an inbound email provider.
        Some of these are in other countries. Other users see only what the product shows them, for example a
        freelancer&apos;s name on a contract with an agency.
      </p>
      <h2>4. Security</h2>
      <p>
        Passwords are stored as one-way hashes. Provider tokens are encrypted with a key held outside the database.
        Sessions can be ended individually or all at once. No system is perfectly secure.
      </p>
      <h2>5. Your rights: download and delete</h2>
      <p>
        You can download your data and delete your account yourself on the{" "}
        <Link href="/dashboard/your-data">Your data</Link> page.
      </p>
      <ul>
        <li><strong>Download:</strong> a JSON file with your own records. It leaves out passwords, key hashes and other people&apos;s data.</li>
        <li>
          <strong>Delete:</strong> deletion is scheduled with a grace period (14 days by default) during which you can
          cancel by signing in. Afterwards your account, workspace, settings, notifications, activity, messages,
          leads, orders and API keys are deleted.
        </li>
        <li>
          <strong>Kept without your name:</strong> contracts, recorded payouts and similar records shared with another
          person or needed for financial records stay for a retention period (set by the operator and to be confirmed
          with a lawyer), with your name replaced by a placeholder, then they are removed. Proof that you accepted the
          Terms and a log that a request happened are kept without personal content.
        </li>
        <li>Deletion is refused while there are active contracts, team members or open simulated positions that others depend on.</li>
      </ul>
      <p>Backups made by our database host may keep deleted data for a short time until they expire.</p>
      <h2>6. Contact</h2>
      <p>Contact details for privacy requests will be added before launch.</p>
    </LegalPage>
  );
}
