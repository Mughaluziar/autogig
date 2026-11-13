/** Shared types for Job Radar and Gigs (rows come from /api/radar/jobs). */

export type Kind = "job" | "gig";

export type Listing = {
  id: string;
  kind?: Kind;
  title: string;
  company: string;
  source: string;
  url: string;
  tags: string[];
  /** Salary/rate ceiling for jobs, project budget for gigs — in `currency`. */
  budget: number | null;
  currency?: string | null;
  description: string;
  postedAt: string;
  matchScore: number;
  /** List responses trim long descriptions; the detail endpoint has the full text. */
  truncated?: boolean;
  // Marketplace signals — present only when the source reports them.
  rateType?: "fixed" | "hourly" | null;
  budgetMin?: number | null;
  proposals?: number | null;
  clientVerified?: boolean | null;
  /** Upwork email-alert leads: the user must review and submit on the marketplace themselves. */
  manualSubmitOnly?: boolean;
  /** Id of the stored Upwork lead (email-alert source only). */
  leadId?: string;
};

export type SavedSearch = {
  id: string;
  name: string;
  query: string;
  alertEnabled?: boolean;
  newSinceLast?: number;
  lastScanAt?: string;
};

export type ProposalRecord = { id: string; jobId: string; jobTitle: string; body: string; status: string };

/** Automation-engine job record (mirrors /api/automation). */
export type ApplyJob = {
  id: string;
  status: string;
  engine?: string;
  steps: { step: string; status: string; detail?: string }[];
};

/** A tracked application row (lib/demo-engine.ts radarTrackJob). */
export type Application = {
  id: string;
  jobId: string;
  kind?: Kind;
  title: string;
  company: string;
  url: string;
  source: string;
  budget: number | null;
  currency?: string | null;
  tags?: string[];
  matchScore?: number | null;
  postedAt?: string;
  description?: string;
  stage: Stage;
  proposal: string;
  appliedAt: string;
  submittedAt?: string;
  stageChangedAt?: string;
  notes: string;
  // Gig bids
  bidAmount?: number;
  deliveryDays?: number;
  rateType?: "fixed" | "hourly";
  milestones?: { title: string; amount: number }[];
  // Job applications
  answers?: { q: string; a: string }[];
};

export const STAGES = ["Saved", "Drafted", "Applied", "Interview", "Won", "Lost", "Ghosted"] as const;
export type Stage = (typeof STAGES)[number];
