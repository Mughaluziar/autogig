/**
 * Landing-page settings the business owns: the card launch date, the perks
 * promised to waitlist members, the persona copy, and the rules that build
 * the personalized credit-card offer. Keep everything here truthful —
 * whatever this file says, the team has to honour at launch.
 */

/** Hands an email typed on the landing page to the signup form (sessionStorage). */
export const SIGNUP_EMAIL_KEY = "autopilot-signup-email";
/** The skill a visitor tried in the hero radar, for the signup flow to prefill (sessionStorage). */
export const SIGNUP_SKILL_KEY = "autopilot-signup-skill";

/**
 * When Autopilot Cards open: a fixed date, 90 days after the countdown went
 * live on 2026-11-12. It never resets per visit. Set NEXT_PUBLIC_CARD_LAUNCH_AT
 * (ISO 8601) to move it.
 */
export const CARD_LAUNCH_AT = process.env.NEXT_PUBLIC_CARD_LAUNCH_AT || "2027-02-10T14:00:00Z";
/** Length of the launch countdown, for the "day X of 90" progress bar. */
export const CARD_COUNTDOWN_DAYS = 90;

/** Perks every card-waitlist member gets. */
export const FOUNDING_PERKS = [
  "3 months of Autopilot Pro, free",
  "Priority access on launch day",
  "Founding-member card design",
];

/**
 * Reward targets shown in the credit-card offer preview, labelled "planned".
 * These are targets the team is negotiating, not card terms: the issuing bank
 * sets final rates at launch. Confirm them before launch (docs/landing-page.md).
 */
export const PLANNED_REWARDS = { boostedPct: 3, basePct: 1 };

/* ------------------------------------------------------------------ */
/* Product limits quoted on the page — mirror the backend policy.       */
/* ------------------------------------------------------------------ */

/** Order protection — mirrors backend/app/capital/policy.py. */
export const COVER = { maxPct: 0.8, premiumPct: 0.04, maxCover: 2000, windowHours: 24 };
/** Early payment — mirrors backend/app/capital/policy.py. */
export const EARLY_PAY = { advancePct: 0.7, feePct: 0.03, maxAdvance: 2500, termDays: 30 };
/** Funding headline limits (early access). */
export const FUNDING = { projectMax: 10_000, financingMax: 250_000 };

/* ------------------------------------------------------------------ */
/* Personas — the page rewrites its pitch for whoever is reading.       */
/* ------------------------------------------------------------------ */

export type Persona = "freelancer" | "agency" | "investor";
export const PERSONA_KEY = "autopilot-persona";
export const PERSONAS: Persona[] = ["freelancer", "agency", "investor"];

export type PersonaCopy = {
  label: string;
  eyebrow: string;
  headline: string;
  highlight: string;
  sub: (platforms: number) => string;
  bullets: string[];
  cta: { label: string; href: string };
  secondary: { label: string; href: string };
  final: { title: string; sub: string };
  sticky: string;
  note?: string;
};

export const PERSONA_COPY: Record<Persona, PersonaCopy> = {
  freelancer: {
    label: "Freelancer",
    eyebrow: "For freelancers",
    headline: "Stop hunting for work.",
    highlight: "Let the work find you.",
    sub: (n) =>
      `Autopilot scans Upwork, Fiverr, Freelancer.com and ${n - 3} more platforms around the clock, ranks every job and gig against your skills, and drafts the proposal. You review it and hit send.`,
    bullets: ["Jobs and gigs matched to you, in one feed", "AI proposals in your voice, in seconds", "New orders insured for up to 80%"],
    cta: { label: "Find my matches", href: "/signup" },
    secondary: { label: "Watch it scan", href: "#auto-find" },
    final: {
      title: "Your next client posted a job this morning. Autopilot already found it.",
      sub: "Join free in two minutes. Connect your platforms, see your matches and send your first proposal today.",
    },
    sticky: "Find my matches",
  },
  agency: {
    label: "Agency",
    eyebrow: "For agencies",
    headline: "Fill your agency's pipeline",
    highlight: "on autopilot.",
    sub: (n) =>
      `An agent fleet scouts ${n} platforms for projects that fit your team, drafts bids for your approval, tracks every order and invoice, and unlocks up to $10,000 in project funding when you need to hire.`,
    bullets: ["Agents that scout, write and follow up", "Project funding up to $10k, financing to $250k", "Milestone invoices paid by card or crypto"],
    cta: { label: "Start my agency free", href: "/signup" },
    secondary: { label: "See funding options", href: "#funding" },
    final: {
      title: "More projects in. Faster payments out. Capital when you're ready to grow.",
      sub: "Start free, put your agent fleet to work, and check your funding early access in the same afternoon.",
    },
    sticky: "Start free",
  },
  investor: {
    label: "Investor",
    eyebrow: "For investors",
    headline: "Invest in the people",
    highlight: "powering the freelance economy.",
    sub: () =>
      "Back verified freelancers and agencies directly, or spread your capital across the Platform Index of high-rated talent. Track performance, distributions and risk in one portfolio.",
    bullets: ["Pick names or buy the diversified index", "Revenue-sharing agreements with defined terms", "One view of performance, distributions and risk"],
    cta: { label: "Create investor account", href: "/signup/investor" },
    secondary: { label: "How investing works", href: "#invest" },
    final: {
      title: "Fund the businesses building the freelance economy, and watch every dollar work.",
      sub: "Create an investor account, complete verification, and explore the marketplace while settlement runs in beta.",
    },
    sticky: "Get started",
    note: "Accredited or professional investors only. Capital at risk. Settlement is simulated during beta.",
  },
};

/* ------------------------------------------------------------------ */
/* Pricing — paid plans start a free trial at checkout.                 */
/* ------------------------------------------------------------------ */

export type LandingPlan = { id: string; name: string; price: number; who: string; href: string; cta: string; features: string[]; hot?: boolean };

export const LANDING_PLANS: LandingPlan[] = [
  { id: "free", name: "Basic", price: 0, who: "Try the platform", href: "/signup", cta: "Start free",
    features: ["10 job bids included", "2 platform profile slots", "Job Radar and Gigs scans", "Invoices with card and crypto pay links"] },
  { id: "plus", name: "Plus", price: 9, who: "Freelancers getting started", href: "/checkout?plan=plus", cta: "Start free trial",
    features: ["50 job bids a month", "5 platform profiles", "AI Gig Builder and proposals", "Outreach tools"] },
  { id: "pro", name: "Pro", price: 19, who: "Serious freelancers and agencies", href: "/checkout?plan=pro", cta: "Start free trial", hot: true,
    features: ["Unlimited bids and profiles", "Full agent fleet and priority matching", "Campaign suite and invoice chasing", "Priority support"] },
];

/* ------------------------------------------------------------------ */
/* Personalized credit-card offer                                       */
/* ------------------------------------------------------------------ */

export type QuizAnswers = {
  role: string;
  revenue: string;
  spend: string[];
  rewards: string;
};

export const QUIZ = {
  role: [
    { id: "solo", label: "Solo freelancer", hint: "Just me, on one or more platforms" },
    { id: "small-agency", label: "Small agency", hint: "2–10 people" },
    { id: "agency", label: "Growing agency", hint: "11+ people" },
  ],
  revenue: [
    { id: "under-2k", label: "Under $2k / month" },
    { id: "2k-10k", label: "$2k – $10k / month" },
    { id: "10k-50k", label: "$10k – $50k / month" },
    { id: "50k-plus", label: "$50k+ / month" },
  ],
  spend: [
    { id: "software", label: "Software & AI tools" },
    { id: "ads", label: "Advertising" },
    { id: "equipment", label: "Equipment" },
    { id: "contractors", label: "Contractors" },
    { id: "travel", label: "Travel" },
    { id: "fees", label: "Platform fees" },
  ],
  rewards: [
    { id: "cash", label: "Cash back", hint: "Straight to your balance" },
    { id: "usdc", label: "Crypto (USDC)", hint: "Paid in a dollar stablecoin" },
    { id: "pro", label: "Autopilot credits", hint: "Bids, profiles and Pro time" },
  ],
};

const label = (list: { id: string; label: string }[], id: string) => list.find((o) => o.id === id)?.label ?? id;

export type Offer = {
  id: string;
  card: string;
  tagline: string;
  /** Planned reward targets for the visitor's top spend categories. */
  rewards: { category: string; pct: number }[];
  highlights: string[];
};

/**
 * The personalized offer shown at the end of the credit-card quiz. Perks,
 * priority and early access are things the team controls; reward rates are
 * planned targets (PLANNED_REWARDS), and limits are set with the bank at launch.
 */
export function buildOffer(a: QuizAnswers): Offer {
  const agency = a.role !== "solo";
  const big = a.revenue === "10k-50k" || a.revenue === "50k-plus";
  const tier = agency || big ? "business" : "starter";
  const card = tier === "business" ? "Autopilot Credit · Business" : "Autopilot Credit · Starter";
  const tagline =
    tier === "business"
      ? "Higher limits and team cards, sized to your agency's platform earnings."
      : "A first business card that grows with your freelance income.";

  const rewards = a.spend.slice(0, 2).map((s) => ({ category: label(QUIZ.spend, s), pct: PLANNED_REWARDS.boostedPct }));
  rewards.push({ category: "Everything else", pct: PLANNED_REWARDS.basePct });

  const highlights: string[] = [];
  highlights.push(`Rewards paid as ${label(QUIZ.rewards, a.rewards || "cash").toLowerCase()}`);
  highlights.push("Limits informed by your platform earnings, not just a credit score");
  if (agency) highlights.push("Team cards with per-person spending limits");
  if (agency) highlights.push(`Early access to project funding up to $${FUNDING.projectMax.toLocaleString("en-US")}`);
  if (a.revenue === "50k-plus" || (agency && big)) highlights.push(`Early access to business financing up to $${FUNDING.financingMax.toLocaleString("en-US")}`);
  highlights.push(...FOUNDING_PERKS);

  return { id: `${tier}-${a.rewards || "cash"}`, card, tagline, rewards, highlights };
}
