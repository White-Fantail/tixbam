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

## Execution and payment guards

The run captures immutable preferences. Quantity, known adjacency, exact requested performance/mode/collection and the known final total including fees must match. Seat offers are ranked by price-tier preference, section preference, then floor preference; price breaks ties. Unknown totals/fees or adjacency do not satisfy a hard requirement. The final order ID, event, seats, quantity, currency and total are rechecked immediately before payment. Review is the default. Automatic mode requires explicit per-run consent for the selected event and total budget.

Payment is latched before the host service submits and is never automatically retried. If submission errors or the outcome is ambiguous, the terminal `payment_unknown` state directs the user to provider order history. A receipt is not accepted as this run's success unless a submission occurred and the confirmed order matches. CAPTCHA, login, queues and bank authentication pause for manual action; Resume is explicit and cannot restart terminal runs. Stop during in-flight operations clears preparation and prevents subsequent actions, but cannot undo an already submitted payment.

Run state remains in memory and is not resumed across app restarts. Before restarting an interrupted real purchase, check the provider's order history. No success guarantee or additional queue positions are implied.

## Validation

`npm test` covers schema validation, persistence without secrets, rankings and hard conditions, vault encryption/fail-closed behavior, CVV clearing/expiry, single submission, stale final totals, wrong events, unsupported payment profiles, in-flight cancellation, rehearsal handoff/confirmation and observed Cityline control mapping. The tests use synthetic cards and mock storage, not real cards or transactions. `npm run build:desktop` checks TypeScript and builds the renderer. Live bank/payment compatibility and platform secure-storage behavior still require checks on the target operating systems.

## Live Nation presale handoff

Live Nation is a Level 1 **Event / Presale** add-on. Official Live Nation FAQs confirm the actual ticket sale is transacted by the ticket agent designated for the specific show; that agent may require separate registration and sign-in. Level 2 and 3 are therefore shown as **Via agent**, not as verified automatic seat selection/checkout at Live Nation. No automated scraping or unverified agent inference is attempted.

In **Add-on Store**, choose the Live Nation region and open its official site. Sign in and open the show page. Copy the show's **official ticket-agent URL** (such as Cityline). In **Live windows** select **Ticket agent** beside the Live Nation window and paste that URL. TIXBAM verifies its HTTPS domain against installed official ticketing provider add-ons and launches it as a separate session. Unsupported ticket agents must be opened manually at their official site. Provider cookies, queue positions and authentication are never transferred. The handoff is not a verified automated checkout integration.
