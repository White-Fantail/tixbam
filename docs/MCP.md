# TixBam MCP integration — production checklist

The MCP module in `services/mcp/tixbam_mcp` is imported by the existing
FastAPI process in `services/api`. **There is no extra Railway service or
database.** The production MCP endpoint, once deployed and configured, is:

```text
https://tixbam-production.up.railway.app/mcp
```

## 1. Source, branch, and Railway deployment

Develop on `dev`. The deployed `tixbam-api` tracks `main`.
The deployment will NOT pick up `dev` until the user requests a
**fast-forward-only** merge.

Existing API service deployment settings:

| Setting | Change |
| --- | --- |
| Root Directory | `/` (repo root) |
| Dockerfile Path | `services/api/Dockerfile` |
| Deploy branch | `main` (unchanged) |
| DATABASE_URL | existing value (unchanged) |
| TIXBAM_ADMIN_API_KEY | existing value (unchanged) |

As of 2026-10-09 these two Railway settings are **staged but not applied**
to the production `tixbam-api` service. Apply them when promoting the
matching root-context Dockerfile from `dev` to `main`. Do not apply
the Railway settings while the original Dockerfile is still deployed.

To avoid a build mismatch: verify staged config, fast-forward `main`
when explicitly requested, then apply staged Railway config and deploy
the new code as a single coordinated release. If the automatic deployment
runs before configuration applies, it may fail; use manual redeploy after
config is applied.

## 2. Provision Auth0 (separate user-controlled identity setup)

This implementation deliberately **does not run a homemade OAuth
authorization server** or accept the pre-existing static admin API key as
a ChatGPT credential. Use a trusted identity provider with discovery and
OAuth authorization-code + PKCE (S256). Auth0 is an example; another provider
supporting the same contract is acceptable.

In your Auth0 account:

1. Create an **API** with identifier **exactly**
   `https://tixbam-production.up.railway.app/mcp`. Use RS256 signing.
2. Add API permissions **`tixbam:read`** and **`tixbam:write`**.
   Grant both to the intended owner only. Configure RBAC / consent to prevent
   unrelated users receiving a write-capable access token.
3. Create a **Regular Web Application** OAuth client using authorization
   code + PKCE (S256), static client ID/secret, and refresh tokens / offline
   access where supported. Authorize that application for the TixBam API.
4. After starting the ChatGPT custom MCP plugin creation wizard, copy its
   **exact OAuth callback URL** into Auth0 Allowed Callback URLs. Do
   not guess the callback URL — ChatGPT shows the correct value.
5. In Auth0 confirm issuer URL (including trailing slash), discovery
   document, JWKS URL, client ID and client secret, and which `sub`
   claim your login returns. Configure scopes and audience so the token
   contains the **resource URL as its `aud`**, `tixbam:read`, and optionally
   `tixbam:write`. A valid JWT ID token by itself is not an API access token.
6. Verify that Auth0 includes PKCE S256 in discovery metadata and that its
   OAuth flow accepts the RFC 8707 `resource` parameter used by ChatGPT,
   or configure an authorization server compatibility layer/provider if it
   doesn't. Do not loosen the MCP audience check to make a broken token work.

In Railway -> tixbam-api -> Variables set these **four values** (do not
paste OAuth tokens, signing keys, or client secrets into GitHub or chats):

```dotenv
TIXBAM_MCP_RESOURCE_URL=https://tixbam-production.up.railway.app/mcp
TIXBAM_MCP_OAUTH_ISSUER=https://YOUR-TENANT.auth0.com/
TIXBAM_MCP_OAUTH_JWKS_URL=https://YOUR-TENANT.auth0.com/.well-known/jwks.json
TIXBAM_MCP_OWNER_SUB=EXACT_OWNER_SUB_FROM_YOUR_IDENTITY_PROVIDER
```

All four are required. If any are absent, the server does not expose
`/mcp`. OAuth issuer, signature, audience, exp, subject and read scope
are checked on all authenticated requests. A separate write scope is
checked on every mutation tool. The read and write scope requirements are
also advertised in the MCP tool descriptions and tool metadata.

**The OAuth provider account, app registration, callback whitelisting,
consent and ChatGPT plugin installation must be completed by an authorized
person in their own accounts.** Merely deploying the repo does not create
an OAuth tenant or connect a ChatGPT plugin.

## 3. Connect in ChatGPT

From ChatGPT web, open Plugins -> + -> Add custom MCP server (subject to
account/workspace access). Give it the name **TixBam**, server URL above,
and select **OAuth**. Choose static OAuth client credentials and paste
the Auth0 client ID/secret into the plugin setup screen, **not this chat**.
Use the exact redirect URI offered by ChatGPT in Auth0. Authorize with
the owner account, review requested permissions, and install the plugin.

Test in order:

1. Read-only: `search_artists` and `list_providers`.
2. Read an existing event with `list_events`.
3. Create a deliberately reviewed test artist with `create_artist`.
4. Create a verified event with an official source URL and localized start.
5. Create a test sale and confirm UTC/local conversion and visibility.
6. Confirm a read-only token cannot call write tools, and an unrelated
   user's token cannot access this owner's catalog.

Do not use real ticketing data to test without verifying official sources.

## 4. Catalog MCP tools

| Read (`tixbam:read`) | Write (`tixbam:read` + `tixbam:write`) |
| --- | --- |
| `search_artists` | `create_artist`, `update_artist` |
| `list_events`, `get_event`, `list_performances` | `create_event`, `update_event`, `create_performance`, `update_performance` |
| `list_providers` | `create_ticket_sale`, `update_ticket_sale` |

Tool handlers use the same SQLAlchemy models and timestamp validation as
the existing FastAPI. MCP has no automated internet search functionality:
ChatGPT may independently research official event sources and then ask
to register the verified information. `source_url` must be an official
HTTPS URL. Event identity is based on artist, title, city and venue, not `source_url`.
Multiple dates for one venue belong to different Performance records,
and multiple city events can share one source announcement URL.
A sale can apply to all performances or an explicit set of performance IDs.
See [performance model](PERFORMANCES.md).

## 5. Local tests

```sh
python -m pip install -r services/api/requirements-dev.txt
PYTHONPATH=services/api:services/mcp python -m pytest services/api/tests -q
PYTHONPATH=services/api:services/mcp python -m compileall -q services/api/app services/mcp
```

With OAuth disabled, the existing `/healthz` and `/v1/*` APIs are
unaffected. OAuth discovery is published on the MCP resource when enabled
and includes both read and write scopes. Do not expose the static
`TIXBAM_ADMIN_API_KEY` to clients.

References:
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/api/docs/guides/custom-mcp-server
