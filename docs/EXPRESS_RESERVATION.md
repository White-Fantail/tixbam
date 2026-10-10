# Express reservation implementation status

Implemented and tested offline:

- Explicit automatic-allocation preference; provider/event/performance/session/
  window-generation binding; fresh observation; event-specific quantity limit.
- Pre-allocation requests do not fabricate seats, fees or adjacency. They bind
  requested price tier, quantity, currency and maximum final amount.
- One-shot allocator with ownership/permission rechecks, bounded deadline and
  abort guards. A reviewed browser driver must independently validate the same
  context immediately before its actual mutation; Promise.race alone cannot
  undo an already dispatched click.
- Write-ahead fsync using the existing secured journal engine. Duplicate check
  and insertion happen under the same exclusive journal lock. Reservation
  history uses separate storage from payment history. Persisted unresolved or
  previously held intent blocks new requests in the same ledger scope, even
  across run/window changes. Recovery never assumes a hold remains valid.
- Typed provider-cart evidence: actual order reference, provider identities,
  same session/generation, strict final fees/terms/allocation/adjacency and
  authoritative expiry (or explicitly unknown expiry). Opaque one-use proofs;
  provider hold references remain private/HMAC-only on disk.
- Runner: allocation -> verified hold -> frozen user-payment handoff. Ambiguous
  response, violated conditions or expired/missing hold -> RESERVATION_UNKNOWN.
  No automatic release, new reservation, CAPTCHA handling or payment dispatch.
- UI: same-window handoff, notification, hold deadline display, explicit mock
  labels, and no Resume button for handoff/uncertain reservation states.
- Five standalone rehearsal scenarios use the same runner and reservation
  transaction with a synthetic observer/allocator. No external website calls.

Not implemented or verified live:

- Actual Cityline allocation/cart DOM profiles, reservation control, server
  hold evidence, concert-specific deadline, identity mapping, passive live hold
  monitor and reconciliation. Official guide screenshots are not DOM fixtures.
- Production reservation-ledger initialization/recovery/UI and lease integration
  for a released provider. Current controller does NOT attach this service.
- Cityline permission/release: level 2 remains restricted, host release remains
  disabled. Nothing here enables live Cityline automation.

The synthetic provider's `authorize:()=>true` is scoped to the offline rehearsal
driver, not a production permission grant. AI remains advisory and cannot mint
hold evidence or execute a live reservation. Do not present these tests as proof
that actual tickets can now be secured.
