# TIXBAM booking-first architecture

## Product goal
TIXBAM is a ticketing preparation and assistance app, not a fan content app. The
primary journey is **Prepare → Rehearse → Book → Verify**. Artists, event catalogs,
favorites and add-ons support this journey rather than dominating navigation.

## Structure
- Dashboard emphasizes Create Booking Plan and the next actionable plan.
- My Bookings owns a purchase target, ticket constraints, manual readiness
  checks, offline rehearsals, and official booking-site launch.
- Discover creates plans directly from a specific event, performance and sale.
- Saved contains favorite artists and events, saved performances/sales, and
  legacy watched tickets retained for compatibility.
- Sessions keeps provider browser windows and running booking attempts.

## Accounts and migration
The UserBookingPlan table stores only validated, non-secret plan data, scoped by
account ID. The API exposes authenticated PUT/DELETE /v1/me/plans/{uuid} and
adds bookingPlans/favoritePerformanceIds/favoriteSaleIds to GET /v1/me.
Legacy cloud watchlist records are backfilled once at startup into plans with
the original record ID; the watchlist is never removed. Guest watchlist data
is locally imported only when the new store is first created. Guest-to-cloud
import requires an explicit action.

Cloud payloads never contain card numbers, CVV, provider cookies, ticket-site
sessions, or bank challenges. Payment and provider-specific dynamic options
remain local to the desktop host.

## Rehearsal and safety
The general offline rehearsal simulates queue admission, accepting/rejecting
offers against a known budget, review and bank verification. It never accesses
any ticketing website, reserves seats or charges money. Its completion means
only that an offline walkthrough was finished.

The existing Cityline adapter remains limited to verified public performance
and price choice controls. Live seat selection and payment are NOT verified.
A direct provider link is needed to configure live options; promoter/event
pages are not equivalent. The actual booking site remains the source of truth.
No CAPTCHA, queue, anti-bot challenge or bank authentication bypass is added.
Unclear payment outcomes must be verified in provider order history and must
not trigger automatic payment retry.

## Future implementation (not asserted by this release)
1. Provider-permitted live automation and official-site state integration.
2. Plan-linked provider-specific seat preference versions and rehearsal reports.
3. Per-provider capability/terms verification before enabling automation.
4. Expanded consented diagnostics and recovery beyond the current minimal local interruption journal.
5. Verified receipt/charge outcome and explicit recovery paths.

Do not infer a successful actual purchase from rehearsal completion.

## Offline resilience and currency handling

When the signed-in API becomes unavailable, the desktop can display the last
successfully synced account snapshot stored in its OS-encrypted account file.
The session must still be within its known expiration time. A clear offline
banner warns that cloud writes cannot be completed. Successful plan mutations
update the encrypted snapshot; account sign-out deletes it. These cached plans
are for viewing and for opening local provider sessions, not for bypassing login
or asserting ticket availability. A generic offline drill can still be finished,
but an unsaved result is labelled as unsaved.

Basic ticket count, maximum total, adjacency requirement and fallback policy
are shared between a Booking Plan and the optional provider-specific booking
configuration. Dynamic seat/price choices remain on the device. The editor
supports zero-decimal currencies such as KRW/JPY and common two-decimal
currencies; the value is stored in the currency's smallest unit. For providers
serving multiple countries, users must confirm the currency themselves.

## Live Booking Control Room

The initial plan-bound live browser workspace, explicit manual stage guidance,
protected session reuse/closure, popup tracking and minimal interruption
reminders are now implemented. These features do not verify any third-party
checkout. See [Live Booking Control Room](LIVE_BOOKING_WORKSPACE.md) for
safety/truth boundaries and hands-on QA scenarios.
