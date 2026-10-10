# Booking preferences and local payment preparation

## Try it

1. Start the desktop app (`npm run dev`). Add a Cityline event to **My events**.
2. Open the event in its provider window, manually sign in and open the booking form.
3. In **My events → Booking preferences & automation**, choose that window and select **Read event options**. Check the provider's event title and ID shown in the panel.
4. Select the performance and rank price tiers. Set quantity, adjacency, total budget including fees, acceptable sections/floors, seat mode and collection requirements. Empty optional fields impose no requirement. With fallback disabled, only the first ranked choice is accepted. With fallback enabled, only explicitly listed alternatives are eligible.
5. Save preferences locally or start booking. **Live windows → Booking runs** supports resume and stop after the settings panel is closed.
6. **Try rehearsal** uses simulated inventory and checkout. It does not access saved cards, contact Cityline or make a charge. It exercises seat reservation, final review (or automatic mode), a simulated bank verification handoff and confirmation. Actual and rehearsal preferences use different keys.

## What works on live Cityline

The bundled `cityline-event-detail-v1` adapter reads and selects the observed `button.date-time-position[data-perf-id]`, `button.price-btn` and `button.purchase-btn` controls on Cityline's `/utsvInternet/internet/eventDetail` page. The performance ID and displayed price are discovered per event, not hard-coded. This was observed on the public Swan Lake event form on 8 October 2026. Re-reading options rejects removed choices.

**Live seat selection and payment entry/submission are not implemented yet.** The public booking flow leads to login, and no signed-in seat or payment screen was available to verify. These pages pause with a user-action message rather than guessed selectors. Provider authorization remains unverified; the existing published restriction metadata for other providers remains intact. No CAPTCHA, queue or bank authentication bypass is implemented. Unknown layouts are handed to the user without repeated clicking or queue refreshes.

To complete the Cityline integration, inspect representative signed-in assigned-seat, automatic-allocation and standing pages; implement verified offer/reservation/receipt extraction; and add a host-owned payment profile for the exact payment origins and frame structure. Validate on a sandbox or controlled non-charging workflow before declaring live payment supported. The current production controller supplies no payment service to the Cityline runner, so changing capability metadata alone cannot enable payment.

## Contracts and ownership

`packages/addon-sdk/index.d.ts` defines `BookingSchema`, dynamic choice fields, ordered preferences, immutable order snapshots, contexts and run states. Providers can define a different schema; this release enables Cityline only. The schema is bundled locally and does not execute downloaded add-on code. The server remains a public events/version service and receives no booking preferences or payment preparation. The server's existing registry schema is unchanged.

An add-on describes options and observes/selects its provider workflow. Card data is kept in Electron's main process and is supplied only to a separate **host-owned payment service**, never the add-on adapter or renderer bridge. Only the dashboard main frame can invoke the booking/vault IPC. Remote provider windows have no preload or privileged bridge. Host allowlists and event IDs are checked both before script dispatch and inside dispatched scripts to address navigation races. Scripts contain preference values, never payment secrets.

Actual preferences are keyed by the provider's event ID so multiple saved links to the same event cannot create independent active purchases. A window can have only one active real run. Contexts are invalidated on window closure. Preferences are reconstructed from allowlisted fields before persistence; unknown properties and secrets are discarded.

## Card storage

**Settings → Local payment cards** saves number, expiry, name and nickname to `cards.enc` in Electron `userData`. The entire file is encrypted with Electron `safeStorage`, using the operating system's available secure storage. There is no key stored beside the file. Storage fails closed if encryption is unavailable or Linux falls back to `basic_text`. Only nickname, last four digits and expiry are returned by list IPC; full card data is not returned by the vault. These files are device-local and are not sent to the TIXBAM API.

CVV is never persisted. It is entered once when preparing a run and kept with the unlocked card in temporary main-process buffers for up to 30 minutes. Buffers are overwritten on completion, stop, failure, unknown payment outcome, expiry, window closure, dashboard closure and application quit. JavaScript, Chromium and operating-system memory copies cannot be guaranteed to be physically erased; buffer clearing is not a guarantee against a compromised device, crash dumps or forensic memory recovery. `safeStorage` does not promise a fresh biometric prompt on each use; clicking Start is the app's explicit per-run permission to unlock/use the selected card.

Actual card details are unnecessary for rehearsal. This release's live Cityline payment service is unavailable, even if a card has been prepared.

## AB-07 — Provider-neutral Offline Safety Stress Lab

Use **Booking Plan → Rehearse** to open the isolated rehearsal window. Choose **Safety Stress Lab** to practise scenarios with a deterministic seed, or keep the existing **Cityline walkthrough** to rehearse a more detailed mock user journey. The Stress Lab is available regardless of provider; it does not claim real provider capability.

The common host-only `RehearsalDriver` runs the existing `BookingRunner` and finite state machine over synthetic options, seat offers, all-in prices, a one-shot mock payment and a separately scoped mock AB-05 Journal. Available drills include queues, sold-out tickets, fees/price drift, CAPTCHA, bank 3-D Secure, timeout, unverified charge, process restart, standing tickets, automatic allocation, nonadjacent seats and stale inventory. User intervention for CAPTCHA, queues and 3DS is a separate button, not an AI bypass.

The rehearsal window receives a strict, sender-verified IPC for approved mock actions only; no browser URL, network fetch, card, provider cookies, JavaScript or real payment operation is exposed. Live AI advice is not offered inside the Stress Lab. Synthetic journals and the small last-run snapshot live under Electron `userData/rehearsal-lab/`, entirely isolated from live payment safety history. Snapshots are versioned and fsynced; after a restart **no old runner or payment execution authority is restored**. A synthetic unresolved commit is reported as `payment_unknown` and cannot be resumed. Beginning a new fictional practice run does not authorize replay of any real purchase.

Once a synthetic receipt is confirmed, or after explicitly acknowledging an unknown outcome in the practice UI, the user can record the rehearsal through the existing Booking Plan completion workflow. Results are exercises and must not be interpreted as provider ticket issuance, real seat availability or an actual card charge. See [Rehearsal Lab guide](REHEARSAL_LAB.md).
## AB-06 Multi-window and multi-device coordination

Live automated selection requires a host-owned window, current signed-in account, registered Booking Plan, verified sale/performance and an authenticated server lease. The host reserves local execution ownership before asynchronous acquisition, prevents other windows from using the same run target, and periodically renews a 45-second lease. Invalid identity, remote outage, stale fencing, failure to renew, and changed browser ownership abort automation without closing the official queue/login browser window. Rehearsals remain offline.

The API has a unique user/provider/sale/performance lease with monotonically increasing fencing token. Expired **pre-commit** leases can be taken over only via conditional database updates. A server-side claim is permanent even after lease expiry or crash. Every live purchase commit would require acknowledgement of this cloud claim followed by the AB-05 fsynced local journal before any actual payment call. A claim request with an unknown outcome, a Stop while the request is pending, or a local journal failure after claim is reported as terminal `payment_unknown`, never as a safely retryable pre-payment failure. The cloud lease is a coordination mechanism, not permission to buy; actual live autonomous purchasing remains disabled. Official order reconciliation belongs to AB-14.

Different TixBam user accounts and manual provider-site purchases cannot be deduplicated by this mechanism. No cards, CVV, provider browser sessions or full order details are synchronized.
## AB-05 Durable Booking Journal and purchase safety

The Electron main process owns `booking/journal.cjs` and `booking/payment-attempts.cjs`, creating an append-only v1 Journal under the application's local userData `booking-safety/` directory. Every real payment attempt is required to write an exclusive, fsynced `COMMIT_INTENT_RECORDED` before a payment executor is called. The journal stores a sequential integrity hash chain and HMAC digests of allowed purchase data; no payment card, CVV, OTP, raw personal information, seat/order links or provider cookies are written. On POSIX systems the local journal uses 0700 directory / 0600 files.

The host blocks any repeated attempt for the same account, provider, actual sale/event and performance, including attempts with a different plan, ticket quantity or budget. A commit may have preceded a crash without a payment request actually reaching the merchant, but it must still be treated as **payment_unknown**, not automatically retried. Submission-returned does not prove success. A restarted Desktop exposes unresolved attempts through the normal read-only Booking Runs list; corrupt or unavailable Journal state is surfaced as a payment safety warning, not interpreted as empty history. Synthetic rehearsals remain charge-free.

A Journal lock left behind after a crash is deliberately not silently removed; fsync failures, torn files, wrong permissions, key/log deletion or exhausted bounded storage refuse new auto-submissions. Do not manually delete the journal or lock merely to retry. First verify the official ticket agent's order and payment history and follow a separately reviewed reconciliation procedure. **This only covers one local Desktop storage instance**; multi-device coordination is AB-06 and independent official receipt verification is AB-14. Neither live auto-payment nor provider consent has been enabled.

## AB-04 Observation Pipeline — read-only

Electron's trusted main process owns `booking/observation.cjs` and `observation-redaction.cjs`. They normalize verified provider pages into bounded `HostObservationV1`, including the current event/window/run binding, stage and challenge enum, short-lived opaque handles and provenance. Host snapshots never authorize payments. The separately generated `AIObservationV1` contains only stage, challenge, confidence, option counts and task-local random tokens; there are no personal details, booking IDs, browser identifiers, vendor event IDs, URLs, form values, raw DOM, order receipts or screenshots.

Cityline is the first bundled read-only live profile. Its observed eventDetail buttons are capped at 30 choices per category, and sign-in, CAPTCHA, queue and bank handoffs remain entirely user-managed. The legacy `BookingRunner` read flow records observations without additional network round trips; the existing deterministic selections still use the host-owned adapter and AB-03 guards. No new live AI browser execution or payment is enabled.

Navigation, in-page navigation, frame navigation and renderer termination invalidate run snapshots and task tokens. A subsequent read with changed option data detects same-document changes and invalidates the previous observation. Authenticated account change or sign-out removes all observation watches. Every issued observation supersedes its run's previous snapshot, and timestamps enforce short expiry. This is not a realtime DOM MutationObserver: an unobserved in-page mutation is detected on the next read, and any future action must still re-observe and revalidate before execution.

These projections are **not sent** to OpenRouter by AB-04. Live data-sharing requires separate provider permission and a later policy-controlled AI planner (AB-08); the demo projection is available only by explicit test/rehearsal gating. Unknown site profiles, third-party popups, unverified seat maps and checkout are not observed as verified actions.

## AB-03 Host Action Contracts and Validator

Electron main-process modules `booking/action-validator.cjs` and `booking/action-registry.cjs` provide the bounded proposal-only contract in `packages/addon-sdk/index.d.ts`. The trusted host issues short-lived opaque target references; an AI or add-on cannot submit a selector, URL, JavaScript, payment action or arbitrary instruction.

The validator binds each proposal to the exact run, window, user/account, plan, provider, event, page generation, FSM revision and permission revision. It checks consent and purchase quantity, currency, all-in price including fees, seat availability, action expiry and one-shot replay protections. The host re-observes a selected offer before executing and verifies the resulting order. No arbitrary add-on callback may be registered.

Passive actions (WAIT, REOBSERVE, ASK_USER, STOP) return recommendations only, without browser mutations or automatic cancellation. The initial mutating executor operates only on the synthetic `RehearsalAdapter` offer; **all live AI/add-on mutations remain disabled**. Existing host-driven Cityline selection is retained with added stage/event/offer preconditions; this is not newly authorized provider automation. AB-04 will provide sanitized observations, AB-08 AI planning, and AB-09 controlled recovery. No real card payment is implemented by AB-03.

## Execution and payment guards

As of AB-02, `booking/state-machine.cjs` and `booking/orchestrator.cjs`
are the in-process source of truth for an explicit provider-neutral finite-state
machine. `BookingRunner` preserves legacy status strings for the existing
Desktop/Cityline rehearsal, while providing read-only informational `phase`,
`revision`, and step `generation` fields. Every state transition is
run-bound, revision-checked and authorized by the host's event transition table.
The host ignores timer overlap and post-cancellation async completions; browser
ownership is rechecked before meaningful actions. Cancel/Stop after a payment
attempt moves to `payment_unknown` rather than pretending the purchase was
undone. Payment confirmation cannot be smuggled into a manual challenge
Resume call. Duplicate cleanup of the ephemeral card preparation is avoided.

This FSM is **in memory only**: AB-05 must introduce a durable write-ahead
payment journal before crash/restart safety or an authorized real payment
executor can be claimed. No real Cityline seat/checkout integration or vendor
permission is added by AB-02. Because page-side effects may already have occurred
before an AbortSignal is received, cancellation prevents further host actions
but does not guarantee reversing a clicked remote site control.


The run captures immutable preferences. Quantity, known adjacency, exact requested performance/mode/collection and the known final total including fees must match. Seat offers are ranked by price-tier preference, section preference, then floor preference; price breaks ties. Unknown totals/fees or adjacency do not satisfy a hard requirement. The final order ID, event, seats, quantity, currency and total are rechecked immediately before payment. Review is the default. Automatic mode requires explicit per-run consent for the selected event and total budget.

Payment is latched before the host service submits and is never automatically retried. If submission errors or the outcome is ambiguous, the terminal `payment_unknown` state directs the user to provider order history. A receipt is not accepted as this run's success unless a submission occurred and the confirmed order matches. CAPTCHA, login, queues and bank authentication pause for manual action; Resume is explicit and cannot restart terminal runs. Stop during in-flight operations clears preparation and prevents subsequent actions, but cannot undo an already submitted payment.

Run state remains in memory and is not resumed across app restarts. Before restarting an interrupted real purchase, check the provider's order history. No success guarantee or additional queue positions are implied.

## Validation

`npm test` covers schema validation, persistence without secrets, rankings and hard conditions, vault encryption/fail-closed behavior, CVV clearing/expiry, single submission, stale final totals, wrong events, unsupported payment profiles, in-flight cancellation, rehearsal handoff/confirmation and observed Cityline control mapping. The tests use synthetic cards and mock storage, not real cards or transactions. `npm run build:desktop` checks TypeScript and builds the renderer. Live bank/payment compatibility and platform secure-storage behavior still require checks on the target operating systems.

## Live Nation presale handoff

Live Nation is a Level 1 **Event / Presale** add-on. Official Live Nation FAQs confirm the actual ticket sale is transacted by the ticket agent designated for the specific show; that agent may require separate registration and sign-in. Level 2 and 3 are therefore shown as **Via agent**, not as verified automatic seat selection/checkout at Live Nation. No automated scraping or unverified agent inference is attempted.

In **Add-on Store**, choose the Live Nation region and open its official site. Sign in and open the show page. Copy the show's **official ticket-agent URL** (such as Cityline). In **Live windows** select **Ticket agent** beside the Live Nation window and paste that URL. TIXBAM verifies its HTTPS domain against installed official ticketing provider add-ons and launches it as a separate session. Unsupported ticket agents must be opened manually at their official site. Provider cookies, queue positions and authentication are never transferred. The handoff is not a verified automated checkout integration.

## AB-08 read-only AI Planner

The provider-neutral Safety Stress Lab offers a **user-clicked next-step suggestion** powered by Admin-enabled OpenRouter PlannerV1. The Electron host reads a synthetic observation, produces AB-04's privacy-projected `AIObservationV1`, and sends it through the authenticated API. Model output is strict structured JSON; the host verifies the AB-03 action shape and resolves ephemeral task target tokens locally. No provider page or payment changes occur. The planner is never invoked by real ticketing runs or automatically by the simulator. Model errors and stale results degrade to a manual `ASK_USER` recommendation.

Configure Admin → AI Models → PlannerV1 model ID, strict structured-output verification and enable flag after confirming the model/provider supports JSON Schema output. Leave disabled for ordinary users until tested. Unlike the advisory guidance endpoint, PlannerV1 requires exactly the AB-04 no-text observation and a dedicated per-run quota. See [AI architecture](AI_ARCHITECTURE.md).

## AB-09 bounded rehearsal AI recovery

Safety Stress Lab displays a second explicit **Execute ONE approved mock recovery step** control only for valid `REOBSERVE` or `SELECT_APPROVED_OFFER` model suggestions. The Electron host consumes the model proposal once, checks the current AB-04 snapshot and AB-03 action/consent, confirms quantity, adjacency and fees, and performs only an offline synthetic observation or mock seat selection. Each is verified afterward; failure, timeout or changed state requires manual takeover. Queue, CAPTCHA, 3DS, real browser navigation and payment remain human-only. Per run: 3 attempts, 2 failures, 1 mutating mock offer, 2-second deadline. See [Rehearsal Lab guide](REHEARSAL_LAB.md).

## AB-10 Seat/Offer Policy Engine

The host `offer-policy.cjs` normalizes legacy v1 and strict v2 seat offers across providers. Strict v2 offers must include reconciled `ticketSubtotalMinor + serviceFeeMinor + taxMinor + deliveryFeeMinor + extrasMinor === totalMinor`, verified availability/identity, and explicit risk flags. Price/currency are safe integer minor units with no implied exchange conversion.

Before ranking, the host excludes incompatible event/provider/performance, quantity, budget, currency, mode, seat adjacency, unresolved automatic allocation, mandatory consent, restricted view and unapproved optional extras. Remaining offers are ranked deterministically by explicitly ordered price tier, section and floor before all-in amount. Final order verification compares the entire canonical purchase fingerprint, rejecting new fees, extras, seats, mode or seller even if the headline total is unchanged.

`chooseOffer` and `validOrder` still accept existing v1 Cityline/BookingRunner inputs, but the new verified rehearsal simulator uses strict v2 evidence. This does not enable live provider seat mapping, official cart mutation or autonomous payment. See [Rehearsal Lab guide](REHEARSAL_LAB.md).
