# TIXBAM

**Prepare. Copilot. Book.** TIXBAM prioritizes live, provider-specific ticket selection assistance. It helps users assess the current screen and choose the next action in their own official browser. Dashboard and My Bookings organize each goal as a Booking Plan: target show/performance/sale, hard requirements, readiness checks, offline rehearsal and official booking launch. Artist/event favorites are secondary. Development happens on the dev branch. Cityline's live seat selection and payment automation are not yet verified; no queue/CAPTCHA bypass or guaranteed purchases. See [Booking-first architecture](docs/BOOKING_PLANS.md) and [Booking workflow](docs/BOOKING.md).

## Repository

```text
apps/desktop/         Electron 37 + React 19 + Vite (booking plans and local provider sessions)
apps/admin/           Next.js 16 protected operations dashboard (Vercel)
services/api/         FastAPI + SQLAlchemy + PostgreSQL (Railway)
services/crawler/     Opt-in structured-event ingestion worker (Railway cron)
packages/addon-sdk/   Shared add-on manifest and booking option contracts
```

## Run locally

Requires Node.js 22+, Python 3.12+, npm.

```sh
npm install
npm run dev               # Electron dashboard; existing provider browser windows
npm run dev:web           # Vite preview only (separate terminal)
npm run dev:admin         # Next.js admin at http://localhost:3000
npm test                  # Electron security and addon tests
npm run build             # desktop renderer + admin
```

Create a Python virtual environment and run the API from its own directory:

```sh
cd services/api
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env     # configure DB and admin API key; never commit this file
export DATABASE_URL="sqlite:///./tixbam.db"  # local-only example
export TIXBAM_ADMIN_API_KEY="your-long-random-development-secret"
uvicorn app.main:app --reload --port 8000
```

Use the same API key in `apps/admin/.env.local`, and set `TIXBAM_API_URL=http://127.0.0.1:8000`. Set `TIXBAM_ADMIN_USER` and `TIXBAM_ADMIN_PASSWORD` in that file before starting Next.js. The admin is **fail-closed** until credentials are configured.

The desktop automatically connects to the official API at `https://tixbam-production.up.railway.app`; users do **not** configure server URLs. **Settings → TIXBAM cloud** shows connection status and a manual retry option. For *local development only*, set `VITE_TIXBAM_API_URL=http://127.0.0.1:8000` in `apps/desktop/.env.local`. Production builds always use the official service and ignore any previously saved `tixbam.api.url` preference. The app stays usable offline for guest ticket browsing and local items. Provider cookies and card vaults are never uploaded. When signed in, account watchlists and favorites are stored on the server; optional guest import requires the user's action.

## Railway deployment

Use one GitHub repo with two **separate Railway services** deploying production from branch `main` (development continues on `dev`):

| Service | Root directory | Dockerfile | Command |
| --- | --- | --- | --- |
| `tixbam-api` | `/services/api` | `Dockerfile` | Default CMD (uvicorn on `$PORT`) |
| `tixbam-crawler` | `/services/crawler` | `Dockerfile` | Default CMD (single crawl pass, then exit) |

Add a Railway PostgreSQL service, configure `DATABASE_URL` on the API (Railway variable reference to your Postgres connection string) and set `TIXBAM_ADMIN_API_KEY` to a long unique secret. Publish HTTPS domain for the API. Set `TIXBAM_API_URL` to the public or accessible internal API URL for the crawler and copy the same secret to its environment. Configure crawler as a **Cron service**, currently `0 0 * * *` (daily, UTC); the worker also respects each source's `interval_minutes` field. Never run the crawler as an always-on Web Service. Railway configuration details: https://docs.railway.com/deployments/monorepo

For Vercel, import this repo and set **Root Directory** `apps/admin`. Use the Next.js framework, `TIXBAM_API_URL` pointing to the Railway API HTTPS domain, matching `TIXBAM_ADMIN_API_KEY`, and separate `TIXBAM_ADMIN_USER`/`TIXBAM_ADMIN_PASSWORD` for the admin website. Do **not** prefix admin keys with `NEXT_PUBLIC_` or `VITE_`.

## Admin console navigation

The Next.js admin at `apps/admin` uses the built-in App Router, a persistent
left sidebar and resource-specific URLs:

- `/artists`, `/events`, `/performances`, `/sales`, `/providers`, `/crawlers`
- `/<resource>/new`, `/<resource>/<id>`, `/<resource>/<id>/edit` (where supported)
- `/addons` and `/crawl-runs` (crawl runs are read-only; add-on version changes use Edit)

Directory lists support server-side search and pagination (25 rows/page). Clicking
a row opens the dedicated detail view; edit screens are reached from there.
Event details link to each performance and ticket sale. Displayed event/show/sale
times use their own IANA timezone plus the viewer's local timezone.

All management data is loaded on the server through `/v1/admin/directory/*`
using `TIXBAM_ADMIN_API_KEY`, which is never exposed to the browser.
Directory requests require the existing Admin API key, including read endpoints.
Directory provider registration supports `POST /v1/admin/directory/providers`
and `PUT /v1/admin/directory/providers/{id}`. IDs are immutable. Newly created
providers default to unpublished; registering a provider does not install an add-on.
The ordinary public `/v1/providers` and `/v1/addons` still expose only published
provider entries.

MCP owner-scoped tools now include `get_provider`, `list_providers` with optional
`include_unpublished`, `create_provider` and `update_provider`. Writes require
both `tixbam:read` and `tixbam:write` scopes. They register or change metadata
only; never enable unattended checkout or download unverified code.

## API

Public GET:
- `/healthz`
- `/v1/artists`
- `/v1/events`, `/v1/events/{id}`, `/v1/events/{id}/performances` and `/v1/performances/{id}`
- `/v1/providers`, `/v1/addons`

Authenticated administration (requires `X-Admin-Key`):
- `POST /v1/admin/artists`, `POST /v1/admin/events`, `POST /v1/admin/performances`, `POST /v1/admin/sales`
- `PUT /v1/admin/addons/{id}` (version/publication/metadata)
- `GET/POST /v1/admin/sources`, `PUT /v1/admin/sources/{id}`
- `POST /v1/admin/ingest`, `GET/POST /v1/admin/crawl-runs`

FastAPI Swagger documentation is served at `/docs`. The API initializes its MVP tables on startup and seeds the seven built-in provider registry entries only when absent. Before a production schema migration, replace bootstrapping `create_all` with a versioned Alembic migration workflow.

## Crawler

Only register sites for which automated collection is permitted. This starter worker retrieves *approved* HTTPS pages, consults robots.txt, and extracts schema.org `Event` / `MusicEvent` JSON-LD. It does not bypass CAPTCHA, queues or access restrictions, parse ticket inventory, or automatically discover every concert on arbitrary sites. Errors and empty results are recorded for admin review. A first-party source connector, deduplication improvements and permissions review are planned for Cityline.

```sh
cd services/crawler
pip install -r requirements-dev.txt
export TIXBAM_API_URL=http://127.0.0.1:8000
export TIXBAM_ADMIN_API_KEY="your-long-random-development-secret"
python -m crawler.run
pytest tests -q
```

## Live Copilot (development)

The first working Copilot bridge is now in the dev branch: opt-in local screen capture for a plan-linked browser at the ticket-selection stage; user-selected target overlays; one explicit, freshness-checked native click per screenshot; and optional AI candidate recognition with separate per-frame external-image consent (admin-controlled `copilot_vision` model policy; default OFF). Predictions are read-only; the user chooses and approves each click. No automatic retry, queue bypass, CAPTCHA handling, verified seats, autonomous cart holds or payments are enabled. Official checkout is the source of truth. [Architecture, limitations and QA](docs/LIVE_COPILOT.md).

Preview expected provider steps through the separate rehearsal window's default **Provider briefing** mode. Historical full rehearsal and Stress Lab are optional advanced tabs, not the primary booking workflow. This preview never claims event-specific actual inventory.

## Booking

Cityline uses **Manual booking assistance** from a Booking Plan or Live windows. Save your quantity, all-in HKD budget and ranked seat reminders; follow the Express/Normal guide, check the official cart and optionally enter its displayed remaining time into a local reminder. The helper focuses an existing official window without reloading it. You select seats and pay yourself; cart checks and reminders are user reports, never verified reservations. Offline rehearsal remains available. See [Cityline manual assistance](docs/CITYLINE_MANUAL_ASSIST.md) and [booking contracts](docs/BOOKING.md).

## Add-ons

**Live Nation is an Event / Presale add-on**, not a checkout provider. It supports eight official regional websites (pick the region in Add-on Store), sign-in and presale pages. The event's ticket agent handles seats and payment. To continue from a Live Nation event, use **Live windows → Ticket agent**, paste the official ticket-agent HTTPS URL supplied by the event, and TIXBAM opens it in the matching installed ticketing add-on's own persistent session. This user-confirmed handoff never guesses providers or shares session credentials. It does not automate eligibility, presale codes, seats, queues or payments.

The seven built-in add-ons install and uninstall locally, manage separate persistent Electron sessions, and preserve existing watchlists. The server now publishes provider/add-on **metadata** (version, status, compatible capability registry). Electron can read this registry and flag different versions, but it **does not download or execute remote add-on code yet**. This deliberate security boundary requires signed package verification and permission-scoped loading before remotely downloaded code can run. API or crawler outages never block existing browser windows.

## Tests

CI runs Electron tests and builds both JavaScript apps, then runs FastAPI integration tests and crawler parser tests. Local Python tests:

```sh
python -m pip install -r services/api/requirements-dev.txt
PYTHONPATH=services/api python -m pytest services/api/tests -q
python -m pip install -r services/crawler/requirements-dev.txt
PYTHONPATH=services/crawler python -m pytest services/crawler/tests -q
```

Admin operators: [editing and time zones](docs/ADMIN_SCHEDULES.md). All date/time forms use local venue or ticket-sale region time; UTC is internal only.


### Performance sessions and ticket sale scope

An Event represents a concert at one venue/city and contains multiple
Performances (different dates or separate same-day showings). A TicketSale
targets either every performance or selected performance IDs. Existing events
automatically acquire one default session on the API schema migration.
All consumer surfaces (FastAPI, Admin, MCP, crawler, Desktop) use the same
session-aware API contract. See [Performance architecture](docs/PERFORMANCES.md).

## User accounts & favorites

The desktop has account-aware favorite artists, favorite events and cloud-backed ticket-sale watchlists. Anonymous guest events remain in local storage. Google and Apple sign-in use real system-browser OAuth authorization-code flows; Google/Apple developer credentials are required before the buttons become available. Legacy demo logins are removed. See [Account architecture and setup](docs/ACCOUNTS.md). The API requires a separate \`TIXBAM_SESSION_SECRET\` to issue user sessions. Provider sessions and card vaults remain local.
