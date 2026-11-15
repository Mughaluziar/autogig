import * as Sentry from "@sentry/nextjs";
import { scrubEvent, sentryPrivacy } from "./lib/sentry-privacy";

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.05,
  enabled: Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
  ...sentryPrivacy,
  beforeSend: scrubEvent,
});
