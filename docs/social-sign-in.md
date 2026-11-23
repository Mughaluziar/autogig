# Sign-in, email verification and social sign-in

How accounts are created and confirmed: email + password signups confirm their
address with a 6-digit code, and Google, Apple, GitHub and Microsoft sign-in
run a standard OAuth 2.0 / OpenID Connect flow through the backend.

Code: `backend/app/routers/auth.py`, `backend/app/oauth.py`,
`backend/app/auth.py` (token claim and enforcement), and on the frontend
`components/auth/*`, `app/(auth)/verify-email`, `app/(auth)/auth/callback`.
Tests: `backend/tests/test_auth_accounts.py`, `backend/tests/test_auth_oauth.py`.

## Account types

New accounts are **Agency / Admin**, **Freelancer** or **Investor**. Client
accounts and the client portal were retired: clients pay invoices through the
pay link they're sent (`/pay/<token>`) without an account. Existing client
accounts can't sign in; they see a message saying so.

Signup also stores a small profile on the user: country (a dropdown, United
States by default), hourly rate, skills, experience, availability, team size,
bio, and one **linked freelancing account** (Upwork, Fiverr, Freelancer.com,
Toptal, PeoplePerHour, Guru, Contra, LinkedIn, GitHub or another site). A bare
username is turned into the profile URL where the platform has one; otherwise
the link must point at that platform's site. The rules are in
`normalize_linked_account` (backend) and `normalizeLinkedAccount` (frontend).
When the linked account is Upwork and the account is an agency workspace, the
page after email verification goes straight to the dashboard.

## Email verification

1. `POST /api/auth/signup` creates the account with `email_verified: false`,
   stores the SHA-256 HMAC of a random 6-digit code (never the code), and emails
   it. The code expires after 15 minutes and allows 5 wrong tries.
2. The session it returns carries `ev: false`. Until it's swapped, the backend
   lets that session reach only `/auth/me`, `/auth/verify-email` and
   `/auth/resend-verification` (403 everywhere else), and the dashboards send it
   to `/verify-email`.
3. `POST /api/auth/verify-email {code}` marks the email verified, sends the
   welcome email and returns a fresh, unrestricted session.
4. `POST /api/auth/resend-verification` issues a new code: once a minute, five
   times an hour.

Accounts created before verification existed count as verified. Social
sign-ins are verified by the provider when it vouches for the email (below).

### Delivery and environments

| Situation | What happens |
|---|---|
| Email provider configured (`RESEND_API_KEY` or `SMTP_*`) | Code is emailed; verification is enforced. |
| No provider, not production | The API returns the code (`devCode`) and the page shows it under a "Development only" label. |
| No provider, production | Verification stays enforced. Password signup and resend return 503 until a provider is configured. |
| `EMAIL_VERIFICATION=false` | Verification is off in development and test. Production startup rejects this setting. |

`GET /api/auth/providers` reports the current mode as
`emailVerification: {enforced, delivery: "email" | "dev" | "unavailable" | "off"}`.

## Social sign-in

### Flow

1. The button links to `GET /api/auth/oauth/<provider>/start?role=<admin|freelancer|investor>&next=<path>`.
2. The backend stores a random, single-use state (as a SHA-256 hash, 10 minutes)
   holding the role, the PKCE verifier (Google, GitHub, Microsoft) or the OIDC
   nonce (Apple), and redirects to the provider.
3. The provider returns to `/api/auth/oauth/<provider>/callback` (Apple POSTs a
   form). The backend exchanges the code, reads the identity, then signs in to,
   links, or creates the account.
4. It redirects to the app's `/auth/callback?code=<one-time code>`; the page
   trades that code (single use, 2 minutes) for the session with
   `POST /api/auth/oauth/exchange`. The session token never appears in a URL.

Failures return to `/login?oauth_error=<reason>`, where the page explains what
happened (`denied`, `expired`, `rejected`, `no_email`, `email_conflict`,
`not_configured`, `retired`, …).

### Which account a sign-in uses

- An identity seen before (`oauth_identities`: `<provider>:<subject>` → email)
  signs in to that account.
- Otherwise, if an account already uses the email, it's linked **only if the
  provider verified the email**; if not, sign-in is refused (`email_conflict`)
  so nobody can take over an account with an unverified address.
- Otherwise a new account is created with the role chosen on the page. If the
  provider didn't verify the email, the new account must confirm it with a code
  like a password signup.

Email verification by provider: Google `email_verified`; GitHub's primary
verified address from `/user/emails`; Apple `email_verified` in the signed ID
token; Microsoft only for personal accounts or when the token carries
`xms_edov` (work-account email claims aren't proof of ownership).

Accounts created this way have no password (`hasPassword: false`); they can set
one with `POST /api/auth/change-password` (no current password needed until
one exists).

### Configuration

Set `PUBLIC_API_URL` to the API's public origin (for example
`https://autopilot-api.onrender.com`). Every redirect URI is
`<PUBLIC_API_URL>/api/auth/oauth/<provider>/callback`. A provider appears on the
sign-in pages only once all of its variables are set; outside production the
unconfigured ones show greyed out.

| Provider | Where | Variables |
|---|---|---|
| Google | Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application). Scopes: openid, email, profile. | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub | GitHub → Settings → Developer settings → OAuth Apps. Callback URL as above. | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Microsoft | Microsoft Entra admin center → App registrations → New registration (Web platform redirect URI as above) → Certificates & secrets. Optionally add the `xms_edov` optional claim so work emails count as verified. | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` (`common` by default) |
| Apple | Apple Developer → Identifiers: an App ID with Sign in with Apple, then a **Services ID** (its identifier is the client ID) with the domain and return URL above; Keys: a Sign in with Apple key (.p8). | `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the .p8 contents; `\n` escapes allowed) |

Apple requires a real HTTPS domain for the return URL (no localhost). When
`API_KEY` hardening is on, Apple's form post to the callback is exempt; its
single-use state authenticates it.

## Endpoints

| Method | Path | Auth |
|---|---|---|
| POST | `/api/auth/signup` | public |
| POST | `/api/auth/login` | public |
| GET | `/api/auth/me` | session (pending allowed) |
| POST | `/api/auth/verify-email` | session (pending allowed) |
| POST | `/api/auth/resend-verification` | session (pending allowed) |
| POST | `/api/auth/change-password` | session |
| GET | `/api/auth/providers` | public |
| GET | `/api/auth/oauth/{provider}/start` | public |
| GET/POST | `/api/auth/oauth/{provider}/callback` | public (state) |
| POST | `/api/auth/oauth/exchange` | public (one-time code) |
