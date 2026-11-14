import type { SessionUser } from "@/lib/auth";

/**
 * Which areas of the app each account type may open by URL. This only decides what the browser
 * renders (so the wrong role sees an access-denied page instead of an empty, error-filled shell):
 * the API enforces the same rules on every request and remains the authority.
 *
 *  - Agency-only: pages built on the admin-only API routers (pool admin, automation, outreach, gig
 *    studio, bid rules) and the agency-only views. Everything else under /dashboard (Gigs, Job Radar,
 *    Orders, Money, Banking, Marketplace, Capital, Settings, Profile, ...) is shared by every role,
 *    exactly as the API allows.
 *  - /freelancer/*: freelancer accounts only.
 *  - /investor/*: open to every signed-in role (the capital/marketplace API is).
 *  - The platform owner (OWNER_EMAILS) may open everything, as on the API.
 */
export const AGENCY_ONLY_PREFIXES = [
  "/dashboard/command", "/dashboard/pool", "/dashboard/automation", "/dashboard/growth",
  "/dashboard/accounts", "/dashboard/integrations", "/dashboard/bidding", "/dashboard/onboarding",
  "/dashboard/agents", "/dashboard/calendar",
  "/dashboard/clients", "/dashboard/contracts", "/dashboard/milestones", "/dashboard/freelancers",
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Simulated money modules (Banking, Marketplace, Capital, Token): the server may restrict them to invited accounts. */
export const SIMULATED_PREFIXES = [
  "/dashboard/banking", "/dashboard/marketplace", "/dashboard/capital",
  "/investor",
];
export const isSimulatedPath = (pathname: string) => !under(pathname, "/investor/your-data") && SIMULATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));


export type Area = "agency" | "freelancer" | null;

/** The account type a path is reserved for, or null when any signed-in role may open it. */
export function areaFor(pathname: string): Area {
  if (under(pathname, "/freelancer")) return "freelancer";
  if (pathname === "/dashboard" || AGENCY_ONLY_PREFIXES.some((p) => under(pathname, p))) return "agency";
  return null;
}

export function canAccess(user: Pick<SessionUser, "role" | "owner">, pathname: string): boolean {
  if (user.owner) return true;
  const area = areaFor(pathname);
  if (area === "freelancer") return user.role === "freelancer";
  if (area === "agency") return user.role === "admin";
  return true;
}
