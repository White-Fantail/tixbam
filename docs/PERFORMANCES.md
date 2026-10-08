# Events, performances, and ticket-sale scopes

TixBam's shared public catalog supports:
`Artist -> Event -> Performance[]`, and each `TicketSale` is assigned to
**all performances** or a **selected subset** of one event.

This is the contract for **FastAPI, Admin, ChatGPT MCP, crawler and desktop**.

## Why it is structured this way

- An event groups the same artist, show and venue/city (e.g. three Tokyo
  Dome nights). Different cities are different events.
- A performance is one independently attendable show. Two shows on the
  same date are different performances if their start times differ.
- An official announcement can cover multiple cities and dates.
  `source_url` is provenance, **not a unique catalog identifier**.
- Sales can open for all performances at once or selected sessions only.
  The same ticketing provider, booking URL and sale time can be reused for
  different sessions without duplicating the parent event.
- Store all instants in UTC. A session has an explicit IANA timezone;
  its local venue time is rendered by consumers, with a separate user-local
  display where appropriate. Unknown start times remain null.
- Stable, user-supplied `session_key` values identify a performance *within*
  an event. External feeds may use a date/time-based stable key. Never
  use a page URL as a performance ID.

## API schema

`GET /v1/events` and `GET /v1/events/{id}` now include:

```json
{
  "id": "event-id",
  "artist": "Example Artist",
  "city": "Tokyo",
  "venue": "Tokyo Dome",
  "startsAt": "2026-11-07T08:00:00Z",
  "timezone": "Asia/Tokyo",
  "performances": [
    {
      "id": "session-1",
      "eventId": "event-id",
      "sessionKey": "2026-11-07-17:00",
      "label": "Saturday early show",
      "startsAt": "2026-11-07T08:00:00Z",
      "timezone": "Asia/Tokyo",
      "status": "scheduled"
    }
  ],
  "sales": [
    {
      "id": "sale-1",
      "eventId": "event-id",
      "providerId": "ticketmaster",
      "saleType": "general",
      "saleAt": "2026-10-15T03:00:00Z",
      "bookingUrl": "https://www.ticketmaster.com/",
      "appliesToAll": false,
      "performanceIds": ["session-1"]
    }
  ]
}
```

`startsAt` on Event is a **read-compatibility summary** (earliest known
session) rather than the source of truth. Clients should use `performances`.
Older REST clients that POST a single event with `starts_at_local` continue to
get a default performance. They can edit this single start time, but
multi-session changes belong in the performance API.

Read:
- `GET /v1/events/{id}/performances`
- `GET /v1/performances/{performance_id}`

Admin (requires `X-Admin-Key`):
- `POST /v1/admin/performances` — `event_id`, unique `session_key`,
  optional `label`, `starts_at_local`, `timezone`, `status`
- `PUT /v1/admin/performances/{id}` — update complete session
- `DELETE /v1/admin/performances/{id}` — rejects removal of last session
  and sessions referenced by selected-sales
- `POST|PUT /v1/admin/sales` — `applies_to_all` (true by default) and
  `performance_ids` (empty for all, nonempty for selected subset).
  Cross-event session IDs and duplicate selections are rejected.

The ChatGPT MCP interface exposes `list_performances`,
`create_performance`, `update_performance`, and sale creation/update
selection by `performance_ids`. All write calls still require OAuth
`tixbam:write` and the configured owner identity.

## Database migration / rollout

`Base.metadata.create_all` creates `performances` and `sale_performances`.
The startup migration:
1. Adds `ticket_sales.applies_to_all` as NOT NULL DEFAULT TRUE.
2. On Postgres, drops the old unique constraint on `events.source_url`.
3. Creates **exactly one** `default` performance for each historical event
   lacking performances; it copies the stored UTC start/timezone unmodified.
4. Leaves all old ticket sales applying to every session by default.
5. Is repeatable; rerunning it does not duplicate sessions or sales.

**Before production promotion**, back up the PostgreSQL database. This is a
schema/data change, and Railway's auto-deploy invokes it at startup.
Production deployment stays on `main` until a requested fast-forward merge.
Don't merge or deploy in the middle of a ticket on-sale window.

SQLite databases freshly created by the new models support shared source URLs.
For existing *legacy SQLite* files containing the original unique constraint
on `events.source_url`, use a tested SQLite schema rebuild in a controlled
offline migration before reusing an announcement URL across events. The
automatic constraint drop above targets the production PostgreSQL database.

## Crawler grouping and limits

`POST /v1/admin/ingest` groups structured entries by artist, event title,
city, country and venue, then upserts session keys. Same source URL and
different dates create multiple sessions. Repeated crawls update them.

If an official site does not provide a time zone offset, never guess the
instant. The operator should review and set it with local input in Admin/MCP.
Keep distinct city/venue names normalized by curated feed rules to avoid
duplicate events from inconsistent source spellings.

## UI / booking automation

Admin exposes an independent Performance directory and a sale scope selector.
Desktop discovery displays sessions and disables Watch/Open for a sale which
does not include the selected session, or whose session is cancelled/postponed.
Existing locally saved watchlist records remain readable.

Any later provider-specific seat preferences should record the **performance
ID**, not just the event ID. All booking/site automation continues to honor
provider restrictions, the user's explicit checkout consent and anti-bot checks.
