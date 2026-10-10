# Cityline manual booking assistance

Cityline's bundled add-on declares `bookingAssistance.mode: manual`, `guide: cityline`, and `payment: user`. BookingPanel selects this guide per add-on; other providers keep their existing paths and independent automation capability checks. This is a local helper for the user's real booking, not a reservation driver.

## Use

1. Open a Cityline Booking Plan's preferences, or choose **Manual booking assistance** in Live windows.
2. Save quantity, total HKD budget including fees, performance/date notes and price/section/floor priorities. Budget from another currency is never silently converted. These labels are personal reminders, not observed availability or provider IDs. Actual purchase limits remain event-specific.
3. Open or return to the official window. Existing windows are focused without navigation or reload. Plan launches reuse the host's existing plan session, including an orphan verification popup, rather than starting another booking. Official promoter links still use the existing trusted ticket-agent handoff.
4. In the official queue, follow its instructions. The guide explains Express (provider allocation) and Normal (manual seat-map selection); some events offer Express only. Select and submit tickets yourself.
5. Check the official cart's performance, quantity, seat location/adjacency, restrictions and all-in total. Enter the total locally for a budget comparison. These checks are explicitly user reports.
6. Optionally copy the displayed remaining minutes and seconds into the local reminder. No timer is started by default. It uses an absolute local deadline so elapsed time after suspension is reflected. It neither proves nor extends a hold, and its expiry does not establish that Cityline released seats.
7. Pay and verify the official receipt/order history yourself. The helper never records a verified reservation or purchase. Closing it clears cart assertions and the reminder; saved preparation persists and the official browser stays open.

Official purchase guide and FAQ buttons open fixed bundled document URLs in the system browser, independently of the ticketing session. The host accepts document names, not arbitrary renderer URLs, checks add-on installation and allows only the dashboard caller.

## Boundaries and data

Manual assistance never calls booking-context, start/resume-booking, site scripts, DOM inspection, inventory polling, reservation requests, card vault APIs or payment submission. The host also rejects live Cityline booking-context requests independently of renderer flags. Offline rehearsal remains available.

Only allowlisted preparation fields are saved in the event/provider-scoped localStorage entry. Existing plan preference saves use the app's existing local/account persistence path. Cart assertions, entered cart totals, timers and payment information are not saved by this helper. Manually recorded cart data never feeds the reservation ledger, verified receipt or automatic runner.

The current renderer panel is a preparation/guidance dialog; users switch to the actual official browser to act. It does not guarantee availability, queue admission or purchase success.

## Official references

- [Cityline purchase guide](https://www.cityline.com.hk/en_US/BuyEventTickets.html)
- [Cityline General FAQ](https://www.cityline.com/data/website_content/General_FAQ_en_US.pdf)
- [Cityline terms, section 21](https://www.cityline.com/en_US/ReleaseNotes.html#termsconditions)

## Validation

Tests cover strict HKD amounts, malformed local persistence, user-only countdowns, provider-specific capability separation, the rendered manual panel, fixed official guide destinations and host rejection of live Cityline page reads. No real reservation or payment is performed in these tests.
