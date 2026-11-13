/**
 * Sample listings for the frontend-only demo (no Autopilot server). Real
 * accounts never see these: with a server, Scout only uses Job Radar's live
 * results. Every row is labelled "Sample feed" so it can't pass for real.
 */
import type { Row } from "@/lib/demo-engine";

const SAMPLES: Omit<Row, "matchScore">[] = [
  { id: "sample-1", kind: "gig", title: "React dashboard for a logistics startup", company: "Sample client", tags: ["react", "typescript", "charts"], budget: 2400, description: "Build an analytics dashboard with role-based access and CSV export." },
  { id: "sample-2", kind: "gig", title: "Shopify theme tweaks and speed audit", company: "Sample client", tags: ["shopify", "liquid", "performance"], budget: 650, description: "Improve Core Web Vitals and fix a few theme sections." },
  { id: "sample-3", kind: "job", title: "Senior Next.js engineer (remote)", company: "Sample company", tags: ["next.js", "react", "node"], budget: null, description: "Full-time remote role building a B2B SaaS product." },
  { id: "sample-4", kind: "gig", title: "Python scraper to clean product data", company: "Sample client", tags: ["python", "pandas"], budget: 400, description: "Normalize a messy product CSV and dedupe entries." },
  { id: "sample-5", kind: "gig", title: "Figma to responsive landing page", company: "Sample client", tags: ["figma", "tailwind", "react"], budget: 900, description: "Pixel-accurate landing page from an existing Figma file." },
  { id: "sample-6", kind: "job", title: "Contract mobile developer (React Native)", company: "Sample company", tags: ["react native", "ios", "android"], budget: 6000, description: "Three-month contract to ship a booking app." },
  { id: "sample-7", kind: "gig", title: "WordPress plugin bug fix", company: "Sample client", tags: ["wordpress", "php"], budget: 150, description: "Fix a checkout conflict between two plugins." },
  { id: "sample-8", kind: "gig", title: "AI chatbot for a support inbox", company: "Sample client", tags: ["python", "llm", "api"], budget: 3200, description: "Answer support emails with a retrieval-based bot." },
];

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1);

/** Scores samples against the query the same way the server does (keyword overlap). */
export function sampleScan(query: string, kind: string): { jobs: Row[]; sources: string[] } {
  const skills = query.split(",").map((s) => s.trim()).filter(Boolean);
  const stamp = Date.now().toString(36);
  const jobs = SAMPLES.filter((j) => kind === "all" || j.kind === kind).map((j) => {
    const hay = new Set(tokens(`${j.title} ${j.description} ${(j.tags as string[]).join(" ")}`));
    const hits = skills.filter((sk) => tokens(sk).some((t) => hay.has(t))).length;
    const score = skills.length ? Math.max(35, Math.min(99, Math.round((hits * 100) / skills.length) || 40)) : 70;
    // A fresh id per scan so the demo keeps finding "new" listings.
    return { ...j, id: `${j.id}-${stamp}`, source: "Sample feed", url: "https://example.com/sample-listing", matchScore: score, postedAt: new Date().toISOString() };
  });
  return { jobs, sources: ["Sample feed"] };
}
