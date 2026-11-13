/**
 * Build-time feature flags (NEXT_PUBLIC_* values are compiled into the bundle).
 *
 * PAYMENTS_LIVE: set NEXT_PUBLIC_PAYMENTS_LIVE=true once Stripe checkout is live
 * on the backend (STRIPE_SECRET_KEY + webhook). It turns on free-plan profile
 * limits. Upgrades themselves don't read it: /checkout asks the server
 * (GET /api/billing/checkout-config) whether Stripe is set up, and never
 * collects card details itself.
 */
export const PAYMENTS_LIVE = process.env.NEXT_PUBLIC_PAYMENTS_LIVE === "true";
