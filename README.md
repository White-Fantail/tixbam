# TIXBAM

Desktop ticketing workspace + concert directory + provider add-on registry. Development happens on `dev`. The desktop application opens official ticketing websites for manual login and verification. Cityline now has event-specific booking preferences, verified performance/price selection, a checkout rehearsal and a local encrypted card vault. Live Cityline seat and payment mappings remain pending; no queue bypass or guaranteed purchase. See [Booking workflow](docs/BOOKING.md).

## Repository

```text
apps/desktop/         Electron 37 + React 19 + Vite (local sessions and watchlist)
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

The desktop automatically connects to the official API at `https://tixbam-production.up.railway.app`; users do **not** configure server URLs. **Settings → TIXBAM cloud** shows connection status and a manual retry option. For *local development only*, set `VITE_TIXBAM_API_URL=http://127.0.0.1:8000` in `apps/desktop/.env.local`. Production builds always use the official service and ignore any previously saved `tixbam.api.url` preference. The app stays usable offline; provider cookies and local watchlists are never uploaded by this integration.

## Railway deployment

Use one GitHub repo with two **separate Railway services** deploying production from branch `main` (development continues on `dev`):

| Service | Root directory | Dockerfile | Command |
| --- | --- | --- | --- |
| `tixbam-api` | `/services/api` | `Dockerfile` | Default CMD (uvicorn on `$PORT`) |
| `tixbam-crawler` | `/services/crawler` | `Dockerfile` | Default CMD (single crawl pass, then exit) |

Add a Railway PostgreSQL service, configure `DATABASE_URL` on the API (Railway variable reference to your Postgres connection string) and set `TIXBAM_ADMIN_API_KEY` to a long unique secret. Publish HTTPS domain for the API. Set `TIXBAM_API_URL` to the public or accessible internal API URL for the crawler and copy the same secret to its environment. Configure crawler as a **Cron service**, currently `0 0 * * *` (daily, UTC); the worker also respects each source's `interval_minutes` field. Never run the crawler as an always-on Web Service. Railway configuration details: https://docs.railway.com/deployments/monorepo

For Vercel, import this repo and set **Root Directory** `apps/admin`. Use the Next.js framework, `TIXBAM_API_URL` pointing to the Railway API HTTPS domain, matching `TIXBAM_ADMIN_API_KEY`, and separate `TIXBAM_ADMIN_USER`/`TIXBAM_ADMIN_PASSWORD` for the admin website. Do **not** prefix admin keys with `NEXT_PUBLIC_` or `VITE_`.

## API

Public GET:
- `/healthz`
- `/v1/artists`
- `/v1/events` and `/v1/events/{id}`
- `/v1/providers`, `/v1/addons`

Authenticated administration (requires `X-Admin-Key`):
- `POST /v1/admin/artists`, `POST /v1/admin/events`, `POST /v1/admin/sales`
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

## Booking

Use **My events → Booking preferences & automation** on a Cityline event. Read the open booking form’s options, rank preferences and set required conditions. **Try rehearsal** exercises the full simulated workflow without charges. Manage runs in **Live windows**, and encrypted local cards in **Settings**. Details and current live limitations: [docs/BOOKING.md](docs/BOOKING.md).

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
