# npm advisories: investigation (R4)

Checked 2026-11-14 on Next.js 15.5.29 / React 19 with `npm audit` (the advisory database changes daily: re-run it before
each release). Method: every advisory was traced to the package that pulls it in (`npm ls`), checked for whether the
vulnerable code is loaded by this app, and checked for a fix, and whether the fix is a semver-major change.

## Result

| | before this pass | after |
|---|---|---|
| Production dependencies (`npm audit --omit=dev`) | 0 critical, **4 high**, 6 moderate | **0 advisories** |
| All dependencies including dev tooling | (not recorded) | 6 moderate (dev tooling only) |

## Fixed without a breaking change
| Advisory group | How it was reachable | Fix applied | Verified |
|---|---|---|---|
| **axios** (about 35 advisories, 12 of them high: SSRF via `NO_PROXY`, prototype-pollution gadgets, credential leaks on redirect...), pulled in by `@nangohq/frontend` -> `@nangohq/types` | **Not loaded at all.** `@nangohq/types` only ships `.d.ts` files that mention axios types; `@nangohq/frontend`'s compiled code never imports axios and nothing in this app calls it. It is not in the browser bundle or on the server. | `overrides: { "axios": "1.21.1" }` (same major, latest 1.x) so the tree no longer contains a vulnerable copy. | typecheck and production build pass; the 259-check browser suite passes (2026-11-15) |
| **postcss < 8.5.23** (4 advisories incl. 2 high: `sourceMappingURL` file read / path traversal and XSS in stringify), the copy nested inside `next` (Next pins 8.4.31) | **Build time only**, and only on CSS the project itself supplies (our own `globals.css` and Tailwind output). A visitor never reaches PostCSS. The top-level `postcss` (used by Tailwind) was already 8.5.32. | `overrides: { "next": { "postcss": "8.5.32" } }`: Next's `require("postcss")` now resolves to the patched copy. | production build passes (CSS compiles); the lockfile no longer contains `next/node_modules/postcss@8.4.31`; the 259-check browser suite passes |

Both overrides are removable: Next.js 16.x depends on a patched PostCSS itself, and a Nango release without the axios types
dependency would make the override unnecessary. Keep them until then and re-check on each upgrade.

## Sentry 11 applied (2026-11-15): production audit now 0 advisories
`@sentry/nextjs` 10.78 -> **11.12.0** (exact pin). The five moderate advisories came from the Sentry **build plugin**'s `glob`/`minimatch`
(build time only); Sentry 11 ships patched ones. It supports Next.js 14/15/16, so it did not require the Next 16 upgrade, and the project
already imported `withSentryConfig` from `@sentry/nextjs/config` (the only API move that affects this codebase). Node 22 satisfies its
engine range.

**Privacy (the real risk of this upgrade):** Sentry 11 replaces `sendDefaultPii` with `dataCollection` and, left unset, collects more
(cookies, user info, request bodies, query data, database query data, local variables). Nothing is left unset:
* `lib/sentry-privacy.ts`, used by the client, server and edge configs: `userInfo`, `cookies`, `httpHeaders` (request and response),
  `httpBodies`, `urlQueryParams`, `genAI` inputs and outputs, `databaseQueryData`, `queues`, `stackFrameVariables` and GraphQL data are all
  off, `sendDefaultPii: false`, and a `beforeSend` scrubber drops `user`, request body/cookies/headers/query string, the query string of the
  URL, and breadcrumb messages and data. What remains is the error, its stack and the page path.
* The Python API (`app/main.py`, `app/privacy.py`): `send_default_pii=False`, `max_request_body_size="never"`,
  `include_local_variables=False` and the same scrubber. (sentry-sdk would otherwise attach request bodies to error events.)
* Tests: `lib/sentry-privacy.test.mjs` (configuration is the strict baseline; the scrubber removes personal data and keeps the error) and
  `backend/tests/test_privacy_filter.py`.
* Data that should never reach an error report in this product: passwords, session tokens, API keys, email addresses, proposal text, job
  text, bank or wallet details. They live in request bodies, cookies, headers and local variables, all of which are excluded.

**What still needs a real DSN and a staging error (cannot be verified locally):** that an event arrives with the environment tag; that the
event JSON in Sentry really contains no request body, cookies, headers, user or query string (open one and check "Additional data");
that source-map upload works with `SENTRY_AUTH_TOKEN` (the build plugin was not exercised); Sentry project data-scrubbing and retention
settings; the alert rules. Procedure: `docs/integration-verification.md` section 6.

## Remaining: 6 moderate in development tooling only (not shipped)
`eslint-config-next` -> `@typescript-eslint/*` -> `typescript-estree` -> `minimatch 10.2.6` (the same denial-of-service
advisory). Linting runs on developers' machines and in CI over the project's own source. Not shipped. It clears with a newer
`@typescript-eslint` release that depends on `minimatch >= 11`; `npm update` will pick it up when `eslint-config-next`
allows it. Not worth a forced upgrade.

## Why not Next.js 16 now
Not needed for any remaining advisory (the only Next-related one, the nested PostCSS, is handled by the override above).
Reasons to wait and do it deliberately, from the official upgrade guide:
* `middleware` is **deprecated in favour of `proxy`**, which runs on the **Node.js runtime only** (no edge runtime). Our
  signed edge proof (`middleware.ts`) uses Web Crypto and works in both, but it would need to be renamed and re-verified on
  Vercel (the guide says to keep `middleware` if the edge runtime is needed, so this is a choice, not a blocker).
* **Turbopack becomes the default bundler** (including `next build`); `next.config.mjs` uses a webpack-era Sentry plugin that needs
  its own verification, and builds currently take several minutes.
* `next lint` is removed (the `lint` script must call ESLint directly) and ESLint flat config is expected.
* Node 20.9+ (fine), React 19.2, `next/image` defaults changed (we use none), AMP/`runtimeConfig` removals (not used),
  `images.domains` deprecated (not used).
Estimated effort one to two days including a full regression and a staging deploy. Recommended only after the first staging
deployment is stable.

## Why not Nango 0.72 now
The only advisories came through axios inside `@nangohq/types`, which is now fixed by the override and was never loaded.
`@nangohq/frontend` is used in two pages for the optional Outlook connect widget; an upgrade changes nothing about those
advisories, so it is left alone until a feature need appears.

## Backend (Python)
`pip-audit` against `backend/requirements.txt` (pinned): no known vulnerabilities (2026-11-14). It is a pinned file: re-run
`pip-audit -r backend/requirements.txt` before every release.

## Routine
Run `npm audit --omit=dev` and `pip-audit` before each release and weekly (enable Dependabot alerts on GitHub when the
repository exists, `docs/ci-first-run.md`). A production-dependency **high** or **critical** blocks a release.
