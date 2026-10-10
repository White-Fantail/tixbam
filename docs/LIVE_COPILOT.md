# TixBam Live Copilot — architecture and rollout

## Product direction
Live booking is the primary user journey. A Booking Plan contains hard requirements (quantity, total budget, location preferences). Live Copilot is the primary workspace for using the official provider browser. Offline rehearsal is secondary, a short optional preview of the expected provider/event workflow.

## Implemented phase 1: user-directed native browser interaction
- Electron main process captures a **single opt-in, local JPEG preview** from an official, plan-bound browser. No screenshot is uploaded, logged, or persisted.
- Capture is restricted to the user-marked ticket-selection phase; known login, waiting room, queue and checkout paths are blocked.
- A user chooses a point on the local preview. The host can highlight the corresponding point on top of the official page with an isolated, mouse-transparent Electron child window.
- After a separate user confirmation, the host verifies exact window ownership, plan/provider, URL, phase, viewport size, age and screenshot content **again**, then sends one native mouse-down/up pair into that browser. A consumed or stale snapshot cannot be reused.
- Changing navigation, window, account, phase or closing the browser invalidates previews. No arbitrary URLs, JavaScript, CSS selectors or page DOM cross the dashboard IPC boundary.
- Provider pages receive no privileged preload, JS injection, automation extension or payment details.
- If the page is animated or a countdown changes, the strict pixel-digest comparison may reject an otherwise valid target. This is intentional fail-closed behavior; recapture before trying again.
- The native pointer overlay needs packaged macOS/Windows QA for positioning and input pass-through.
- This mode is a human-directed remote click, **not automatic seat selection**, actual inventory verification or a reservation. Payment outcome is never inferred.

## Phase 2: provider-verified observation & recommendations (NOT implemented)
Build an on-device image recognizer and/or official provider read-only integration which returns bounded, freshness-bound target rectangles, labels, confidence, screenshot provenance and stage. No raw frame may be sent to a cloud model absent explicit data minimization and informed opt-in. Targets must be tied to host snapshot tokens and never reused after navigation, challenge or visual changes. AI is advisory: its output cannot grant permissions.

## Phase 3: eligible provider automatic actions (NOT enabled)
For each provider and event: verify written authorization/official integration, regional terms, hosted release signature/version, approved action types, exact event/plan, local consent, safety/rate bounds, and kill switches. The host executor (never an AI model) re-observes and validates before each permitted action. Login, queue, CAPTCHA, 3DS, purchase limits and payment safety remain human/official-provider owned. Never try to circumvent restrictions. Existing AB-01/12/15 fail-closed gates remain in place; neither admin policy alone nor this phase-1 human click enables auto seat selection.

## Acceptance metrics
Compare ordinary official-browser booking against Copilot in allowed test sessions: time from admission to cart, clicks, stale-target rejection, incorrect targets, queue loss, safe user takeover, cart/receipt verification. No claim of improved booking success rate without measurements.
