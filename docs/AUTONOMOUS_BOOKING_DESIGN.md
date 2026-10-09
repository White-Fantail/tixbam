# TIXBAM Autonomous Booking v1 — 상세 아키텍처 (DESIGN)

Status: **Proposed / not enabled** · 2026-10-10 · Target branch: **dev**
Primary execution runbook: [AUTONOMOUS_BOOKING_RUNBOOK.md](AUTONOMOUS_BOOKING_RUNBOOK.md)
Contracts and security acceptance: [AUTONOMOUS_BOOKING_CONTRACTS.md](AUTONOMOUS_BOOKING_CONTRACTS.md)

## 0. Scope and truth boundary

목표: 사용자가 승인한 정확한 공연·회차·수량·최대 총액·좌석 기준 안에서, 제공업체가 허용하는 동작을 신속하고 안전하게 실행하고, 예외 상태에서 제한적으로 복구한다. 사전 승인 구매는 **해당 제공업체가 승인한 경로/계약/정책과 결제 방식**이 존재할 때만 사용한다. 성공을 보장하지 않는다.

현재 코드 기준:
- apps/desktop/electron/booking/runner.cjs: 상태/구매 선택/결제 제출 잠금은 프로세스 메모리에 존재. 결제 제출 후 오류에는 payment_unknown.
- apps/desktop/electron/booking/controller.cjs: 런타임이 cityline에 하드코딩됨. 실제 Cityline 결제 서비스는 전달하지 않음.
- apps/desktop/electron/booking/cityline.cjs: 실제 관찰 검증은 공개 eventDetail의 공연/가격 버튼 수준. 좌석/라이브 결제는 미검증.
- apps/desktop/electron/booking/vault.cjs: OS safeStorage 암호화 카드 보관과 메모리 CVV. 별도 결제 보안 심사 필요.
- apps/desktop/electron/main.cjs: provider partition, sandbox/contextIsolation, 이벤트별 창 연결.
- apps/desktop/src/rehearsal/CitylineRehearsal.tsx: 오프라인 모의 리허설.
- services/api/app/ai.py: OpenRouter를 통해 *조언*만 제공. 모델은 Admin에서 설정; 임의 실행 명령을 반환하지 않음.
- packages/addon-sdk/index.d.ts: booking preferences/order 계약, 추후 자동화 capability를 표현하기 위한 확장 필요.
- apps/desktop/addons/catalog.json: 제공업체별 현재 자동화 restrictions/unverified/delegated 정보. 사실 확인 없는 'enabled' 격상 금지.

### Out of scope (non-negotiable)
- CAPTCHA/2FA/3DS/대기열 우회, 대기 순서·공식 구매 수량 제한 회피, 차단을 우회하기 위한 브라우저 지문 조작·회전 프록시·분산 계정.
- 제공업체가 금지한 사이트의 무허가 자동 예매/자동 결제.
- OpenRouter/모델에 원본 쿠키·세션 토큰·PAN/CVV·은행 인증정보·원본 결제 화면 전송.
- 제공업체 사이트의 임의 JS를 내려받아 Electron 권한으로 실행.
- AI 판단만으로 결제 실행 승인·가격 상한 변경·이벤트 변경·재결제 결정.

## 1. 계층 구조 및 신뢰 경계

~~~text
User preferences + explicit bounded consent
                 |
       Desktop UI (untrusted renderer)
                 | typed IPC (sender/window/account checks)
                 v
Electron main process (trusted host)
  ├─ BookingOrchestrator (state machine; one run per plan)
  ├─ Host PolicyEngine (user constraints + provider permission + capability)
  ├─ ActionValidator (typed action + current observation + expiry)
  ├─ BookingJournal (durable local write-ahead, no secrets)
  ├─ SessionCoordinator (same-plan & same-account concurrency)
  ├─ ProviderRuntime (bundled/reviewed provider-specific adapters)
  │     └─ HTTPS ticketing BrowserWindow (sandbox, no Node bridge)
  └─ PaymentExecutor (separate privileged host module, gated)
                 |
   Signed-in TIXBAM API (user auth / Admin settings / quotas)
                 |
   OpenRouter (planning only; no capability to call browser/payment)
~~~

**Always local:** browser session, cookies, sensitive observed DOM, real purchase input, card/token/3DS interaction, live payment submit, transaction journal. **Server:** feature/model policy, provider compliance metadata, model inference, rate limits and optional *non-sensitive* multi-device lease. **AI:** redacted/typed observation and action suggestion only; no raw selector/URL commands.

Trust boundary: renderer IPC cannot mint approvals or execution capabilities; remote browser content is data (including malicious/prompt-injection text), never instructions. OpenRouter proposals are untrusted until host validates them. Backend administrative flags do NOT alone prove vendor authorization.

## 2. Policy and capabilities

Two independent gates must both pass:
1) **Provider permission:** administrator-verified evidence scoped to region, seller, feature and event category (source URL/reference, review date, expiry, approval owner, legal/business status). States restricted / unverified / permitted / revoked. Unknown => DENY.
2) **Local implementation capability:** packaged and reviewed add-on version attests exactly which operations and page profiles were tested. States pending / verified / disabled. Unknown => DENY.

Effective capability = intersection(permission, reviewed local implementation, signed-in user's plan consent, current runtime context, global kill switch). No writable public capability field, remote catalog or AI suggestion can upgrade permission. Promoters such as Live Nation delegate execution to the actual ticket agent; handoff must re-evaluate both gates for the seller.

Modes:
- assistant: open window, advice, reminders and rehearsal; no live autonomous actions.
- supervised: only expressly permitted, validated live actions; user handles challenges and final commitment if required.
- autonomous: expressly permitted provider+operation+region and validated purchase consent; enabled only after release gate.

Suggested admin API (future, restricted to existing Admin security):
- GET/PUT /v1/admin/automation/providers/{providerId}/policies (audit/role review; may only narrow, not invent permission)
- GET /v1/automation/capabilities?providerId=... (sanitized effective modes/statuses for UI, no secrets)
- POST /v1/admin/automation/kill-switch (server-distributed disable, cached fail-closed for auto checkout)
Do not mutate existing provider.automation semantics without a backwards-compatible migration. Prefer a new table for evidence & revision history, and signed/reviewed **bundled** manifest for execution support. A disable takes precedence over an enabled flag. Policy version pinned at run start AND rechecked before irreversible actions.

## 3. Immutable approval / purchase intent

BookingPlan from services/api/app/booking_plans.py is a mutable, non-secret user goal and is NOT itself a payment grant. Creating a run from it requires a separate local bounded PurchasePermit:
- schemaVersion, permitId, runId, accountId, planId, providerId, saleId, eventId, performanceId, providerEventId.
- allowed ticket types/price tiers/sections/floors/seat modes, exact quantity, requireTogether, allowed alternatives explicitly ranked, blocked restricted-view/real-name concessions unless specifically authorized.
- currency, maxAllInMinor (includes tax, fee, delivery), delivery preference; uncertain total or currency mismatch => no pay.
- checkoutMode review / conditional-auto, permittedActions, effective vendor capability/policy revision, addonVersion, validFrom/validUntil, explicit acknowledgment/consent nonce.
- signed/host-authenticated user action, immutable SHA-256 canonical digest; no arbitrary fields; invalidated if plan, account, page owner or policy changes.
- no card data, CVV, cookies, screenshots, OTP or full URLs.

A permit can authorize **at most one** actual purchase commitment. Review mode remains default; conditional-auto stays disabled unless provider/financial/security gates pass. App cannot infer bank authorization. TTL and use-once enforcement survive restart via durable journal.

## 4. Orchestrator finite state machine (FSM)

State set (can map existing BookingRunner externally until migration):
CREATED -> WAITING_FOR_SESSION -> OBSERVING -> (WAITING_FOR_USER | DECIDING) -> VALIDATING_ACTION -> EXECUTING_ACTION -> OBSERVING
OBSERVING -> OFFER_SELECTED -> ORDER_REVIEW -> (WAITING_FOR_USER | READY_TO_COMMIT) -> PAYMENT_COMMITTING -> VERIFYING -> CONFIRMED / PAYMENT_UNKNOWN
Any precommit state -> STOPPED / FAILED. PAYMENT_COMMITTING/VERIFYING must NOT transition to safe retry; on interruption -> PAYMENT_UNKNOWN. Distinguish UNKNOWN vs FAILURE **after potential payment**; never assume failure means no charge.

Transition API:
- transition(runId, expectedVersion, event, evidence) is a single-writer operation.
- Every transition has allowlisted predecessors and a reason code. Unknown transition throws.
- One in-flight async action per run/window; stale async completions ignored (run generation + observation version + abort check).
- Terminal state invariant. Cancellation between validation and mutation invalidates action; abort is best effort and cannot undo submitted payments.
- Deadline aware: expiry before action prevents it. Avoid queue refresh/rejoin as "recovery".

Recommended source layout:
- apps/desktop/electron/booking/orchestrator.cjs, state-machine.cjs, action-validator.cjs, observation.cjs, journal.cjs, session-coordinator.cjs.
- Existing runner.cjs remains a compatibility façade while tests are migrated.
- tests as *.test.cjs at electron/ root to match current npm test.

## 5. Observation contract and page ownership

ObservedPageV1: snapshotId, observedAtMs, expiresAtMs, windowId, runId, accountId, providerId, eventId/performanceId, routeFingerprint (non-secret), stage enum, challenge type, allowed action references, option summaries and zero/trusted prices where available, confidence and provenance ("provider-verified" / "observed" / "unknown"). Never report "seat available"/"payment success" without provider evidence.

Before any OpenRouter call, host derives a separate **AIObservationV1**, excluding accountId, planId, runId, windowId, raw vendor event IDs, payment references, and personal/attendee data. AI-only opaque targets map to current host handles locally and expire after use. Do not upload host's full ObservationV1 object.

Host may inspect provider-approved page profiles through a sandboxed isolated webContents execution script that:
- validates current HTTPS host/origin *before and inside* injection; verifies event ID, BrowserWindow, plan/account/window binding, addon version and navigation generation.
- extracts only predeclared properties with capped counts/lengths; removes auth/session fields and hidden form values.
- never returns arbitrary HTML, javascript, hidden inputs, unrestricted URLs or cookie state to model.
- never assumes accessibility tree is free from secrets; password fields and editable/payment fields are excluded.

Screenshots: disabled initially. Future opt-in only with inspected redaction + explicit data handling policy; if overlay/popup prevents reliable PII masking, do not transmit. Provider permission is also necessary for sending site content to a third-party AI. Challenge pages must not be sent to AI to solve.

Snapshots immutable and short-lived; after navigation, stale snapshot action references become invalid. A model output must refer only to a currently issued target ID; no arbitrary CSS selector, XPath, coordinates, script or navigation URL.

## 6. Action pipeline and safe recovery

AI returns ProposalV1: actionKind enum, snapshotId, targetRef, reasonCode, evidenceRefs, confidence, expectedStage, optional ordinal/cost. AI output is *never* an executable program.

Proposed safe actions, if individually provider-approved: WAIT, REOBSERVE, ASK_USER, STOP, SELECT_PERFORMANCE, SELECT_PRICE_TIER, SELECT_APPROVED_OFFER, OPEN_APPROVED_DELIVERY_OPTION, RETURN_TO_VERIFIED_STEP. Other actions are denied by default; queue refresh, CAPTCHA/OTP interaction, login submission, forced retries, arbitrary JS, payment submission and unconstrained navigation are **not** general AI actions.

Pipeline: observe -> recommend -> normalize -> validate current bindings/provider policy/plan/consent/capability/targets/action budget -> prepare -> re-observe and compare snapshot ID + target + stage -> execute through provider adapter -> verify postcondition -> append result. All mutations need a fresh precondition and bounded retry count (default zero for checkout/queue, at most one for idempotent reads). Re-observation is not the same as a page refresh.

Failure modes: immediate safe fallback to manual review if model unsupported/late/malformed, provider layout uncertain, prompt injection suspected, approval expired, 3DS/CAPTCHA/queue, or page ownership inconsistent. Apply model suggestions only after strict schema validation, rate limiting and mode/policy verification. Never click "Accept all" based solely on AI text; material terms change requires user review.

## 7. AI planner (OpenRouter and Admin)

Keep existing server-only OPENROUTER_API_KEY and signed-in /v1/ai/advice unchanged. Introduce a *separate* versioned planner endpoint only after ObservationV1 is stable:
- POST /v1/ai/plans (authenticated user, idempotent request ID, strict payload limits)
- Return ProposalV1 (one proposal, no multi-action script), model trace ID, failure category. No direct host-side tool execution.
- Admin /ai: distinct page_interpretation, recovery_planning, seat_comparison, rehearsal_analysis tasks; model ID, strict structured-output support, max latency/tokens/cost, enabled flag, fallback strategy. Keep previous tasks for backwards compatibility.
- Require model capability for strict JSON schema; application re-validates anyway. Restrict OpenRouter provider routing/data retention for allowed sensitive scenarios.
- Limit concurrent calls per run; deduplicate by snapshot+task; expiry must be less than any pending action window; reject out-of-order response.
- No model-visible PII or hidden fields. Do not record raw prompts or completions. Diagnostics: task/status/latency/model/token count/redacted reason only.
- Human review when AI confidence absent/uncertain; never use confidence as permission.

Do NOT call a 2–12 second AI inference for routine ticket checkout actions; deterministic adapter executes known steps without model. Recovery only when changes observed.

## 8. Durable purchase journal, exactly-once intention

Current in-memory submitted latch is not sufficient across crash/restart. Introduce local append-only write-ahead ledger, no secrets. Recommended first implementation: locked 0600 file in Electron userData with append + fsync for critical transitions, strict schema and size/rotation rules. Do not hold full booking URLs or payment identifiers in logs; use digests/redacted references. If moving to SQLite, must retain same fsync/failure semantics with verified PRAGMAs.

Before any irreversible operation, persist:
1. permit identity/digest and locked plan scope;
2. selected order canonical fingerprint (event/session, ticket types, seats if known, fees, quantity, currency, total, seller);
3. unique paymentAttemptId, attempt state **COMMIT_INTENT_RECORDED** and fsync;
4. recheck permit/capability and site evidence, then submit **once**, move to outcome verification.

Any crash after commit-intent recording, whether or not a request actually escaped the process, reopens as PAYMENT_UNKNOWN/VERIFY_REQUIRED, **never** resubmits. Only official merchant idempotency / order lookup under explicit integration can justify reconciliation; do not invent transaction IDs or assume an HTTP error means no charge.

No repeating automatic purchase across multiple plans for same exact sale/identity/quantity until prior attempt verified. Preserve the one-shot commitment even if the user stops the run. The UI must explain possible payment and direct user to official order history.

## 9. Parallel sessions, ownership and leases

Per-process lock keyed by accountId + providerId + saleId + performanceId + attendee/intent scope; independent browser windows can remain open but only one may own an irreversible purchase for a given logical target. Electron sender/window binding checked for every IPC. Provider sessions stay isolated by partition.

For multi-device support, optional short server lease or user-bound purchase-intent tombstone can coordinate attempts but cannot guarantee exactly-once delivery over partitions. If server unreachable, fail-closed on **autonomous payment**; manual site booking can remain available. An app restart never silently resumes payment. Do not transmit provider cookies/payment secrets. Lease fencing-token version prevents stale clients from committing after a new owner takes over; if provider gives no idempotency/order query, err on the side of no retry even after lease expiry.

## 10. Seat and order validation

Rank offers through current chooseOffer-style deterministic policy:
- Hard constraints: exact provider/event/performance, quantity, currency, all-in price <= maximum, seat category/mode, age/real-name requirements, adjacency only where applicable, accessibility/restricted-view exclusions, allowed alternatives and sale purchase limits.
- Unknown fee, total, seat location, policy, identity or availability => cannot commit.
- "Standing" cannot be treated as numbered seat adjacency; validate using mode-specific schema.
- Event/session-specific max ticket limit overrides generic provider max; user can never request more than the official limit.
- Seat quality scoring only among hard-valid candidates. AI can explain trade-offs and recommend, never waive hard requirements.
- Reserve and re-read true cart, compare immutable order fingerprint before committing.
- Do not add insurance, merchandise, upgrades, subscription or donation unless separately explicitly authorized.

## 11. Local PaymentExecutor (only on authorized sites)

Define interface for verified official payment provider integrations: prepare(permit, order), submitOnce(attemptId, verifiedOrder), verify(attemptId, officialEvidence). Payment executor is **not** an AI action and cannot be dynamically enabled from Admin alone. Approved payment origins/frames, bank handoffs, allowed methods and checkout flow must be reviewed in the host package and validated for each site.

Prefer official saved-card/token/wallet flows. Current CardVault/RunSecret should NOT be exposed to AI or downloaded add-on code. Review storage/memory handling, PCI DSS scope and per-brand constraints **before** any real automated card entry. CVV is never retained after authorization; direct PAN/CVV automation should not be introduced without required compliance review. Existing manual purchase remains available.

Issuer challenge (3DS/OTP/banking app), CAPTCHA, identity documents, and terms requiring fresh assent => WAITING_FOR_USER. No UI or model trick should simulate bank consent.

## 12. Purchase verification and post-payment reconciliation

Evidence ladder:
1. First party verified order/receipt ID and exact order fingerprint -> CONFIRMED.
2. Official status API/order history query if permitted -> CONFIRMED / VERIFIED_NO_CHARGE / UNKNOWN.
3. Inconsistent/timeout/no formal evidence -> PAYMENT_UNKNOWN.
Do not accept AI-generated "success" or mere page-title change as proof.

UNKNOWN is an operational terminal hold until explicit reconciliation workflow; no auto-resubmit. Record attempt ID, vendor reference if verified and non-sensitive, evidence timestamp/source, reviewer action. On restart, immediately display unresolved holds before enabling another purchase of same plan/attendee.

## 13. UI/UX and localization

Desktop Korean default, English supported, future extensible i18n:
- user sees mode (manual/supervised/conditional-auto), exact seller, permission capability, selected terms, final all-in amount and currency; no model selector.
- transparent plan: allowed seats/rank, budget, quantity, 1-purchase limit, expiry and where human input will still be required.
- live execution timeline: observing/working/waiting-for-user/ready/payment-unknown/confirmed and reason. Stop button should explain that submitted charges cannot be reversed.
- notification for CAPTCHA/login/queue admission/3DS/manual terms; no repetitive background prompt.
- network/AI unavailable => deterministic actions or safe manual takeover. No fabricated success/cost/queue position.
- rehearsal in separate window shares action contract and safety validator but uses **only fake offline fixtures** and fake payment executor; never real provider.

## 14. End-to-end release gates

Gate A (foundation): CI unit/property tests for FSM transitions, approval immutability, invalid proposals, malicious web content and stale observation.
Gate B (dry-run): deterministic provider-neutral offline simulator, failure injection and page layout variants, 0 live transactions.
Gate C (supervised): provider expressly permits relevant operations; documented verified page profiles; staged internal accounts; manual checkpoints; instrumented safe rollback/kill switch.
Gate D (conditional-auto): written/otherwise verifiable permission scoped to checkout, compliant official payment method, ledger + restart recovery validated, 3DS handoff, no duplicate charge on fault injection, release approval and provider-specific kill switch.
Never use payment from an actual live ticketing site solely to exercise software tests.

Release should be rolled out per provider **and operation**, not all providers simultaneously. CI, peer security review, privacy review and native packaged-macOS tests before enabling.

## 15. Required baseline tests and commands

- npm test
- npm run check
- npm run build
- PYTHONPATH=services/api:services/mcp python -m pytest services/api/tests -q
- Additional state-machine/property/fault tests defined in runbook; real Electron native behaviors manually checked.
- CI check at .github/workflows/ci.yml and Docker API build when server contracts change.

## 16. Remaining business decisions (must be explicit before live money)

1. Which ticket agents provide legitimate automation/official integrations? Record source, region, scope and permission expiry; unverified means no live autonomous action.
2. Approved payments: official token/wallet/hosted flow vs direct card handling; PCI/privacy review is a hard go/no-go.
3. Purchase maximum per attendee, whether purchase auto approval is offered, permit expiry and transaction dispute/recovery support.
4. Multi-device purchases need global coordination, especially if user signs in on multiple computers.
5. Screenshot AI: initially **off**, later opt-in and site permission; masking and retention checks required.
6. Logs/support retention and user-facing disclosure.

Implementation work is deliberately separated into independently executable AB-01 through AB-15 tasks in the runbook. No step should be silently treated as permission to enable live autonomous payment.
