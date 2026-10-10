> Autonomous booking design and implementation progress (AB-01–AB-08 on dev): [Autonomous Booking Design](AUTONOMOUS_BOOKING_DESIGN.md) · [Execution Runbook (AB-01–AB-15)](AUTONOMOUS_BOOKING_RUNBOOK.md) · [Contracts](AUTONOMOUS_BOOKING_CONTRACTS.md)

# TIXBAM provider-neutral AI advisor

The deterministic booking engine and reviewed provider adapters remain the only entities allowed to navigate, reserve, validate orders or submit checkout. AI never executes actions. Any future add-on can send the typed `AIAdvisoryRequest` from `packages/addon-sdk/index.d.ts` for the relevant supported task. Desktop shows advice only.

## Flow and settings
- The renderer invokes narrow Electron IPC; the isolated rehearsal window is limited to its bound provider and rehearsal task.
- Main process uses its OS-encrypted signed-in TIXBAM session and pinned official API origin. Neither model IDs nor keys are selected or entered by end users.
- `POST /v1/ai/advice` verifies account token, provider, enabled task, per-account quota of 30/hour and bounded, non-sensitive structured state. URLs, credentials, screenshots, HTML, card data and free-form website contents are not accepted.
- Server selects model and limits from the DB for each call, calls OpenRouter with `OPENROUTER_API_KEY`, and validates the bounded structured JSON response. Only task, model, timestamp and status are logged.
- Admin → AI Models uses `GET /v1/admin/ai/tasks` / `PUT /v1/admin/ai/tasks/{task}`. Each task is disabled initially and has its own model ID, 2–12s timeout and 128–1200 output-token limit. `OPENROUTER_API_KEY` belongs only on the Railway API service, never in Vercel Admin or Desktop.
- Tasks: `rehearsal_guidance` (connected to the separate rehearsal window); `page_recovery` and `seat_review` (server interfaces ready for future supervised UI integration).

AI failure, network timeout, disabled task or lack of login never blocks rehearsals. An AI response cannot override budgets, seat adjacency, purchase quantity, payment latch or real checkout. Never bypass CAPTCHA, queues or provider restrictions.

## Rollout
1. Set the server-only OpenRouter key on Railway and redeploy API.
2. Open Admin /ai, enter tested OpenRouter model IDs, and enable rehearsal guidance only.
3. Sign in to Desktop and open a rehearsal; click the optional AI guidance button.
4. Verify Korean/English results, timeouts, quota and safe fallback; evaluate accuracy/latency before turning on other tasks.

This release does **not** autonomously drive live ticketing, seats or payment through AI. Those require reviewed per-provider capabilities, explicit user authorization and site compliance checks.

## Supervised live assistance
The common host runner includes only a recognized booking stage and sanitized preference constraints in the status for any provider, never page text, card details, receipt identifiers or secrets. `RunAIAdvisor` is available in both Booking Panel and Booking Runs. On `awaiting_user` it requests `page_recovery`; on final `review` it requests `seat_review`. Both require an explicit user click, authenticated account and task enabled by Admin. Guidance is purely informational; the normal runner continues to be solely responsible for verified checkout and once-only payment submission. There is no automatic model execution or navigation.

## AB-08 PlannerV1 (strict proposals, rehearsal-only)

- Signed-in rehearsal users may explicitly select **Suggest a next step with AI** within the provider-neutral Safety Stress Lab. It is never invoked automatically by a booking run.
- Electron main process captures AB-04 host observations from an **offline synthetic adapter**, then transmits only `AIObservationV1` (stage, challenge, confidence, counts and short-lived anonymous target tokens) through its authenticated API request. Model prompts receive no run/snapshot/account identifiers, page content, provider IDs, prices, order data, card data or URLs.
- `POST /v1/ai/plans` is separate from the unchanged `/v1/ai/advice`. It uses Admin task `planner_v1`, disabled by default. Enable only after testing the chosen model supports strict JSON Schema. Server requests parameter-aware OpenRouter routing (`provider.require_parameters=true`) and parses a closed 3-field model output.
- Host resolves task tokens locally, checks snapshot identity, expiry and current run revision, and creates an AB-03 `ProposalV1` using `strictProposal`. Only the non-executable action name, code and model are rendered. **No host action handler is called, no live DOM mutation or checkout is enabled.**
- Quotas: 8 calls per run per hour, 20 planner calls per user per hour, combined 30 AI calls per user per hour, 4 KiB prompt and 256 output-token caps. The server logs quota, status and selected model, not user observations or responses.
- Invalid responses, provider timeouts, Admin revocation and session changes give a safe manual `ASK_USER` fallback. Recovered/terminal rehearsals cannot request a proposal.

For setup and test scenarios see [Offline rehearsal guide](REHEARSAL_LAB.md) and [AB-08 runbook](AUTONOMOUS_BOOKING_RUNBOOK.md).
