# NOL ticket acquisition validation — incremental implementation plan

> Branch: `dev`. Scope: NOL (`nol`) first, not Cityline. **Objective:** minimize user work and reach a provider-confirmed, one-ticket eligible booking outcome. A click, checkout URL, or visual seat marker is **not proof of a held ticket**.

## Verified inputs and non-assumptions

- Bundled `nol` addon currently recognizes `world.nol.com` and `nol.yanolja.com`; automation level 2/3 is **restricted**, with no audited live provider executor.
- Official NOL guidance describes a booking journey that can include date/time, section/seat, then price/quantity selection; shows an "already selected seat" race, and cautions that an earlier selection may be lost before payment.
  - https://ticketimage.interpark.com/TicketImage/2016/20160530_detailMo/loadingHtml/howToPreorder_nol.html
  - https://help.interpark.com/ticket/faq?article=1928&category=TICKET_TICKET&categoryDetail=TICKET_TICKET_02
  - https://help.interpark.com/ticket
- NOL's public customer support describes restrictions on nonstandard macro booking. A developer CLI flag is **not** vendor authorization. Real website experiments must honor the provider's terms and protection boundaries; prefer authorized test access and consented manual walkthroughs. No queue/CAPTCHA/identity/OTP bypass, automated payment, or aggressive inventory polling.
- **Unknown until a verified real trace:** current event page and seat selection HTML/SPA routes, popup lifecycle, exact quantities/price labels, ticket-hold representation, and which NOL variants support which steps. Do not invent selectors or claim a hold from a URL.

## Success contract (one ticket first)

1. The correct event, performance, account, and allowed total KRW budget have been selected.
2. Exactly **one** ticket satisfies the hard requirements, or the run reports **no verified ticket**.
3. The official provider's own confirmation/hold evidence is verified without capturing sensitive payment credentials. Selection alone is **not a hold**. On an ambiguous checkout/cart screen, status remains `hold_unverified`.
4. If a human step is needed (login, waiting room, queue, identity challenge, CAPTCHA, restricted admission, payment), stop safely; preserve that exact browser and allow explicit resume.
5. Never retry an action that might have committed a hold/order without checking the official result.

## Architecture: provider-specific reasoning, provider-neutral safety

- `electron/copilot/nol-flow.cjs`: **pure, read-only NOL step assessment**, accepts normalized structured hints and official browser URL; returns stage + evidence/confidence + whether user verification is required. No DOM scraping, injected scripts, or side effects. Hints are **not action authorization**.
- `electron/copilot/host.cjs`: common safety/runtime owner. It can attach the NOL assessment to an in-memory Copilot session and expose it in UI; no visual hint alone turns a preparation page into selection or claims a reservation.
- Copilot AI API: supplies `screenStage` and `stageConfidence`, both fallible. Future NOL-specific stage/substage fields must be backed by actual annotated examples before enabling actions.
- **Future NOL adapter:** deterministic stage transitions, candidate ranking, action outcomes, and provider-confirmed reservation evidence. It must use verified allowed provider interfaces if available; otherwise keep NOL in visual guidance/human mode.
- **Evidence contract:** `unverified | selected_unverified | hold_verified | expired | purchase_verified`. Only verified provider evidence, never AI assertions, can enter the final two success states.

## Delivery milestones (complete each gate before next)

### NOL-01 — Read-only stage assessment + replay fixtures — first increment
- Build fail-closed stage evaluator: `event_detail`, `selection_unknown`, `human_gate`, `checkout_unverified`, `unknown`.
- Recognize sensitive paths independently of the model. AI confidence is a hint, not trust. Return `holdVerified:false` under every read-only outcome.
- Attach stage hint to session UI, retain no screenshot/image or personal information in the diagnostic record.
- Offline tests: trusted NOL host, unknown host, contradictory vision, queue/auth/checkout, stale or low-confidence hint, fake hold claims, no false `hold_verified`.
- Acceptance: pure-model tests and no change to real click permission.

### NOL-02 — Actual NOL screen taxonomy (non-sensitive)
- Collect user-consented sanitized, **offline** reference images or allowed manual descriptions from at least: event detail, performance/date, seat map, price/quantity, availability conflict, cart/review.
- Build an annotated screenshot fixture matrix with expected step and confidence; explicitly catalog variant unknowns.
- Add deterministic `screenStep` from NOL-compatible visual analysis for the fixture set, with uncertainty fallback. Avoid storing captured live screenshots or credentials.
- Acceptance: 100% sensitive screen refusal on fixture set, no false verified hold and measured recognition rates.

### NOL-03 — One-ticket-first decision strategy
- Hard constraints: `quantity=1`, exact performance unless user authorizes fallback, maximum all-in KRW budget and provider eligibility.
- Soft preferences: venue section/floor/price ranking; prefer quickest eligible acquisition path, not ideal view. Record why a fallback was chosen.
- Detect seat-not-available / already-selected / wrong quantity / price change; choose another eligible candidate *only when explicitly permitted* and within bounds. No blind retry, repeated network polling or excessive sessions.
- Acceptance: offline deterministic scenarios cover sold-out, budget mismatch, conflict, fallback and user handoff.

### NOL-04 — Controlled action adapter and outcome verification
- Implement only verified permitted NOL actions, with `observe → propose → validate → act → verify` per step. Action submission is not considered successful until a separate result is seen.
- Popup/SPA handoff, timeouts, duplicate prevention, event/plan binding, stale images, and graceful human takeover.
- Implement hold-evidence adapter; if official hold evidence is unavailable, return `hold_unverified` and request user inspection.
- Acceptance: end-to-end mock site with realistic timing and failures; provider approval or permitted test environment before applying unattended interaction to real NOL.

### NOL-05 — Instrumented validation / release gate
- End-to-end test in consented **authorized** NOL environment, or read-only/manual captures if no approved automated test access.
- Metrics: event admission → step time, wrong-target rate, stale rejection, seat conflict recovery, safe pauses, queue continuity, confirmation accuracy. No claims of improved acquisition rates until measured.
- Release only when provider terms/integration permission, security review and E2E tests are satisfied; dev diagnostic never widens packaged-app permissions.

## First increment usage / boundaries

The NOL-01 stage assessment appears alongside advance Copilot status when a NOL browser has been observed. It does **not** detect an actual seat hold, expose secrets, perform extra clicking, or alter account/queue/payment handling. A `checkout_unverified` stage means *inspect the official provider page*, not *one ticket secured*. For ambiguous states, choose `unknown` or `human_gate`.

## Follow-up artifacts for NOL-02

Obtain **sanitized** manually provided screenshots or official non-sensitive mockups at each stage, without QR codes, account identifiers, payment details, tokens or CAPTCHA solutions. Record variant, URL host (not query/credentials), stage, visible controls, known outcomes and whether a popup appears. Never treat screenshots as proof of booking authorization.


## NOL-01 implementation log (2026-10-11)

- Added `apps/desktop/electron/copilot/nol-flow.cjs`: pure stage assessment, exact NOL host validation, fail-closed sensitive route/phase handling, confidence threshold `0.97`; `holdVerified` is **always false**.
- Connected the existing Copilot Vision API's optional `screenStage` / `stageConfidence` hints to the **read-only** NOL session diagnostics. A contradictory or clearly sensitive stage pauses execution; no visual hint alone grants click authority or changes provider policy.
- Desktop session panel now shows **NOL 화면 진단** (event detail, selection substep unknown, user-required, checkout hold unverified, unknown).
- Added pure unit tests and simulated Copilot integration cases. Shared `core.cjs` now blocks **cart** routes before screenshot capture/upload, in addition to checkout/payment and authentication routes.
- Validation completed so far: JavaScript syntax checks, 6 NOL pure unit scenarios in an isolated JS harness, additional simulated live Copilot transitions for event, phase mismatch, queue, checkout, and an explicit cart pre-capture block. Full native Electron/TypeScript CI and genuine NOL ticketing E2E **not yet run**.

### Read-only manual verification before NOL-02

1. Start the desktop app: `npm run dev:copilot` from the repository root.
2. Open a NOL Booking Plan → **코파일럿 사전 승인** → **이 공연만 별도 설정**. Choose **자동 화면 인식 및 버튼 안내**, allow screenshot sharing, and **turn off 개발자 클릭 진단** for read-only exploration.
3. Open the official event page and navigate manually as appropriate. In **진행 중인 예매**, watch the **NOL 화면 진단** line. If the model isn't enabled or the backend hasn't deployed `screenStage`, results can remain **화면 단계 미확인**.
4. When a user-only step or a protected route is encountered, the helper stops or waits; it does not capture a CAPTCHA, OTP, checkout or payment page under the protected route rules. Some SPA challenges may share non-sensitive URLs, so **mark login/queue manually and avoid screenshot consent in those states** until stage protection is verified against real fixtures.
5. For NOL-02, supply only redacted **non-sensitive** screenshot examples or descriptions of steps. Log what the NOL UI actually displayed, whether the URL host changed, and whether a linked popup appeared. Never share login tokens, account information, CAPTCHA or payment pages.

**Important:** The development click executor still exists as a separate, explicit experiment, but NOL-01 does not require it and makes no claim that live-site automation is allowed by NOL.


## NOL-02 implementation log (2026-10-11)

**Implemented on `dev`:**

- `electron/copilot/nol-taxonomy.cjs` adds nine **read-only** diagnostic substeps: `event_detail`, `performance_date`, `seat_map`, `price_quantity`, `seat_conflict`, `sold_out`, `cart_review`, `human_gate`, `unknown`. The result has no hold/purchase authority.
- Copilot Vision schema/prompt can return `nolScreenStep` and `nolStepConfidence` for NOL only. A result is accepted when both the broad stage and NOL substep claim confidence **>= 0.97** and the stage pair is consistent; contradictory/low-confidence hints become `unknown`. This is **model-reported confidence, not a measured probability of correct recognition**.
- On a recognized `seat_conflict` or `sold_out` result, Copilot pauses and requires user inspection; `human_gate` also pauses and `cart_review` reports `hold_unverified`. The API suppresses action targets on these cases. This does not turn any restricted NOL automation into approved production functionality.
- Desktop **NOL 화면 진단** displays the substep (Korean/English) and unverified-hold message. Older API versions remain supported with an unknown substep.
- `electron/copilot/fixtures/nol-step-cases.json` contains **18 synthetic metadata scenarios with documentation provenance and no images**. These are not actual NOL screenshots; they test consistency, contradiction and security fallbacks rather than real visual-recognition accuracy.
- Added `electron/copilot.nol-taxonomy.test.cjs`, API validation unit tests and integration test cases in `electron/copilot.integration.test.cjs`. Isolated JS validation ran 11 test groups / 284 assertions (NOL-01+02 pure classification) successfully; full native Electron/TypeScript/Python test suites have **not yet been executed** on a checked-out repository.

**Official and third-party reference guides:** [NOL ticket booking guide](https://ticketimage.interpark.com/TicketImage/2016/20160530_detailMo/loadingHtml/howToPreorder_nol.html) and [2026 NOL World booking screen guide](https://gayon-korea.com/interpark-ticketing/). These document broad flows but **do not verify** the active NOL World UI, popup URLs, screenshot selectors or specific event variants today.

**NOL-02 acceptance still pending:** real user-consented, redacted, non-sensitive screenshot fixtures from each major NOL variant. Once collected, label expected substeps independently, run a fixed vision model/configuration, and report confusion matrix, per-stage recall/precision and false-stop rate. Actual recognition accuracy remains **unmeasured**, and NOL-03 should not interpret synthetic fixture matches as live-readiness.

### Instructions for next real read-only observation

Run `npm run dev:copilot`. In a NOL plan enable advance **observe/visual guidance** with explicit screenshot consent, but disable the local developer-click diagnostic while collecting examples. On an ordinary (non-sensitive) date-selection or seat-selection screen, note whether the NOL screen diagnostic matches your visual observation. Do not capture or submit an account profile, passport, CAPTCHA, queue challenge, payment screen, reservation QR code or checkout details. Close/stop screenshot sharing before navigating to sensitive content, especially on single-page apps where the URL may not change.

**Deployment:** the NOL-02 server-side step fields require deploying the updated TixBam API and enabling the `copilot_vision` task. The UI still works with older API responses, but then the fine-grained substep is unknown.


## NOL-03 implementation log (2026-10-11)

**Goal:** choose a viable **single** NOL ticket before optimizing the view, respecting the hard total budget and only using explicitly approved fallback preferences. This phase makes a decision-support engine; it does **not** claim an officially reserved seat.

### Implemented

- `electron/copilot/nol-strategy.cjs` now normalizes an approved one-ticket plan, checks exactly `quantity=1`, `currency=KRW`, and a positive all-in budget; checks any known performance ID, ticket count, currency and visual pricing; rejects visually unavailable offers or amounts already above budget.
- Preference order is deterministic: listed **price tier**, **section** and **floor**, then seat mode; the first listed value is preferred. Unknown metadata is penalized rather than treated as a match. Fallback only applies to seat tier/section/floor/mode when `allowFallback=true`; it never silently changes the approved performance ID or quantity.
- `App.tsx` now passes a **plan-scoped** NOL strategy snapshot to the existing advance-approved browser session. The main Electron host cross-checks its quantity, budget and currency against the approved booking conditions, and freezes the preference snapshot for the session. Non-NOL providers are unchanged.
- Copilot Vision supports optional bounded **visual offer hints** (`priceTier`, `section`, `floor`, `seatMode`, `quantity`, `performanceId`, `currency`, `allInTotalMinor`, `feesIncluded`, `availability`) for NOL. The backend validates types, cost bounds, control characters and unknown fields. Only explicitly visible fields may be returned. These hints are **model interpretations**, not official offer evidence.
- Live Copilot ranks up to five approved visible candidates, displays up to three with fallback reason and strictly provisional KRW cost, and shows a separate next-step suggestion for seat conflict/sold-out situations. It does not repeatedly click the same failed target or bypass login/queue/security screens.
- **Safety decision:** on NOL plans using the new strategy, the selecting stage stays at `awaiting_user`. Even when the screen looks like one eligible R-section ticket within budget, no automated provider selection is authorized from an AI visual guess alone. Unattended NOL selection belongs to **NOL-04**, after an independent provider-approved outcome/offer adapter can verify total fees, price and performance. Event-entry buttons remain separately governed by previously approved generic controls.
- Explicit conflict recovery requires human review: `REOBSERVE_WITH_USER` only if fallback is enabled and no possibly committed cart/hold action is pending; after two attempts or any potential cart/hold action, the recommendation is `ASK_USER`. No blind inventory refresh loops or order retries.

### Acceptance evidence

- `electron/copilot.nol-strategy.test.cjs` covers 1-ticket/KRW prerequisite, budget exceedance (even before fees), exact performance identity, unknown fees/amount, strict vs fallback sections, sorted preferred seats, collision handling, no visual claim of official authority.
- `electron/copilot.integration.test.cjs` tests the plan being attached to the Copilot session, bounded preferences sent to Vision, ranked displayed alternatives, zero native input on unverified NOL selection, rejected forged plan quantities/budgets, and manual-only conflict recovery.
- Offline pure-strategy tests: **9/9 passed** using an isolated JS harness. Additional mocked browser/Copilot scenarios: **2/2 passed** (rank and conflict), with zero automatic selection events. These are not real NOL E2E runs. TypeScript build and full Node/Python suites still need a checked-out environment or CI run.

### Constraints before NOL-04

The official NOL site still marks unauthorized automation as restricted, and no audited native reservation API/seat-hold evidence exists in the bundled addon. Before any live automation release, obtain authorized test access and record **non-sensitive** official evidence for seat selection, all-in price, exact performance, seat conflict and held-cart expiry. Until then, user actions and the official page remain the final source of truth.

**Manual exploration:** set a NOL Booking Plan to **one ticket**, **KRW**, **maximum all-in budget**, and optionally ranked seat tiers/sections. Specify whether fallback is allowed. Start **automatic screen recognition and hints** without the developer auto-click diagnostic. In the live session, inspect **NOL · 1장 우선 후보 검토**; compare the visual preference ranking against the actual official screen. Do not share CAPTCHA, queue, login, payment or identifying screenshots.


## NOL-04 implementation log (2026-10-11)

### Implemented: strictly sandbox-only action / independent result verification

**`apps/desktop/electron/copilot/nol-execution.cjs`** adds:

- `NolSandboxProvider`: offline, in-memory stand-in for a NOL provider. It exposes separate `readOffer`, `submitOnce`, and `observeHold` methods. It has no browser, network, checkout, login, or payment access.
- `NolSandboxExecutor`: accepts only the privately branded sandbox provider. It validates the exact account, plan, event, performance, browser/session generation, one KRW ticket, complete fee-included total, budget and explicit seat preferences **before** any mock mutation; revalidates owner scope after each await.
- `NolSandboxJournal`: synchronous per-account/per-performance intent latch, recorded **before** submitting. A repeated offer, ambiguous outcome, verified hold, expired hold, concurrent attempt, or executor recreation against the same in-memory journal blocks duplicate mutations. A second different offer is possible **only** after independently observed `seat_conflict`/`sold_out`, `allowFallback=true`, explicit `confirmedFallback=true`, and within two attempts. This journal is **not crash-durable**; the existing `booking/journal.cjs` and server session coordination must be integrated before any real authorized provider mutation.
- `verifySandboxHold`: checks an **independently read** sandbox-provider receipt against exact scope, offer ID, quantity=1, performance, fee-included KRW total within budget, status, observation freshness, binding and hold expiration. It has an internal evidence capability/fingerprint: an AI assertion, fabricated object, mutated proof, action acknowledgement, or checkout page cannot produce this token.
- Explicit outputs: `sandbox_hold_verified` (the **mock** only), `seat_conflict`, `sold_out`, `hold_expired`, `reservation_unknown`, `blocked`. Every output has `simulation:true`, `liveHoldVerified:false`, `paymentSubmitted:false`. No method can complete a real NOL order or authorize a live executor.

**Desktop integration:** the real NOL Copilot remains in visual guidance/manual-hand-off mode at selecting and checkout. At real checkout/cart, it now emits `holdEvidence.status=provider_verifier_unavailable` with `verified:false` and a Korean/English warning to check official quantity, total and hold timer. The sandbox executor is **not** exposed over Electron IPC or attached to the real browser. The installed NOL addon still has level-2 and level-3 automation restrictions.

### Test cases / gate

**`apps/desktop/electron/copilot.nol-execution.test.cjs`** includes mock-only end-to-end cases for:
- one-ticket mock hold verified by a separate provider read and exact total
- repeated requests, executor recreation and concurrent attempts
- explicit user-confirmed fallback after seat conflict (no auto retry)
- strict preferences when fallback not approved
- response loss **after** a mock mutation: unknown outcome / no retry
- submitted action without a provider hold: not success
- quantity, performance, currency, fee completeness, event and total-budget mismatch **before** submission
- mutated/mismatched evidence, replayed/fabricated proof
- expired hold and stale observations
- owner invalidation, cancel/stop before provider mutation, ownership loss after a mutation, no mutation outside a valid session
- all results require `liveHoldVerified:false`

Validation to date: isolated JavaScript runner passed **15/15 NOL-04 test groups and 111 assertions**. The real Node test suite, Electron/TypeScript build and official NOL site E2E remain pending. No claims about measured NOL live success rate are made.

### Remaining before actual NOL hold success (NOL-05 entry blockers)

1. **Provider-approved adapter:** obtain explicit integration/automation permission and verified active NOL account/event ticket-flow evidence, preferably from a sanctioned test environment. Development flags do not grant vendor authorization.
2. **Official hold proof:** trustworthy provider-owned readback with exact event/performance, one ticket, fee-included amount and expiration. Neither screenshot suggestions nor URL navigation alone qualifies. Implement a live evidence capability that cannot be minted by AI or the renderer.
3. **Durable duplicate prevention:** wire the previously built fsync/HMAC journal and distributed session fencing to every actual provider mutation. In-memory mock journal is intentionally insufficient.
4. **Full automation safety:** reviewed live adapter and proof contracts, session/popup ownership and SPA navigation, restricted pages, timeouts, queue continuity, cancellation, stale observation failure, crash recovery, same-seat conflict re-observation, and regression tests.
5. **Real test data:** sanctioned fixture screenshots or redacted manual recordings for current NOL variants; NOL-02 visual recognition accuracy is still unmeasured.
6. **Release checks:** normal packaged mode remains disabled until all conditions are met. No real payment automation and no queue, CAPTCHA or account-verification bypass.

### Execute offline regression

From `apps/desktop`: `npm run test:copilot` runs `electron/copilot*.test.cjs`, including the NOL-04 suite. A standalone invocation is `node --test electron/copilot.nol-execution.test.cjs`. Both run without touching NOL World, making a booking, or charging a card.


## NOL-05 implementation log (2026-10-11)

**Implemented on `dev`:**
- `electron/copilot/nol-validation.cjs`: privacy-bounded stage/timing counters, confusion matrix, per-label precision/recall, sensitive-screen missed-stop counter, false hold-claim counter and an unconditional release **HOLD** audit. Real visual accuracy and live hold-success rate remain **null/unmeasured**.
- `LiveCopilot`: emits only session-local aggregate observation P50/P95, user handoffs, queue enter/resume, action attempts and `hold_unverified` counts. No screenshots, account information, URLs, seat coordinates, cookies, tokens or booking IDs are stored by the new telemetry. Queue transition counters **do not** prove queue-position continuity.
- Desktop: **NOL 검증 진단** shows session observation count, handoff count, queue transition count and P95 observation elapsed time. This is diagnostics, not official ticket or provider-hold confirmation.
- `scripts/nol-validation-report.cjs`: synthetic replay of **18** existing NOL stage fixtures, separated from real-world accuracy and measured live booking success. The NOL automation addon must remain restricted and every successful report must remain `status:HOLD`.
- `scripts/nol-score-screens.cjs`: locally scores **only** reviewed non-sensitive, human-labeled *metadata* from actual NOL images against the same classifier. It rejects raw images, unknown fields and actual account/session URLs, runs without browser or network, and cannot permit execution. Actual reviewed screen records have not yet been supplied.
- `electron/copilot.nol-validation.test.cjs` and `electron/copilot.integration.test.cjs`: validate synthetic classification and sensitive-screen abstention, bounded metrics, queue/manual takeover and checkout no-upload/no-click, forgery resistance and the release HOLD invariant.
- Added `npm run test:nol -w @tixbam/desktop` and `node scripts/nol-validation-report.cjs` to the existing `dev` GitHub Actions desktop CI, alongside the established Electron tests and build.

**Instructions for collecting meaningful, consented NOL observations:** [NOL-05 real-screen validation protocol](./NOL_05_REAL_SCREEN_VALIDATION.md). Live captures/labelled samples and approved provider E2E are **not yet available**; therefore fixture match rates must not be represented as real recognition accuracy.

### NOL-05 release blockers remain

Actual NOL automation cannot be called production-ready: written vendor authorization and sanctioned test environment; an audited live seat-hold/price/result observer; durable crash-resilient duplicate reservation fencing; independent real-screen recognition measurements; no wrong-action/unsafe-site proofs; security/recovery review and a real provider booking hold E2E. Payment, queue, CAPTCHA and identity challenges remain user-owned, and no NOL release flag has been enabled. **Synthetic CI PASS never equals LIVE GO.**


## Follow-up: automated validation of stages 1 and 2 (2026-10-12)

Previously documented manual validation tracks **(1) offline Copilot/backend behavior** and **(2) Desktop screen/UI response** are now both covered by automated test cases. The dedicated command is:

```bash
npm ci
npm run verify:nol
```

This runs the NOL-01..05 host/strategy/executor/validation integration tests, builds a **separate offline Electron fixture**, exercises the actual production `LiveBookingWorkspace` React DOM through NOL-01..05, and emits the synthetic-only HOLD validation report. The new fixture intentionally does **not** open any NOL provider URL, upload screenshots, or issue ticket actions; this does not validate actual NOL site UI recognition or real seat acquisition. CI also runs `npm run test:ui:nol -w @tixbam/desktop` after building Desktop + Admin.

Detailed expected outputs, test-source locations and security boundaries: [NOL automated testing guide](./NOL_AUTOMATED_TESTING.md). This work does not change the existing NOL level-2/3 restriction or the production release HOLD gate.
