# npm advisories: investigation (R4)

Checked 2026-11-14 on Next.js 15.5.29 / React 19 with `npm audit` (the advisory database changes daily: re-run it before
each release). Method: every advisory was traced to the package that pulls it in (`npm ls`), checked for whether the
vulnerable code is loaded by this app, and checked for a fix, and whether the fix is a semver-major change.

## Result

| | before this pass | after |
|---|---|---|
| Production dependencies (`npm audit --omit=dev`) | 0 critical, **4 high**, 6 moderate | **0 critical, 0 high, 5 moderate** |
| All dependencies including dev tooling | (not recorded) | 0 critical, 0 high, 10 moderate |

## Fixed without a breaking change
| Advisory group | How it was reachable | Fix applied | Verified |
|---|---|---|---|
| **axios** (about 35 advisories, 12 of them high: SSRF via `NO_PROXY`, prototype-pollution gadgets, credential leaks on redirect...), pulled in by `@nangohq/frontend` -> `@nangohq/types` | **Not loaded at all.** `@nangohq/types` only ships `.d.ts` files that mention axios types; `@nangohq/frontend`'s compiled code never imports axios and nothing in this app calls it. It is not in the browser bundle or on the server. | `overrides: { "axios": "1.21.1" }` (same major, latest 1.x) so the tree no longer contains a vulnerable copy. | typecheck and production build pass; the 259-check browser suite passes (2026-11-15) |
| **postcss < 8.5.23** (4 advisories incl. 2 high: `sourceMappingURL` file read / path traversal and XSS in stringify), the copy nested inside `next` (Next pins 8.4.31) | **Build time only**, and only on CSS the project itself supplies (our own `globals.css` and Tailwind output). A visitor never reaches PostCSS. The top-level `postcss` (used by Tailwind) was already 8.5.32. | `overrides: { "next": { "postcss": "8.5.32" } }`: Next's `require("postcss")` now resolves to the patched copy. | production build passes (CSS compiles); the lockfile no longer contains `next/node_modules/postcss@8.4.31`; the 259-check browser suite passes |

Both overrides are removable: Next.js 16.x depends on a patched PostCSS itself, and a Nango release without the axios types
dependency would make the override unnecessary. Keep them until then and re-check on each upgrade.

## Remaining: 5 moderate in production dependencies, all one chain (build-time)
`@sentry/nextjs 10.78` -> `@sentry/bundler-plugins` / `@sentry/webpack-plugin` -> `glob 13.0.6` (GHSA-3g3m-2fjr-6pw4: an
`AbortSignal` cancellation bypass allowing filesystem traversal after a timeout) -> `minimatch 10.2.6` (GHSA-g3hv-75wg-m249:
denial of service through glob-pattern amplification).
* **Reachability:** these packages are used by the Sentry **build plugin** to find source-map files when uploading them (only when
  `SENTRY_AUTH_TOKEN` is set, see `next.config.mjs`). They run on the build machine over the project's own build output; no
  visitor input reaches them, and they are not part of the running site.
* **Fix:** `@sentry/nextjs` **11.12.0** (a major). A lock-file dry run in a scratch copy (the project was not changed) showed
  `npm audit --omit=dev` reporting **0 vulnerabilities** with it. It supports Next.js 14, 15 and 16, so it does **not** depend on
  the Next 16 upgrade.
* **Why it is not applied:** (1) the upgrade guide lists changes that matter here and cannot be proven without a Sentry
  project: **`dataCollection` replaces `sendDefaultPii` and, left unset, collects more by default** (cookies, headers, query
  parameters, user data: this is a privacy decision, the baseline must be set explicitly in the three `sentry.*.config.ts`
  files before upgrading), span streaming becomes the default, `enableOpenTelemetrySetup` now defaults to `true` for
  `@sentry/nextjs`, Node 20.19+ is required (the project uses Node 22), the `loader` entry was removed (not used), and
  `withSentryConfig` must come from `@sentry/nextjs/config` (already the case); (2) source-map upload and event capture cannot
  be exercised locally. **Recommendation:** approve a small, separate change: bump to 11.12, set `dataCollection` explicitly to
  the minimum (no cookies, headers or user data), then verify on staging with a real DSN that an error arrives with the
  environment tag and without request bodies, cookies or email addresses (docs/integration-verification.md section 6).
  Effort about half a day plus the staging check.
* **Interim risk:** low. Do not run `npm run build` with `SENTRY_AUTH_TOKEN` set on a machine that builds untrusted code.

## Remaining: 5 moderate in development tooling only
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
