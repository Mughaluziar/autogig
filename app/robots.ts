import type { MetadataRoute } from "next";
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autopilotv2.vercel.app";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/freelancer", "/investor", "/welcome", "/microsite", "/pay", "/verify-email", "/auth"] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
