# TixBam Live Copilot — architecture and rollout

## Product direction
Live booking is the primary user journey. A Booking Plan contains hard requirements (quantity, total budget, location preferences). Live Copilot is the primary workspace for using the official provider browser. Offline rehearsal is secondary, a short optional preview of the expected provider/event workflow.

## Implemented phase 1: user-directed native browser interaction
- Electron main process captures a **single opt-in, local JPEG preview** from an official, plan-bound browser. No screenshot is uploaded, logged, or persisted.
- A plan-linked **preparing** page can be captured for opt-in AI suggestions about a safe booking-entry button. The user may highlight a proposed button but must click it in the official page themselves. AI cannot click at preparation. Login, waiting room, queue and checkout paths remain blocked. A fresh screenshot at actual ticket selection enables one user-approved native click.
- A user chooses a point on the local preview. The host can highlight the corresponding point on top of the official page with an isolated, mouse-transparent Electron child window. The user may select a plan-linked popup as the Copilot target while its parent remains open and its URL belongs to an approved provider host.
- After a separate user confirmation, the host verifies exact window ownership, plan/provider, URL, phase, viewport size, age and screenshot content **again**, then sends one native mouse-down/up pair into that browser. A consumed or stale snapshot cannot be reused.
- Changing navigation, window, account, phase or closing the browser invalidates previews. No arbitrary URLs, JavaScript, CSS selectors or page DOM cross the dashboard IPC boundary.
- Provider pages receive no privileged preload, JS injection, automation extension or payment details.
- A click rechecks the same URL, window, plan, stage, snapshot age and viewport; it also compares the **exact target neighbourhood** against the original JPEG. Unrelated countdowns/animated banners are tolerated, but a changed target neighbourhood fails closed. Browser focus occurs *before* that comparison. Recapture after a button or seat changes.
- The native pointer overlay needs packaged macOS/Windows QA for positioning and input pass-through.
- This mode is a human-directed remote click, **not automatic seat selection**, actual inventory verification or a reservation. Payment outcome is never inferred.

## Phase 2: optional AI button proposals (implemented but disabled by default)
A signed-in user can explicitly consent for each selected screenshot to submit that exact JPEG (temporarily held only in local memory) to the TIXBAM server for OpenRouter image analysis. Admin must first enable the copilot_vision task with a vision-capable model. Responses are strictly validated, high-confidence only (>=0.85), advisory only, with no execution. Preparation-stage suggestions are restricted to non-payment entry/continue actions; those must be clicked by the user in the official browser. Actual ticket-selection images can suggest quantities and seats; native clicks still require a separate explicit confirmation and a strict screenshot digest recheck. Neither the API nor Electron persists the JPEG. Before and after the model request the host checks token, stage, window, URL and viewport consistency. No background/continuous vision, provider inventory verification, on-device OCR or general autonomous loop is claimed. The upload may expose personal data visible in the screenshot to the chosen external model; the user must consent on each attempt. An AI-generated target is never executed without the user's approval.

## Phase 3: eligible provider automatic actions (NOT enabled)
For each provider and event: verify written authorization/official integration, regional terms, hosted release signature/version, approved action types, exact event/plan, local consent, safety/rate bounds, and kill switches. The host executor (never an AI model) re-observes and validates before each permitted action. Login, queue, CAPTCHA, 3DS, purchase limits and payment safety remain human/official-provider owned. Never try to circumvent restrictions. Existing AB-01/12/15 fail-closed gates remain in place; neither admin policy alone nor this phase-1 human click enables auto seat selection.

## Acceptance metrics
Compare ordinary official-browser booking against Copilot in allowed test sessions: time from admission to cart, clicks, stale-target rejection, incorrect targets, queue loss, safe user takeover, cart/receipt verification. No claim of improved booking success rate without measurements.
