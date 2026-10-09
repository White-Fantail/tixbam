# TIXBAM Autonomous Booking — 단계별 실행 Runbook

Status: **Ready for sequential implementation, not deployed** · branch **dev**
Normative design: [AUTONOMOUS_BOOKING_DESIGN.md](AUTONOMOUS_BOOKING_DESIGN.md)
Schemas: [AUTONOMOUS_BOOKING_CONTRACTS.md](AUTONOMOUS_BOOKING_CONTRACTS.md)

## 사용 방법

다음 대화에서 **"AB-01 구현해"**, 이어서 **"AB-02 구현해"**처럼 명령한다. 각 명령은 **하나의 독립된 작업 단위**이며, ChatGPT가 변경된 저장소 상태를 먼저 재확인한 뒤 구현, 테스트, dev 커밋, 검증 결과를 보고한다. 테스트/보안 게이트 실패 시 다음 단계로 넘어가지 않는다.

### 매 단계 공통 작업 규칙

1. GitHub dev HEAD와 이전 단계의 완료 상태를 확인한다. main 변경 금지; 사용자가 명시적으로 요청할 때만 fast-forward merge.
2. 해당 단계가 지정한 모듈만 구현하되 필수 통합 변경/테스트를 빠뜨리지 않는다. 기존 메뉴, 예매 계획, 리허설, 인증과 기존 테스트 유지.
3. 기능은 기본 비활성 / 하위호환 / 안전 실패(fail-closed) 원칙. 알려지지 않은 제공업체, 사이트 레이아웃 또는 자동화 권한은 자동 조작하지 않는다.
4. 새 API/IPC 입력과 타입은 strict allowlist, sender/account/window/session 검증. 외부 페이지·AI 응답은 불신 데이터다. 카드/CVV/쿠키/원본 URL/OTP 유출과 로그 노출을 금지한다.
5. 변경분 관련 단위 테스트 + 가능하면 npm test, npm run build, Python tests 실행. CI에서 생긴 기존 인프라 실패와 새 회귀를 구분한다.
6. 단계마다 보고: 수정 파일, 새 계약/API, 테스트 결과, 남은 제한, dev 커밋 SHA, 다음 단계 시작 조건. 완료 체크리스트는 **통과한 증거가 있을 때만** 표시한다.
7. 사용자에게 배포/실제 결제/운영 자동화/실제 티켓팅 사이트 대량 테스트를 묻지 않고 임의 실행하지 않는다. 명시적 요청 없이 Railway/Vercel 배포와 main 머지 금지.

### 순서와 의존성

~~~text
AB-01 Permission/Capability
  ↓
AB-02 State machine → AB-03 Action Validator → AB-04 Observation
  ↓                                           ↓
AB-05 Durable journal → AB-06 Session coordination
  ↓
AB-07 Provider-neutral rehearsal / fixtures
  ↓
AB-08 OpenRouter planning contract → AB-09 Safe recovery executor
  ↓
AB-10 Offer & seat intelligence → AB-11 Desktop UX
  ↓
AB-12 Provider onboarding & qualification
  ↓ (licensed/authorized provider required before live work)
AB-13 PaymentExecutor integration gates → AB-14 Reconciliation
  ↓
AB-15 End-to-end release gates & rollout plan
~~~

AB-01–AB-11은 실제 구매/제공업체 접근 없이 개발 및 오프라인 검증 가능하다. AB-12는 정책 및 기술 검증 절차까지 먼저 구현하되, 권한 없는 사이트는 dry-run에만 사용. AB-13/14는 호스트 측 인터페이스와 모의 결제부터 구현하며 **실제 자율 결제는 별도 제공업체 허가 + 보안/결제 검증 전에는 금지**.

## AB-01 — 제공업체 Policy 및 Capability Registry

**명령:** "AB-01 구현해. docs/AUTONOMOUS_BOOKING_DESIGN.md와 RUNBOOK의 AB-01 기준대로 dev에 적용하고 테스트해."

**목표:** 현재 애드온의 level1/2/3 단순 문자열과 별개로 *제공업체의 허용 범위*와 *로컬 기술 검증 상태*를 분리해 표현한다.
**예상 파일:** services/api/app/models.py, schemas.py, admin.py (또는 automation_policies.py), migrations.py, apps/admin/app/automation/*, apps/desktop/addons/catalog.json (읽기/상태 연동), packages/addon-sdk/index.d.ts.
**구현:**
- vendor_policy table: providerId, region, action/capability, permissionState(restricted/unverified/permitted/revoked), evidenceUrl/reference, reviewDate/expiry, reviewer, revision, reason.
- reviewed implementation metadata: bundled addon version/profile, supported actions and verified status. 서버 외부 입력이 로컬 검증을 상승시키지 않게 한다.
- EffectivePolicy = permission ∩ reviewed capability ∩ user consent ∩ global kill switch; 모든 신규 라이브 액션은 기본 deny.
- 관리자 읽기/수정 UI, 변경 감사기록, public sanitized capability view; 역할 분리와 변경 권한 재검토.
**완료 조건:** 권한 미확인 Cityline/YES24/KKTIX은 자율 구매 불가; restricted NOL/Ticketmaster/AXS는 관리자 UI에서 단순 토글로 우회할 수 없음. 이벤트 업체(Live Nation)는 판매 에이전트로 위임. 권한 증거가 없으면 DENY. 기존 DB 업그레이드 멱등적.
**테스트:** unknown/revoked/expired/mismatched region/capability/manifest version/kill switch; existing admin API and crawler tests.
**Do not:** permission 자체를 임의로 "permitted" 입력하거나 실제 자동 구매 켜기.

## AB-02 — BookingOrchestrator FSM 및 이전 Runner 호환

**명령:** "AB-02 구현해. 안전한 상태 머신을 도입하고 기존 BookingRunner/리허설과 호환되도록 해."

**목표:** 유효하지 않은 예매 상태 전이, 취소/비동기 경합, 결제 후 재시도 방지.
**예상 파일:** apps/desktop/electron/booking/state-machine.cjs, orchestrator.cjs, runner.cjs, controller.cjs; tests electron/state-machine.test.cjs.
**구현:** DESIGN의 state enum 및 transition table, monotonically increasing revision, runGeneration/windowBinding, explicit terminal and payment-unknown transitions; existing renderer-compatible mapping. 하나의 run/window에서 in-flight mutating action 1개.
**완료 조건:** stale future/promise가 결제 상태를 덮지 않음; stop after attempted submit does not turn into safe retry; checkout flow before verified payment remains blocked.
**테스트:** property/transition matrix, concurrency race, cancellation mid-read/mid-execute, payment error, restart mapping.
**Do not:** Cityline 실사이트 자동화 능력/허가 상태 수정.

## AB-03 — Host Action Contract / ActionValidator

**명령:** "AB-03 구현해. 모든 AI/애드온 제안은 검증된 ActionProposal만 통과하게 만들어."

**목표:** AI가 직접 CSS selector, 좌표, JS 또는 결제를 실행할 경로 원천 차단.
**예상 파일:** packages/addon-sdk/index.d.ts, electron/booking/action-validator.cjs, action-registry.cjs, tests.
**구현:** actionKind allowlist, snapshotId/targetRef/observedAt/version, authority, preconditions, postconditions, user consent and policy revision; reasons and fail-closed typed errors. 실행은 reviewed host adapter만 가능. 결제 action은 AI contract에서 제외.
**완료 조건:** 잘못된 action, 임의 URL, stale version, crossed event, permission missing, max budget mismatch 모두 NO-OP + 설명 가능한 오류.
**테스트:** malicious prompt output, prototype pollution, arbitrary JS/selector injection, replay, unknown action, cross-window.
**Do not:** 웹페이지 텍스트에 포함된 instructions를 실행.

## AB-04 — Provider-neutral Observation Pipeline

**명령:** "AB-04 구현해. 안전한 ObservationV1 생성/마스킹/만료 검증을 도입해."

**목표:** DOM 대신 제한된 관찰 스키마를 Host가 표준화해 AI와 실행기에게 제공.
**예상 파일:** electron/booking/observation.cjs, observation-redaction.cjs, cityline.cjs (adapter compatibility), SDK observation contracts, tests.
**구현:** observed stage, challenges, verified target handles, option lists, price source, timestamp, binding and expiry, navigation generation. Observe-only, screenshot disabled default. 개인정보/URL/쿠키/hidden input whitelist reject.
**완료 조건:** 탭 이동 시 snapshot action invalid; provider/plan/event 검증; 비밀정보 zero output; 모르는 요소는 unknown.
**테스트:** login/captcha/queue/3DS/hidden fields; oversized DOM, malicious text, navigation race, stale identity.
**Do not:** 원본 HTML/스크린샷을 OpenRouter에 무조건 전송.

## AB-05 — 로컬 Durable Booking Journal

**명령:** "AB-05 구현해. 실제 지불 시도 전 영구 저장되는 Transaction Safety Ledger를 만들어."

**목표:** 앱 강제 종료 후 결제 중복 요청 가능성을 차단.
**예상 파일:** electron/booking/journal.cjs, payment-attempts.cjs, controller.cjs, runner.cjs, tests.
**구현:** append-only fsync-before-submit, 0600 file permission, schemaVersion/migration, permit/order digests, COMMIT_INTENT_RECORDED -> PAYMENT_UNKNOWN/CONFIRMED, bounded retention without deleting unresolved attempts. fsync 실패 시 결제 진행 금지. sensitive payload ban.
**완료 조건:** commit-intent부터 앱 종료/재실행/Stop/인터넷 오류 후 같은 의도로 재결제하지 않음; UI가 미확인 결제를 표시.
**테스트:** crash at every step via fault injection, duplicate attempt, corrupted/truncated journal, disk full/fsync failure.
**Do not:** real card/order URLs or CVV/OTP persist.

## AB-06 — 동시 실행 및 멀티 윈도우 소유권

**명령:** "AB-06 구현해. 사용자/공연/회차 별 중복 구매를 차단하도록 Run Lock과 소유권을 구현해."

**목표:** 동일 계정/동일 판매 목표를 여러 창에서 열어도 구매 제출 1개만 허용.
**예상 파일:** electron/booking/session-coordinator.cjs, window-binding.cjs, main.cjs, controller.cjs, tests; 필요 시 backend non-secret lease API.
**구현:** account+seller+sale+performance+intent key, per-window owner, fenced lock, cancellation and takeover semantics. 다른 기기에서 자동 구매 시 server lease 필요하고 API outage 시 auto-pay deny. 복구 시 stale lease/memory never re-submit.
**완료 조건:** 두 창 또는 두 프로세스의 중복 commit deny; 대기열/로그인 창을 임의 닫지 않음; 별도 회차는 유효한 구매 조건 내 독립 실행 가능.
**테스트:** windows concurrent, stale IPC sender, app crash + lease timeout, account switch.
**Do not:** lease expiry를 결제 재제출 근거로 사용.

## AB-07 — 모든 애드온 공통 오프라인 리허설

**명령:** "AB-07 구현해. 검증된 Action/FSM을 사용하는 공통 Rehearsal Driver를 만들어."

**목표:** provider-neutral 단계/오류/구매 정책을 실제 사이트에 접속하지 않고 재현.
**예상 파일:** electron/booking/rehearsal-driver.cjs, fixtures/*, src/rehearsal/*, SDK fixtures, tests.
**구현:** fake browser observations, fake inventory/seat modes (assigned/standing/automatic), fake payment, 3DS/user handoff, sold out, fees change, timeout, queue/manual captcha, stale state, artificial crashes.
**완료 조건:** Cityline 별도 리허설 창 동작 유지; 모든 신규 애드온은 같은 시뮬레이션 인터페이스를 사용; real card/network/payment execution = 0.
**테스트:** deterministic seeded scenarios, quantity, budget, seat constraints, unknown charge, UI completion persistence.
**Do not:** production ticket provider를 rehearsal test target으로 이용.

## AB-08 — OpenRouter PlannerV1

**명령:** "AB-08 구현해. Admin 기능별 모델 설정을 이용해 AI가 ActionProposal만 반환하는 PlannerV1을 추가해."

**목표:** 조언 API는 보존하면서 별도 structured action planning 기능 도입.
**예상 파일:** services/api/app/ai_planner.py, ai.py, models.py, app/main.py, apps/admin/app/ai/*, apps/desktop/electron/booking/ai-planner.cjs, tests.
**구현:** authenticated POST /v1/ai/plans, strict schema typed ProposalV1, model feature check, per-user/run quota/cost guard, timeout/dedupe, snapshot binding, locale ko/en, token-safe failure, Admin task model choice and kill switch.
**완료 조건:** malformed tool responses and prompt injections denied; model is never able to invoke host actions directly; no screenshot/HTML/secret payload; old /v1/ai/advice unchanged.
**테스트:** mock OpenRouter valid/invalid/timeout/5xx, model lacks structured output, server policy disabled, cost/quota, stale snapshot.
**Do not:** allow generative response to call shell/devtools, payment or arbitrary browser actions.

## AB-09 — 제한적 AI 자동 복구

**명령:** "AB-09 구현해. AI가 제안한 안전한 복구만 Host Validator를 통과해서 실행하도록 연결해."

**목표:** 검증된 허용 동작에 한해 AI planning→execute→postcondition 검사 자동화.
**예상 파일:** electron/booking/recovery.cjs, orchestrator.cjs, action-validator.cjs, src/booking/*, tests.
**구현:** dry-run/rehearsal first, action allowlist: WAIT, REOBSERVE, ASK_USER, STOP, RETURN_TO_VERIFIED_STEP where provider approval exists; selection actions require policy. Strict maxAttempts and step deadlines; failed postcondition => manual takeover.
**완료 조건:** no uncontrolled loops, browser reload on queue, CAPTCHA solver, unauthorized navigation or terms acceptance; unknown page => user.
**테스트:** page button text changes, seat sold out, stale snapshot, queue, virtual session expired, injected malicious instructions.
**Do not:** turn AI recommendation into unrestricted executor.

## AB-10 — 좌석 선택 및 Offer Ranking

**명령:** "AB-10 구현해. 가격·수수료·좌석 타입을 포함한 범용 Offer/Seat Policy와 자동 선택 규칙을 추가해."

**목표:** provider-agnostic normalized offer schema; exact hard constraints then preference ranking.
**예상 파일:** packages/addon-sdk/index.d.ts, electron/booking/offer-policy.cjs, preferences.cjs, tests, simulator fixtures.
**구현:** performance/price/section/floor/seat mode/adjacency/real-name/restricted-view/delivery/fees, standing vs assigned vs auto allocation; unknown total fail; currency minor units; deterministic sorting with explicit fallbacks; cart refresh before checkout.
**완료 조건:** quantity=1/2, incompatible currencies, sold out, fees change and restricted-view handled; AI cannot relax conditions.
**테스트:** generative offer variants, no stable seat labels, invalid adjacency, secondary tier fallback consent, optional extras.
**Do not:** claim a provider has verified seat-map support until separately proven.

## AB-11 — Desktop UX: 권한, 진행 상태, 인계

**명령:** "AB-11 구현해. Desktop에 안전한 자동화 모드/사전승인/진행 이력/사용자 인계 화면을 만들어."

**목표:** end user chooses intent, not AI model. Korean default and English i18n.
**예상 파일:** apps/desktop/src/BookingWorkspace.tsx, LiveBookingWorkspace.tsx, src/booking/*, src/i18n/*, electron/preload.cjs, main.cjs, types.ts.
**구현:** mode selection per effective capability (manual/supervised/conditional-auto), immutable one-shot Permit preview & approval, final total/fees and restricted-view confirmation, timeline and manual action notices; unknown payment blocks re-purchase; kill switch visible.
**완료 조건:** disabled/pending provider does NOT show actionable unattended checkout; all final buttons gated; no extra model settings; keyboard/narrow-width/i18n tested.
**테스트:** renderer type/build, consent expiry, challenge/3DS, closing app during payment, signout, screen reader labels.
**Do not:** accept unchecked prefilled unconditional consent.

## AB-12 — 제공업체 Adapter 인증 절차와 템플릿

**명령:** "AB-12 구현해. 새로운 티켓팅 애드온을 인증된 capability 단위로 추가할 수 있는 도구·테스트 템플릿을 만들어."

**목표:** provider introduction requires evidence and tests rather than hidden ad-hoc selectors.
**예상 파일:** packages/addon-sdk/*, electron/booking/provider-runtime.cjs, addons/catalog.json, docs/provider-onboarding.md, fixture harness, CI.
**구현:** versioned observation/action/payment capability profiles, host allowlist, route/event identity checks, permission evidence verification, signed/reviewed bundled manifest (or equivalent package verification), fixtures contract tests and invalidation on version drift.
**완료 조건:** new provider can be simulated without core changes; unverified actions never auto-execute; no arbitrary downloaded add-on JS runs.
**테스트:** unknown addon, update downgrades, wrong origins, Live Nation ticket-agent handoff, revoked permission.
**Do not:** attempt undocumented live checkout tests on forbidden providers.

## AB-13 — 결제 Executor 인터페이스와 승인 Gate

**명령:** "AB-13 구현해. 먼저 모의 결제와 허가 게이트만 연결하는 PaymentExecutor를 만들어. 실제 결제는 활성화하지 마."

**목표:** checkout isolated from AI and provider adapter. **First pass uses fake payment only.**
**예상 파일:** electron/booking/payment-executor.cjs, payment-policy.cjs, journal.cjs, vault.cjs (review-only as needed), SDK types, tests.
**구현:** prepare, submitOnce, verify interfaces; immutable order digest; host-held payment permission; official integration allowlist; fsync-before-submit, no-retry, kill switch, manual bank challenge. PCI/card storage review checklist; avoid expanding PAN/CVV handling until certified/approved flow is available.
**완료 조건:** test payment mock exactly once; missing official provider permission/verified payment mapping must cause fail-closed; no real charges, no stored CVV in outputs.
**테스트:** expired consent, payment order changed, two simultaneous submit, crash-before/after commit intent, bank challenge, disabled mode.
**Do not:** implement live Cityline payment guesses or enable payment from an admin checkbox.

## AB-14 — 공식 구매 결과 검증과 Reconciliation

**명령:** "AB-14 구현해. UNKNOWN 결제 상태와 주문 조회/사용자 확인 절차를 구현해. 자동 재결제는 금지해."

**목표:** unknown is never represented as failed/confirmed without authoritative evidence.
**예상 파일:** electron/booking/reconciliation.cjs, journal.cjs, orchestrator.cjs, src/booking/*, tests.
**구현:** verified receipt/order snapshot vs original permit/cart fingerprint, idempotent official status lookup only if supported, human review flow, durable unresolved debt/tombstone, startup warning.
**완료 조건:** no payment repeat on timeout/crash/HTTP 500; confirmation requires matching official evidence; unknown blocks re-purchase of same logical target until verified/manual resolution.
**테스트:** inconsistent receipt, double-click, reboot, missing receipt, signed-out user, authorized official lookup, no idempotency.
**Do not:** infer purchase success from AI response or generic page text.

## AB-15 — 통합 검수, 지표, 안전한 배포 준비

**명령:** "AB-15 실행해. 전체 E2E/보안/장애 주입 검증과 업체별 release readiness 보고서를 만들어. 운영 자동결제는 켜지 마."

**목표:** production readiness objectively assessed, not silently enabled.
**예상 파일:** end-to-end test harness, CI, docs/release-readiness.md, ops dashboards/monitoring docs.
**구현:** fixture-based E2E, fuzzed hostile HTML, crash/fault injection at payment boundaries, macOS packaged QA, data minimization audit, OpenRouter latency+cost, accessibility/i18n, provider permission ledger review and rollback/kill switch drill.
**완료 조건:** documented gates A–D with evidence. Require written/sufficient documented vendor permission, approved payment channel, operator go/no-go, transaction-support runbook before any live transaction.
**테스트:** global pipeline plus manual packaged Electron; tests must not buy real tickets.
**Do not:** deploy production autonomous checkout as a side effect.

## 진도 확인 및 다음 단계 찾기

- 현 단계: **design only — no AB implementation started**.
- 진행 체크리스트 (작업 완료 후 근거와 커밋을 기록할 것):
  - [ ] AB-01 Provider Policy
  - [ ] AB-02 State Machine
  - [ ] AB-03 Action Validator
  - [ ] AB-04 Observation
  - [ ] AB-05 Journal
  - [ ] AB-06 Session Coordinator
  - [ ] AB-07 Offline Rehearsal
  - [ ] AB-08 AI Planner
  - [ ] AB-09 Recovery Engine
  - [ ] AB-10 Seat/Offer Policy
  - [ ] AB-11 Desktop UX
  - [ ] AB-12 Provider Onboarding
  - [ ] AB-13 Gated Payment Executor (mock)
  - [ ] AB-14 Reconciliation
  - [ ] AB-15 Security/E2E Release Readiness

**첫 명령:** "AB-01 구현해." 그 이후 "AB-02 구현해."처럼 진행. 필요하면 "AB-05 진행 상황 확인해." / "AB-09 테스트 강화해." / "AB-01~AB-05 설계와 구현 비교 검토해."도 가능하다.
