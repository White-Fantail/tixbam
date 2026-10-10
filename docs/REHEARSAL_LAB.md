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

## Fixed provider-neutral scenarios (17)

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
| Restricted-view seats | View limitation requires explicit consent | No eligible offer with default preferences |
| Unverified fees | Missing verified fee components | No eligible offer |
| Unverified automatic seats | Group adjacency not confirmed by provider | No eligible offer when together is required |

## Architecture and persistence

- `apps/desktop/electron/booking/rehearsal-fixtures.cjs` defines the closed scenario allowlist.
- `apps/desktop/electron/booking/rehearsal-driver.cjs` uses the real `BookingRunner` state machine and AB-03's existing deterministic host-action preconditions over **synthetic** observations.
- Each synthetic commit passes through `PaymentAttemptLedger`, using an **independent rehearsal-only directory** under `userData/rehearsal-lab/<owner-hash>/<plan-id>/runs/<run-id>/booking-safety/`. This directory never shares the operational booking safety journal.
- A versioned `last-run.json` is written via fsync and atomic rename. After a process restart the saved record is always **read-only**: in-progress precommit work becomes stopped, and a committed-but-unverified mock payment becomes `payment_unknown`. A `BookingRunner` is never resurrected from storage.
- The renderer is sandboxed and receives only a small fixed-action IPC through `rehearsal-preload.cjs`. Providers or downloaded add-ons do not register arbitrary script callbacks. The Stress Lab hides OpenRouter advice and does not contact any provider or model.
- The mode switch, scenario summaries, controls and status descriptions support Korean and English, Korean by default.

## Important limitations

These are simulated conditions and amounts. Success in the Lab cannot prove real-site automation capability, provider authorization, seat availability, card authorization or actual purchase success. AB-08 will separately explore bounded AI proposals; AB-12–AB-14 must address provider approval, payment execution and official order reconciliation before any real autonomous checkout could be considered.

## AB-08 AI next-step proposal (optional)

Within an **active** Safety Stress Lab drill, click **AI 다음 단계 제안 보기 / Suggest a next step with AI**. This requires a signed-in TixBam account, the server-side OpenRouter key and Admin → AI Models → **PlannerV1** enabled with the **strict structured-output verified** checkbox selected.

The model gets only a privacy-restricted observation (stage, challenge type, confidence, option counts and temporary anonymous target tokens). A human-readable booking page, email, account/Run ID, seats, prices and card/3DS fields are not transmitted. The suggestion is shown as a **read-only recommendation**, not a click or payment. Follow only the original simulator buttons to advance.

For blocked/malformed/unsupported models, failed authentication, timeout, stale snapshots, sign-out or changed Admin policy, the UI displays a non-executing **ASK_USER** fallback. Each call consumes planner quota even if the model fails: at most 8 per synthetic run and 20 per user hourly, plus the shared AI hourly limit. The feature stays disabled until intentionally configured. Real-provider observations cannot invoke this planner endpoint.

## AB-09 One-step recovery execution

With **Safety Stress Lab** running and Admin-enabled PlannerV1 configured, click **Suggest a next step with AI** as before. If the model suggests `REOBSERVE` or `SELECT_APPROVED_OFFER`, you will see a **second approval button** to execute **ONE approved mock recovery step**. This never authorizes the model to issue further commands by itself. Approving it does not approve payment.

- `REOBSERVE` reads the in-memory synthetic page state without navigation, remote requests or provider reload.
- `SELECT_APPROVED_OFFER` is implemented exclusively by AB-07 `ScenarioAdapter`, with an AB-03 host-issued target ref, fresh observed inventory and price, quantity/currency/adjacency/budget checks, and a verified synthetic postcondition. A successful offer selection only reaches the mock order review. **Mock payment still needs a separate human confirmation.**
- `WAIT`, `ASK_USER`, `STOP` remain recommendations; neither STOP nor a site queue is automatically manipulated. No handler exists for `RETURN_TO_VERIFIED_STEP`, arbitrary navigation, scripts, checkout, login, CAPTCHA or 3DS.
- A snapshot/run change, expired token, different account/window, interrupted rehearsal, mutated inventory, unsupported provider or failed postcondition causes the host to refuse the action and show manual takeover. The one-use proposal cannot be replayed.
- At most 3 attempted one-step approvals, 2 failures, and 1 synthetic offer mutation per rehearsal run; identical steps are blocked. Each step has a 2s deadline and cooperative cancellation in the simulator. A timeout or postcondition failure locks further AI recovery for that run.

The host's approval action is exposed only by a sender-verified Electron main-process IPC. No action callback, arbitrary URL, JavaScript or selector becomes accessible to downloaded add-ons or AI. This exercise offers no guarantee about live-site capability, ticket inventory or payment success.

## AB-10 seat and all-in price policy exercises

All synthetic rehearsal offers use an explicit `schemaVersion:2` data model with ticket subtotal, service fee, tax, delivery charge, optional extras, restrictions, assignment evidence and a verified total. This does not mean real Cityline seat or payment support has been confirmed.

Run a normal, standing or automatic-seating drill to review a fully validated mock offer. The **restricted-view**, **unknown-fees** and **auto-unverified** drills stop before cart/payment, because the current practice plan has not approved those risks or lacks evidence. The original price/fee-change drills still reject a changed final quote during checkout.

The host ranks only *eligible* candidates. It uses ordered price tier, section and floor preferences before the cheapest all-in total, then a stable ID tie-break. The preference fallback flag is never bypassed by AI. Standing group admission uses an explicitly identified GA area rather than requiring numbered adjacent seats; assigned seats require exact seat references; automatically assigned seats require verified allocation and exact final seats before a payment could be contemplated.

Consent for risky visibility, identity/age/accessibility requirements and optional extras must be explicitly provided in the host booking plan. Those permissions default to false and are not inferred from model advice or provider page labels. The extra consent UI is an AB-11 follow-up.

## AB-11 explicit review before mock checkout

In the separate Safety Stress Lab window, the final synthetic order review now requires an unchecked confirmation of ticket quantity and all-in amount. The **Approve reviewed MOCK order** button remains disabled until the user marks this checkbox. Advancing or restarting a drill resets the approval state.

The main Desktop Booking Plan also supports optional per-seat priorities (price tier, section, floor), designated standing/assigned/automatic allocation modes, and **unchecked** restricted-view/real-name/age/accessibility and extras consents. Those values are stored for later verified booking contexts, not inferred from model output. The Stress Lab still uses isolated synthetic seller/fee fixtures; its results are not provider seat availability or proof of payment.
