// Security headers, applied to every route. The CSP keeps 'unsafe-inline' for
// scripts and styles because Next.js emits inline bootstrap scripts and
// Tailwind/Radix set inline styles; everything else is locked to this origin,
// the configured API, Sentry and Nango's connect UI. Dev needs 'unsafe-eval'
// for React Refresh.
const isDev = process.env.NODE_ENV !== "production";
const apiOrigin = (() => {
  try { return process.env.NEXT_PUBLIC_API_URL ? new URL(process.env.NEXT_PUBLIC_API_URL).origin : ""; } catch { return ""; }
})();
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://images.unsplash.com https://avatars.githubusercontent.com https://api.dicebear.com",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} https://*.ingest.sentry.io https://*.sentry.io https://api.nango.dev${isDev ? " ws: http://localhost:*" : ""}`.replace(/\s+/g, " "),
  "frame-src https://connect.nango.dev",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  reactStrictMode: true,
  // Backend URL can be provided either as NEXT_PUBLIC_API_URL (public) or
  // BACKEND_API_URL (private env var mapped into the client bundle at build).
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ?? process.env.BACKEND_API_URL ?? "",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "api.dicebear.com" },
    ],
  },
};

import { withSentryConfig } from "@sentry/nextjs/config";

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
