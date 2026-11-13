# Upwork: direct OAuth connection

_Built 2026-11-11. Replaces the Nango `upwork` integration, which could never work: Nango has no Upwork provider._

Each user signs in on upwork.com and grants this app access. The backend stores the resulting tokens, encrypted, and calls Upwork's GraphQL API with them for **job search** (`/api/upwork/jobs`) and **order sync** (Orders → Add account → Upwork). Nothing here is live until Upwork approves the app (see the go-live checklist).

## How it works

```
Accounts page / Orders → Add account
  └─ POST /api/upwork/oauth/start {returnTo}  ──► single-use state (10 min) ──► {authorizeUrl}
browser ──► upwork.com/ab/account-security/oauth2/authorize  (user signs in and approves)
upwork.com ──► GET /api/upwork/oauth/callback?code&state     (public; the state names the app user)
  ├─ POST upwork.com/api/v3/oauth2/token  (code → access + refresh token)
  ├─ GraphQL `user { id nid name }`       (which Upwork account this is)
  ├─ store tokens encrypted in upwork_connections (one per app user per Upwork account)
  └─ 303 → <site>/dashboard/orders?upwork=connected&connectionId=uwc_…
Orders page ──► POST /api/orders/accounts {platform: Upwork, mode: api, connectionId}
```

- **Tokens never leave the backend.** They're Fernet-encrypted (`backend/app/crypto.py`) before they're written, and no API response includes them.
- **Refresh.** An access token is refreshed 5 minutes before it expires. A rotated refresh token is stored; if Upwork doesn't return one, the current one is kept. Refreshes use compare-and-set, so two requests refreshing at once can't overwrite each other. The loser uses the winner's token.
- **A 401 from GraphQL** triggers one forced refresh and one retry.
- **When Upwork rejects the refresh token** (the user revoked the app, or it expired), the connection becomes `needs_reauth` and its order accounts are flagged. Reconnecting the same Upwork account updates the same connection and resumes those accounts.
- **Disconnecting** deletes the tokens and pauses the order accounts that used them.
- **Job search** uses the user's newest active connection.
- **The callback** only redirects to `/dashboard/orders` or `/dashboard/accounts` on `PUBLIC_SITE_URL` (or the first `CORS_ORIGINS` entry). The URL carries a short reason code, never Upwork's error text.

## Settings

| Variable | Value |
|---|---|
| `UPWORK_CLIENT_ID`, `UPWORK_CLIENT_SECRET` | The Upwork API app's key and secret. |
| `UPWORK_REDIRECT_URI` | `https://<api>/api/upwork/oauth/callback`. It must match the app's callback URL on Upwork exactly. |
| `TOKEN_ENCRYPTION_KEY` | A Fernet key: `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. To rotate, set `new,old`; tokens are re-encrypted with the new key as they refresh. Losing the key means every user reconnects. |
| `UPWORK_COMMERCIAL_APPROVED` | `true` only after Upwork's written approval. Until then nobody can connect. |
| `UPWORK_OFFERS_READ_APPROVED` | `true` only once the app has "Offer - Read-Only Access". Needed for order sync, not for job search. |
| `PUBLIC_SITE_URL` | The frontend origin the callback returns to. |

## Endpoints

| Method | Path | Auth |
|---|---|---|
| GET | `/api/upwork/connections` | session: `{canConnect, reason, connections[]}` |
| POST | `/api/upwork/oauth/start` | session: `{returnTo}` → `{authorizeUrl}` |
| GET | `/api/upwork/oauth/callback` | public: single-use state |
| DELETE | `/api/upwork/connections/{id}` | session |

## Go-live checklist

1. **Upwork approval.** Get written approval for commercial use (partnerships@upwork.com) and an API key at upwork.com/developer/keys/apply. Request the scopes the app needs: read marketplace job postings, plus "Offer - Read-Only Access" and "Common Entities - Read-Only Access" for orders.
2. **Register the callback** on the Upwork app as `https://<api>/api/upwork/oauth/callback`, then set the settings above.
3. **Contract test.** Connect one real account and run job search and an order sync. The GraphQL queries follow Upwork's reference but haven't yet run against an approved app.
4. **Organizations.** Only the token's default organization is read (no `X-Upwork-API-TenantId`). Agency accounts that need another organization need that header added.

## Where things are

- Backend: `backend/app/upwork/` (`client.py`, `store.py`), `backend/app/routers/upwork_connect.py`, `backend/app/crypto.py`. The callers are `backend/app/routers/upwork.py` (job search) and `backend/app/orders/adapters/upwork.py` (orders).
- Frontend: `lib/upwork.ts`, `components/dashboard/upwork-connections.tsx` (Accounts page), and `app/dashboard/orders/page.tsx` (adds the order account on return).
- Tests: `backend/tests/test_upwork_oauth.py`.
