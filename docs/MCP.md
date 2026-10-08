# TixBam ChatGPT MCP (integrated FastAPI deployment)

The MCP source lives in `services/mcp/tixbam_mcp/` and is mounted by
`services/api/app/main.py`. There is **no new Railway service**. The MCP
endpoint is `https://tixbam-production.up.railway.app/mcp`, once enabled.

## Deployment prerequisite (important)

The existing `tixbam-api` Railway service has **Root Directory:
`/services/api`**. Docker cannot COPY sibling folders outside its build
context. Before deploying a commit containing the new Dockerfile, update the
**existing** service's Railway settings:

- Root Directory: repository root (`/`, or unset).
- Dockerfile Path: `services/api/Dockerfile`.
- Existing start command, `PORT`, Postgres, hostname and environment stay.
- The `tixbam-crawler` service is unchanged.

Do **not** change the Railway build root before deploying the corresponding
root-context Dockerfile. The `dev` branch is for source/testing; production
follows `main` only after planned fast-forward merge.

## Authentication (no anonymous admin access)

MCP endpoints are **disabled entirely** unless ALL environment variables below
are configured in Railway:

```dotenv
TIXBAM_MCP_RESOURCE_URL=https://tixbam-production.up.railway.app/mcp
TIXBAM_MCP_OAUTH_ISSUER=https://YOUR-OAUTH-PROVIDER/
TIXBAM_MCP_OAUTH_JWKS_URL=https://YOUR-OAUTH-PROVIDER/.well-known/jwks.json
TIXBAM_MCP_OWNER_SUB=EXACT-OAUTH-USER-SUBJECT
```

Use a trustworthy OAuth 2.1 provider such as Auth0/Keycloak with:

- Authorization-code flow + PKCE (S256); client registration / metadata
  compatible with the ChatGPT MCP client.
- RS256 signed JWT **access tokens**; JWKS publicly served via HTTPS.
- Exact issuer (`iss`), resource audience (`aud`),
  and configured owner subject (`sub`).
- Scopes `tixbam:read` and `tixbam:write`; request the former for access
  and grant the latter only to the owner.
- Suitable `/.well-known/oauth-authorization-server` or OIDC discovery,
  correct redirect URL(s) copied from ChatGPT app connection, and refresh
  tokens/offline access if desired for ongoing use.

The server verifies signature, issuer, audience, subject, expiration and read
scope on EVERY bearer-token request. Every write tool separately checks the
write scope. The regular `X-Admin-Key` is **not** a valid MCP credential and
must never be shared with ChatGPT. This module intentionally does NOT implement
a homemade OAuth authorization server.

The ChatGPT custom-plugin creation UI will need the MCP URL above and the
OAuth flow enabled. A ChatGPT account/workspace must have permission to connect
custom remote MCP plugins and use write tools.

## Tools

| Read only | Write (requires `tixbam:write`) |
| --- | --- |
| `search_artists` | `create_artist`, `update_artist` |
| `list_events`, `get_event` | `create_event`, `update_event` |
| `list_providers` | `create_ticket_sale`, `update_ticket_sale` |

The tools reuse the **existing** SQLAlchemy models, schedule validators and
PostgreSQL database; no HTTP loopback to the public admin API. The catalog
tools do **not** crawl the internet. An AI operator researches official
sources separately, verifies the event, then invokes these tools.

Event creation requires a verified HTTPS `source_url`. The existing schema
has a UNIQUE constraint on this field: if an official page covers multiple
show dates, provide a separate official URL per show or extend the event model
before bulk ingest. Duplicate calls return `created: false` when safe,
rather than silently making new records or overwriting a different show.

The MCP session manager is run in FastAPI's parent lifespan and uses stateless
Streamable HTTP, so a separate server/port is unnecessary.

## Test locally

```sh
python -m pip install -r services/api/requirements-dev.txt
PYTHONPATH=services/api:services/mcp python -m pytest services/api/tests -q
PYTHONPATH=services/api:services/mcp python -m compileall -q services/api/app services/mcp
```

Without OAuth configuration the existing `/healthz`, `/v1/*` and
`/v1/admin/*` endpoints continue as before; `/mcp` is not mounted.

## Operational notes

- Research results are not inherently trustworthy: check official pages
  and time zones before approving writes.
- After installation, test with `search_artists` and then a deliberately
  reviewed test record before enabling bulk entry.
- Keep the server and OAuth credentials out of logs. Do not store provider
  browser sessions, card details or admin API keys in this integration.
