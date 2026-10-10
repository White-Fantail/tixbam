# Offline Safety Stress Lab (AB-07)

## Purpose and safety boundary

The Stress Lab runs entirely inside TixBam's isolated rehearsal window. It **does not** open a ticketing website, send a network request, retrieve real inventory, charge a card or create a ticket. The simulated site is not an exact Cityline/Ticketmaster/NOL replica. The existing Cityline-specific walkthrough remains available in the same window.

## How to use

1. Create or select a Booking Plan with ticket quantity and a positive all-in budget.
2. Choose **Rehearse** to open the separate rehearsal window. Select **Safety Stress Lab**, not the provider-specific walkthrough.
3. Choose a scenario and an integer seed (0–999999). The same seed recreates the same synthetic seat layout and offer characteristics; every run has a distinct mock order/run ID.
4. Use **Next step** to read/select fictional options. Follow any synthetic manual handoff; review the mock order and choose **Confirm MOCK checkout** only at the final review.
5. For a successful synthetic receipt, use **Save completed practice** to update the Booking Plan rehearsal timestamp. For an unknown payment, acknowledge the no-retry rule before marking the *exercise* practised.
6. Use **Simulate app restart** to verify that the old run cannot be resumed. A new exercise is always separate from any real provider purchase.

## Fixed provider-neutral scenarios

| Scenario | Demonstrates | Safe expected outcome |
|---|---|---|
| Normal purchase | Fake selection, final order and receipt | Completed synthetic receipt |
| Waiting room | Queue before options | Manual handoff, then continue |
| Sold out | No available offer | Stop for user; no payment |
| Price changes | Total increases before commit | Final-order mismatch; no payment |
| Fees change | All-in fee changes before commit | Re-read mismatch; no payment |
| CAPTCHA | Required manual challenge | Never automated |
| Bank 3-D Secure | Bank challenge after mock submit | Manual verification, then synthetic receipt |
| Payment timeout | Mock payment reply lost | `payment_unknown`, no replay |
| Unknown charge | No verified payment outcome | `payment_unknown`, no replay |
| Crash and restart | Simulated lost result and restart | Read-only recovered unknown state |
| Standing admission | Unassigned mock places | Verified quantity, no real allocation |
| Automatic allocation | Synthetic assigned seats | Constrained order review |
| Seats separated | Nonadjacent fake seats | Reject when together is mandatory |
| Page changes | Selected fake inventory disappears | Fail safely before checkout |

## Architecture and persistence

- `apps/desktop/electron/booking/rehearsal-fixtures.cjs` defines the closed scenario allowlist.
- `apps/desktop/electron/booking/rehearsal-driver.cjs` uses the real `BookingRunner` state machine and AB-03's existing deterministic host-action preconditions over **synthetic** observations.
- Each synthetic commit passes through `PaymentAttemptLedger`, using an **independent rehearsal-only directory** under `userData/rehearsal-lab/<owner-hash>/<plan-id>/runs/<run-id>/booking-safety/`. This directory never shares the operational booking safety journal.
- A versioned `last-run.json` is written via fsync and atomic rename. After a process restart the saved record is always **read-only**: in-progress precommit work becomes stopped, and a committed-but-unverified mock payment becomes `payment_unknown`. A `BookingRunner` is never resurrected from storage.
- The renderer is sandboxed and receives only a small fixed-action IPC through `rehearsal-preload.cjs`. Providers or downloaded add-ons do not register arbitrary script callbacks. The Stress Lab hides OpenRouter advice and does not contact any provider or model.
- The mode switch, scenario summaries, controls and status descriptions support Korean and English, Korean by default.

## Important limitations

These are simulated conditions and amounts. Success in the Lab cannot prove real-site automation capability, provider authorization, seat availability, card authorization or actual purchase success. AB-08 will separately explore bounded AI proposals; AB-12–AB-14 must address provider approval, payment execution and official order reconciliation before any real autonomous checkout could be considered.
