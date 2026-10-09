# Cityline rehearsal: published ticketing flow and safe simulation

## What was verified

TIXBAM Cityline rehearsal is an offline simulation of the steps documented
by Cityline. It does NOT access Cityline inventory, queue, checkout,
credentials, cards or real ticketing sessions.

Source material:
- Official [Cityline Event Ticket Purchase guide](https://www.cityline.com/BuyEventTickets.do?lang=en_US):
  performance, price zone, member login, type and quantity, shopping cart,
  fulfillment, payment, Transaction Preview, terms/confirm and receipt.
  **Screenshots show an older 2021 event**, not a guarantee of the layout of
  a current concert.
- [Cityline FAQ](https://cityline.com/FAQ.do?lang=en_US):
  Normal vs Express Purchase, event-dependent option availability,
  membership and supported payment categories.
- [General Cityline FAQ, December 2025](https://www.cityline.com/data/website_content/General_FAQ_en_US.pdf):
  presale qualifications, per-event limits, restricted view,
  real-name admission, transaction-history verification, seat availability,
  browser concurrency risks and fees.
- [Cityline waiting-room example](https://venue.cityline.com/utsvInternet/LNANDHKPRE20/home):
  warns users not to repeatedly retry a busy queue.

Unknown without an actual authorised ticketing session or event fixtures:
live seat geometry, event-specific admission requirements, exact prices,
availability, actual fees, precise timer, payment/receipt UI, and provider
automation permissions. These are NOT implied by the rehearsal.

## Simulated 10-stage flow

1. Choose a scenario, check plan conditions, and set an explicit HKD practice
   budget. If the saved plan uses NZD or another currency, users enter their
   own **practice-only** HKD limit. No silent currency conversion occurs.
2. Enter a simulated provider waiting room and avoid rapid retries.
3. Practise member login / one-time-code prompts and presale qualifications
   without entering passwords, real codes or personal credentials.
4. Choose a fictional performance, price zone, ticket category and quantity.
   Exercise Cityline-like adjacent-seat checkbox and event purchase limits.
5. Use Normal seat selection on a **fictional** seat map or an Express seat
   allocation; practise unavailability and restricted-view consent.
6. Inspect the shopping cart, sample seats, quantity and service charges.
7. Choose an illustrative fulfillment type, sample payment category,
   concession/ID eligibility and real-name ticket compliance (no PII).
8. Inspect the simulated Transaction Preview, terms, delivery/handling
   total and budget while a **made-up 120-second training timer** runs.
   There is no universal verified event checkout timer; an old Cityline
   2-minute movie ticket restriction must not be mistaken for a concert rule.
9. Practise completing a simulated bank-app / 3-D Secure challenge.
10. Distinguish a clearly marked SIMULATION RECEIPT (NO PURCHASE) from an
    unknown-payment scenario where official Transaction History must be
    checked before retrying a charge.

Nine scenarios: full purchase; high-demand queue; Express only; presale;
restricted view; seat-map failure; real-name ticketing; standing/general
admission without numbered seats; uncertain payment.

## Invariants and safety

- A hard ticket quantity is never silently lowered.
- Together-required seats cannot be separated, and the adjacent-seat
  checkbox cannot override that requirement.
- The simulated price calculation includes sample service and delivery
  fees and blocks orders that exceed the entered HKD training maximum.
- No actual identity or payment detail is collected; no real discounts
  or real price tiers are inferred.
- No rehearsal result is proof of purchase. The plan's lastRehearsalAt
  timestamp updates only after finishing a drill.
- A device may retain up to 10 non-sensitive practice summaries for a
  booking plan. The cloud only receives the rehearsal completion timestamp.
- The simulator does not reopen, hold, reserve or purchase real tickets.

## Verification and future fidelity

A dedicated Node test suite validates price mathematics, sold-out limits,
Express allocation, strict adjacency, restricted-view consent and duplicate
or unavailable seats. CI runs TypeScript/build and all existing tests.

Exact event UI fidelity requires lawful event-specific test recordings or
Cityline-authorized test environments. Static official guide images show
useful interaction patterns but cannot validate 2026 individual event
selectors or actual checkout and queue states.
