# TIXBAM account: Google and Apple sign-in

TIXBAM's desktop application opens the user's **system browser** to sign in
with Google or Apple. The API exchanges provider authorization codes, validates
the ID token signature/audience/issuer/expiry and per-login nonce, and creates
a TIXBAM account keyed to the stable **(provider, subject)** pair. Matching
emails alone do **not** merge social accounts.

The OAuth callback is on the API's own HTTPS domain, not in a local webview.
The desktop and backend bind each login to a one-time, random, desktop-held
verifier (SHA-256 challenge). The API stores a pending flow in Postgres (5-minute
TTL), but **never stores provider access/refresh tokens** and never passes the
TIXBAM bearer token through a browser redirect URL. The desktop polls the
server to claim a completed login, and encrypts the returned TIXBAM token with
Electron `safeStorage`. Provider ticket-site sessions, bank challenges and
payment card information stay local.

## Set up social-provider credentials (required once, before login works)

The application code is ready, but Google and Apple require real credentials
created by the TIXBAM application's owner; those credentials cannot be
created by code and must not be committed to GitHub.

1. **Google Cloud Console:** configure the OAuth consent screen, authorized
   users/audience and a **Web application** OAuth client. Register the exact
   authorized redirect URI:
   `https://tixbam-production.up.railway.app/v1/auth/oauth/google/callback`.
   Keep the client secret on the FastAPI Railway service.
2. **Apple Developer:** enable **Sign in with Apple** for an App ID, create
   its associated **Services ID**, configure and verify the website domain
   and the exact Return URL:
   `https://tixbam-production.up.railway.app/v1/auth/oauth/apple/callback`.
   Create a Sign in with Apple private key and obtain its Team ID and Key ID.
   Apple requires a registered HTTPS redirect domain; localhost is unsupported.
3. **Railway API variables:** add a different 32+ character
   `TIXBAM_SESSION_SECRET`; add credentials as applicable:
   
   ```env
   TIXBAM_PUBLIC_URL=https://tixbam-production.up.railway.app
   TIXBAM_SESSION_SECRET=<32+ strong random characters>
   TIXBAM_GOOGLE_CLIENT_ID=<Google Web client ID>
   TIXBAM_GOOGLE_CLIENT_SECRET=<Google Web client secret>
   TIXBAM_APPLE_CLIENT_ID=<Apple Services ID>
   TIXBAM_APPLE_TEAM_ID=<Apple Team ID>
   TIXBAM_APPLE_KEY_ID=<Apple private key identifier>
   TIXBAM_APPLE_PRIVATE_KEY=<Apple .p8 private key text, newline-escaped if necessary>
   ```

Credentials are independent: one provider's button works when its respective
variables are complete. The app disables only unconfigured sign-in methods.
The native Sign in with Apple on macOS is not required; both providers use
the OS system browser. OAuth may require app publication / provider
verification before sign-in is allowed for the general public.

## Developer workflow

Run the API and Electron locally, with developer OAuth credentials registered
to your callback domain. For an isolated Google-only local API test you can
set `TIXBAM_AUTH_MODE=development`,
`TIXBAM_PUBLIC_URL=http://127.0.0.1:8000`, and register its callback with
Google if your Google client accepts the URI. Apple still requires HTTPS and
a registered domain. A packaged desktop always sends authentication requests
only to the official production API.

**Test accounts and bypass endpoints are removed.**
On FastAPI startup, legacy fixed demo identities `fan-one` and `fan-two`
are purged, along with their data when they have no real linked identity.
Social users and their favorite data are retained. No shared pretend-identity
sign-in remains available, even in development mode.

## API

- `GET /v1/auth/methods` — configured Google/Apple providers only
- `POST /v1/auth/oauth/start` — provider + desktop-generated SHA-256 challenge;
  returns sign-in URL + one-time flow ID
- `GET /v1/auth/oauth/google/callback` — Google browser return
- `POST /v1/auth/oauth/apple/callback` — Apple `form_post` return
- `POST /v1/auth/oauth/complete` — desktop-only claim with verifier; yields
  a signed 7-day TIXBAM session once, or returns `202 pending`
- `GET /v1/me` — signed-in favorites, booking plans, and legacy ticket-sale watchlist
- `PUT/DELETE /v1/me/artists/{artist_uuid}` — follow/unfollow
- `PUT/DELETE /v1/me/events/{event_uuid}` — favorite/unfavorite
- `PUT/DELETE /v1/me/watchlist/{item_uuid}` — legacy watched ticket-sale records
- `PUT/DELETE /v1/me/plans/{plan_uuid}` — account-scoped booking plan (no payment secrets)
- `PUT/DELETE /v1/me/saved/{performance|sale}/{uuid}` — save a specific performance or sale

`/v1/me` calls require the TIXBAM account bearer token. The desktop also retains an OS-encrypted, read-only last-synced snapshot for temporary API outages while the account session remains unexpired. Signed-in data lives
in the cloud; anonymous guest watchlists remain device-local until explicitly
imported. Account sessions and provider-site browser cookies remain separate.

Production follow-ups: token refresh/revocation, optional deliberate linking
of multiple social identities to one account, account self-service deletion,
rate limits / monitoring on unauthenticated start endpoints.
