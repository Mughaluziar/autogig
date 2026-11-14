import { LegalPage } from "@/components/marketing/legal-page";

export default function AiDisclosurePage() {
  return (
    <LegalPage title="AI Disclosure" updated="September 16, 2026">
      <p>
        Autopilot uses artificial intelligence throughout its workflows. In <strong>Compliance mode</strong>, we
        proactively disclose the use of AI in client communications. This page documents how AI is used across the
        platform.
      </p>
      <h2>Where AI is used</h2>
      <p>
        AI agents assist with lead discovery, proposal drafting, client communication, freelancer coordination,
        quality assurance, and delivery. A human-in-the-loop reviews escalations and approves payouts.
      </p>
      <h2>No concealment of AI</h2>
      <p>
        The platform has no mode or setting that hides AI assistance or impersonates a human. Drafts are always
        reviewed and sent by the user, and users are responsible for disclosing AI assistance where the law or
        a marketplace's rules require it.
      </p>
      <h2>Anti-hallucination safeguards</h2>
      <p>
        Retrieval-augmented generation is strictly bounded to verified context. Agents may only reference projects
        that exist in the provided portfolio and never promise delivery timelines without engineering review.
      </p>
      <h2>Human oversight</h2>
      <p>
        Sentiment monitoring automatically escalates frustrated conversations to a human administrator, and all
        capital movements require explicit human approval.
      </p>
    </LegalPage>
  );
}
