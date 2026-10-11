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
