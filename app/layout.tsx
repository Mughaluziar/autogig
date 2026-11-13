import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autopilotv2.vercel.app";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c10" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Autopilot — Every platform. Every payment. One Autopilot.",
  description:
    "Connect Upwork, Fiverr, Freelancer.com and 76 more. Find jobs and gigs, send AI-drafted proposals, invoice clients who pay by card or crypto, and unlock funding to grow.",
  openGraph: {
    type: "website",
    siteName: "Autopilot",
    title: "Autopilot — Every platform. Every payment. One Autopilot.",
    description: "Find work on every platform, get paid by card or crypto, and unlock funding to grow your freelance business.",
  },
  twitter: { card: "summary_large_image", title: "Autopilot", description: "Every platform. Every payment. One Autopilot." },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
