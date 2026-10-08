# TIXBAM cloud accounts (dev)

TIXBAM stores each user's account profile, immutable social-provider identity
references, followed artists, favorited events and watched ticket-sale entries
in the platform PostgreSQL database. Provider browsing cookies, bank challenges
and encrypted card vaults are **never** sent to these endpoints.

## Development sign-in (no Google / Apple console setup)

On a **separate development database only**, set on the FastAPI service:

```env
TIXBAM_SESSION_SECRET=<random 32+ character secret>
TIXBAM_AUTH_MODE=development
TIXBAM_DEV_AUTH_ENABLED=true
```

Run the API locally (or against a separate isolated development deployment).
For the desktop Vite development build use `VITE_TIXBAM_API_URL=http://127.0.0.1:8000`
in `apps/desktop/.env.local`. Launch `npm run dev`. Under **Settings →
TIXBAM account**, choose **Demo Fan One** or **Demo Fan Two** and press
**Sign in for testing**. These are **shared fixed fake identities**:
anyone who can reach that development endpoint can become either one.
Do not use a real customer database, never enable mock auth on production,
and never store sensitive user data in these accounts.

For a packaged desktop, the authenticated API origin is pinned to the
official production service. Dev overrides are only accepted by a development
Electron build; they cannot redirect production account tokens. Account bearer
tokens are kept in Electron main and encrypted via OS-backed `safeStorage`
before persistence. If encrypted storage is unavailable, sign-in fails closed.

## Google and Apple design

The server has verified-ID-token exchange at `POST /v1/auth/social`.
Set `TIXBAM_GOOGLE_CLIENT_ID` and/or `TIXBAM_APPLE_CLIENT_ID` when the
real provider credentials are ready. A supplied provider-issued ID token is
checked for its RSA signature against the provider's JWKS, issuer, expected
client ID audience, expiration and stable subject before it is linked to a
TIXBAM user. The pairing key is `(provider, subject)`; matching emails alone
never link accounts. The desktop bridge for exchanging provider tokens is in
place, but **native system-browser OAuth authorization-code/PKCE and callback
flow is not yet connected**. Google/Apple buttons are correctly disabled
until that work is complete. Do not consider OAuth sign-in production-ready.

`TIXBAM_SESSION_SECRET` is independently configured for TIXBAM's signed
seven-day bearer tokens. It is not the admin API key or an OAuth client secret.
Rotating this secret invalidates existing account sessions.

## Account API

- `GET /v1/auth/methods` → available login methods / demo availability
- `POST /v1/auth/dev` → fixed simulated test user, only in dev mode
- `POST /v1/auth/social` → **verified** Google/Apple ID-token exchange
- `GET /v1/me` → account and synced favorites/watchlist
- `PUT/DELETE /v1/me/artists/{artist_uuid}` → follow/unfollow
- `PUT/DELETE /v1/me/events/{event_uuid}` → favorite/unfavorite
- `PUT/DELETE /v1/me/watchlist/{item_uuid}` → save/delete watched sale

Every `/v1/me` call requires `Authorization: Bearer <TIXBAM token>`; a
user identifier in the request body cannot select another user's data.
Signed-in watchlists are cloud-authoritative. Guest watchlists remain
device-local, and users can choose **Import guest events** after sign-in.
Unsuccessful server writes do not show a misleading local success.

Future work: native Google/Apple OAuth PKCE implementation, refresh/revocation
and account-linking UX, server-side pagination and push synchronization.
