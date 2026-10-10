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

**완료 기록 (2026-10-10):**
- 구현: `provider_automation_policies`, `provider_automation_audit`, `automation_safety_settings` (SQLAlchemy create_all 기반 신규 테이블, 기존 DB 호환); `/v1/admin/automation/providers`, `/{providerId}/policies` GET/PUT, `/kill-switch` PUT, `/v1/automation/capabilities` 공개 상태 조회.
- Admin: `/automation` 및 `/automation/[providerId]` 정책/근거/감사 이력/안전 스위치. 유효한 관리자 API 키로만 수정 가능; 현재 관리자 키는 개별 작업자 신원을 증명하지 않으므로 reviewer는 참고용 메모.
- Desktop: 본체가 고정한 Cityline 버전/프로파일의 로컬 기술 검증 목록, 신규 무인 라이브 자동 결제 차단. 기존 수동 검토 및 리허설은 그대로 유지.
- 강제 기본 정책: 모든 제공업체의 자율 실행 거부. NOL/Ticketmaster/AXS의 기존 제한은 Admin 단순 편집으로 해제 불가; Live Nation은 실제 판매 에이전트로 위임. `permitted` 부여 경로는 제공하지 않으며, 이후 AB-12의 독립 검증/서명 검토가 필요.
- 동시 수정: revision 기반 CAS와 감사 이력; 정책 기한 만료/오래된 요청은 거부.
- 검증: `a5cf93d201ee41f64274106a07e47f2bf25e12fb` CI Python-services + desktop-admin **SUCCESS** ([GitHub Actions](https://github.com/White-Fantail/tixbam/actions/runs/38005977295)); 운영 사이트/실제 결제 테스트 없음.
- **잔여 경계:** 신규 관리 화면은 기록·차단용; 정책 승인 워크플로, 신원별 관리자 감사, 서버-Desktop 권한 배포/서명, 자동 실행 엔진은 후속 단계. Global kill switch를 OFF로 기록해도 자율 실행은 사용 불가.


## AB-02 — BookingOrchestrator FSM 및 이전 Runner 호환

**명령:** "AB-02 구현해. 안전한 상태 머신을 도입하고 기존 BookingRunner/리허설과 호환되도록 해."

**목표:** 유효하지 않은 예매 상태 전이, 취소/비동기 경합, 결제 후 재시도 방지.
**예상 파일:** apps/desktop/electron/booking/state-machine.cjs, orchestrator.cjs, runner.cjs, controller.cjs; tests electron/state-machine.test.cjs.
**구현:** DESIGN의 state enum 및 transition table, monotonically increasing revision, runGeneration/windowBinding, explicit terminal and payment-unknown transitions; existing renderer-compatible mapping. 하나의 run/window에서 in-flight mutating action 1개.
**완료 조건:** stale future/promise가 결제 상태를 덮지 않음; stop after attempted submit does not turn into safe retry; checkout flow before verified payment remains blocked.
**테스트:** property/transition matrix, concurrency race, cancellation mid-read/mid-execute, payment error, restart mapping.
**Do not:** Cityline 실사이트 자동화 능력/허가 상태 수정.

**완료 기록 (2026-10-10):**
- `apps/desktop/electron/booking/state-machine.cjs`: 이벤트 기반 허용 전이 표, 16개 내부 Phase, 단조 증가 revision, 원 실행 ID 검증, 종료/취소 불변식 및 결제 시도 이후 `PAYMENT_UNKNOWN` 잠금.
- `apps/desktop/electron/booking/orchestrator.cjs`: 공통 실행 조정 계층, 중복 tick 거부, AbortSignal/실행 generation, 창 소유권 검사, 늦은 비동기 응답 무시, 변경 이벤트 스냅샷. 상태의 외부 `status` 값은 기존 UI 호환.
- `runner.cjs`와 `controller.cjs`를 호스트 FSM에 연결하고 정확한 plan/window binding을 런 시작과 각 단계에서 다시 확인. CAPTCHA/은행 인증 재개 과정에서 `confirm=true`로 구매 검토를 우회하는 경로 차단.
- `BookingRun` SDK 타입에 optional `phase/revision/generation` 추가. 기존 시티라인의 공개 옵션 자동화 수준/라이브 결제 비활성 정책은 유지.
- 결제 시도 완료 여부가 불확실할 때 `STOP/FAIL`은 `PAYMENT_UNKNOWN`; 성공은 실제 주문 일치 + 제공업체 receipt 확인 이후에만 표시. 보안정보 지우기는 종료당 1회.
- 검증: `b8c090dbdb64cae48bc2731187cf89ec5150a7a5` CI **SUCCESS** ([GitHub Actions](https://github.com/White-Fantail/tixbam/actions/runs/38006854354)); Desktop 85/85, API/MCP 29/29, crawler 3/3, build 성공. 테스트는 offline mocks, 실제 구매 없음.
- **한계/다음 단계:** 현재 FSM은 프로세스 메모리 상태. 앱 재시작/크래시 간 결제 제출 중복 방지는 AB-05의 fsync Journal 없이는 보장할 수 없다. 다중 프로세스/기기 purchase lock은 AB-06; AI 명령 Validator는 AB-03; 사이트별 실제 seat/payment verification은 후속 단계. 현재 무인 라이브 결제는 차단 상태.


## AB-03 — Host Action Contract / ActionValidator

**명령:** "AB-03 구현해. 모든 AI/애드온 제안은 검증된 ActionProposal만 통과하게 만들어."

**목표:** AI가 직접 CSS selector, 좌표, JS 또는 결제를 실행할 경로 원천 차단.
**예상 파일:** packages/addon-sdk/index.d.ts, electron/booking/action-validator.cjs, action-registry.cjs, tests.
**구현:** actionKind allowlist, snapshotId/targetRef/observedAt/version, authority, preconditions, postconditions, user consent and policy revision; reasons and fail-closed typed errors. 실행은 reviewed host adapter만 가능. 결제 action은 AI contract에서 제외.
**완료 조건:** 잘못된 action, 임의 URL, stale version, crossed event, permission missing, max budget mismatch 모두 NO-OP + 설명 가능한 오류.
**테스트:** malicious prompt output, prototype pollution, arbitrary JS/selector injection, replay, unknown action, cross-window.
**Do not:** 웹페이지 텍스트에 포함된 instructions를 실행.

**완료 기록 (2026-10-10):**
- `packages/addon-sdk/index.d.ts`: `ActionProposalV1`, `ProposedActionKind`, `IssuedActionSnapshotV1`, `ActionDecision` 공통 타입.
- `apps/desktop/electron/booking/action-validator.cjs`: 호스트 생성 불투명 snapshot/target IDs, 전이 revision, 페이지 generation, 제한시간, 실행 사용자/창/계획/업체/이벤트 및 정책 revision 바인딩. 엄격한 필드 허용 목록, 단일 사용 토큰, 통화/예산/수량/수수료 검증.
- `apps/desktop/electron/booking/action-registry.cjs`: 제3자/AI가 실행 함수를 등록할 수 없는 정적 호스트 실행 레지스트리. WAIT/REOBSERVE/ASK_USER/STOP은 조언만 반환. 테스트 전용 가상 RehearsalAdapter offer reserve는 실행 직전 재관찰과 postcondition 확인 후 1회 실행.
- 기존 BookingRunner의 직접 options/reserve에 FSM 상태/이벤트/허용된 오퍼 사전검증 추가. Cityline과 기존 리허설 호환, AB-01의 운영 자율 결제 차단 유지.
- 공격 회귀: 임의 코드/selector/URL/결제 명령, prototype 오염, stale snapshot, 권한/승인 불일치, 가격/재고 변경, 동시 실행/재사용, 창/이벤트 불일치.
- 검증 커밋 `9a0563b299656e9c007df08d90c1e15a9658339b`: [GitHub Actions](https://github.com/White-Fantail/tixbam/actions/runs/38008129200) SUCCESS (Desktop 96/96, API/MCP 29/29, crawler 3/3, Desktop/Admin build).
- **범위 제한:** 호스트 계약/테스트 전용 실행까지 구현. 실제 AI 제안 생성은 AB-08, 실제 화면 관찰은 AB-04, 안전한 복구 연결은 AB-09. 업체 허가나 실결제를 새로 활성화하지 않았음.

## AB-04 — Provider-neutral Observation Pipeline

**명령:** "AB-04 구현해. 안전한 ObservationV1 생성/마스킹/만료 검증을 도입해."

**목표:** DOM 대신 제한된 관찰 스키마를 Host가 표준화해 AI와 실행기에게 제공.
**예상 파일:** electron/booking/observation.cjs, observation-redaction.cjs, cityline.cjs (adapter compatibility), SDK observation contracts, tests.
**구현:** observed stage, challenges, verified target handles, option lists, price source, timestamp, binding and expiry, navigation generation. Observe-only, screenshot disabled default. 개인정보/URL/쿠키/hidden input whitelist reject.
**완료 조건:** 탭 이동 시 snapshot action invalid; provider/plan/event 검증; 비밀정보 zero output; 모르는 요소는 unknown.
**테스트:** login/captcha/queue/3DS/hidden fields; oversized DOM, malicious text, navigation race, stale identity.
**Do not:** 원본 HTML/스크린샷을 OpenRouter에 무조건 전송.

**완료 기록 (2026-10-10):**
- `apps/desktop/electron/booking/observation.cjs`: 호스트 전용 `ObservationPipeline` 구현. verified provider/origin/event/window/plan/run 제약, 탐색 중 read 결과 폐기, URL 또는 페이지 내 탐색 시 snapshot/AI token 무효화. 같은 URL에서 options 변경은 다음 read에서 fingerprint 차이로 감지; 각 read-only capture는 이전 action snapshot을 무효화함.
- `observation-redaction.cjs`: raw DOM/HTML/스크린샷/쿠키/인증값/수신된 문구를 AI 페이로드에서 제거하고 Stage/Challenge/Confidence/옵션 수/임시 task token만 출력. 개인정보를 포함한 label, 실제 행사ID·계정ID·창ID·금액·주문ID는 AI projection에 포함하지 않음. 외부 전송은 구현되지 않음.
- `cityline.cjs`: 실제 검증된 eventDetail의 버튼/가격 날짜 selector만 읽고 30개 한도로 제한. 로그인, CAPTCHA, 공식 대기열, 은행 인증의 coarse enum 감지. 이벤트/URL 이동 중 조회 거부. 좌석/결제 영역의 신규 파싱·클릭 권한 없음.
- `controller.cjs` / `runner.cjs`: 기존 read 경로에서 추가 웹 요청 없이 read-only 상태 추적, 닫힌 창/앱 종료 시 관찰 해제. 로그인 계정 교체/로그아웃 시 남은 토큰 폐기. 기존 예매와 별도 리허설 호환.
- `packages/addon-sdk/index.d.ts`: `HostObservationV1`, `AIObservationV1`, `ObservationChallenge`, `ObservationTargetKind` 추가. Host 내부 ID/데이터와 AI 전용 최소 스키마 분리.
- CI: 구현 및 DOM/악성 입력·과도한 요소·이벤트 미일치·NAV 경합·로그인/3DS/CAPTCHA/queue·만료·변경/PII 유출 방지 테스트가 [GitHub Actions](https://github.com/White-Fantail/tixbam/actions/runs/38009562201)에서 성공 (Desktop 110/110, API/MCP 29/29, Crawler 3/3, Desktop/Admin builds). 실 결제/예매 없음.
- **한계:** 내용 변경은 재관찰 시 fingerprint로 감지하고 즉시 모든 DOM Mutation을 구독하지 않음. 라이브 snapshot을 OpenRouter에 전송하는 기능·권한은 여전히 차단. 판매 사이트별 자동 실행 권한과 검증된 seat/payment 처리는 후속 AB-08/09/12/13. AB-05의 크래시 후 결제 재시도 차단 Ledger 미구현.

## AB-05 — 로컬 Durable Booking Journal

**명령:** "AB-05 구현해. 실제 지불 시도 전 영구 저장되는 Transaction Safety Ledger를 만들어."

**목표:** 앱 강제 종료 후 결제 중복 요청 가능성을 차단.
**예상 파일:** electron/booking/journal.cjs, payment-attempts.cjs, controller.cjs, runner.cjs, tests.
**구현:** append-only fsync-before-submit, 0600 file permission, schemaVersion/migration, permit/order digests, COMMIT_INTENT_RECORDED -> PAYMENT_UNKNOWN/CONFIRMED, bounded retention without deleting unresolved attempts. fsync 실패 시 결제 진행 금지. sensitive payload ban.
**완료 조건:** commit-intent부터 앱 종료/재실행/Stop/인터넷 오류 후 같은 의도로 재결제하지 않음; UI가 미확인 결제를 표시.
**테스트:** crash at every step via fault injection, duplicate attempt, corrupted/truncated journal, disk full/fsync failure.
**Do not:** real card/order URLs or CVV/OTP persist.


**완료 기록 (2026-10-10):**
- `apps/desktop/electron/booking/journal.cjs`: 호스트 전용 v1 JSONL append-only Journal, monotonic seq + SHA-256 hash chain, 전용 0700 폴더 / 0600 파일, 랜덤 256-bit 로컬 HMAC fingerprint key, 배치 기록 후 파일 fsync 및 디렉터리 fsync. 위험한 symlink/권한·키 또는 로그 누락, tail 절단/변조, 저장 한도 초과, 남겨진 exclusive lock을 자동 수리하지 않고 결제 차단.
- `payment-attempts.cjs`: `RUN_CREATED → OFFER_LOCKED → COMMIT_INTENT_RECORDED` 원자적 기록; 계정+실제 업체+sale+event+performance HMAC 범위의 1회 제출 예약. 별도 plan/예산/수량으로 우회하여 동일 공연에 다시 자동 결제 시도하는 것도 거부. 확인되지 않은 제출/종료/복구는 `PAYMENT_UNKNOWN`. 실결제 영수증 자동 확정은 금지하고 리허설 합성 영수증만 별도 검증.
- `runner.cjs`: 실제 결제 동작 전에 synchronous `recordCommitIntent`가 fsync 성공해야만 `COMMIT_STARTED` 전이. Journal 없거나 실패하면 실결제 호출하지 않음. 제출 후 오류·Stop 시 안전한 UNKNOWN으로 잠금. 기존 합성 리허설은 결제 없이 유지.
- `controller.cjs`: 계정/카드/주문 실데이터를 Journal에 기록하지 않음. 앱 재시작 시 unresolved intent를 `list-bookings`의 읽기 전용 `payment_unknown`으로 표시. 손상된 Journal을 빈 상태로 취급하지 않고 안전성 경고 표시; 자동 제출은 차단. 사용자가 공식 주문 내역을 직접 확인해야 함.
- `packages/addon-sdk/index.d.ts`: recovered attempt와 payment intent 타입 추가; renderer가 Journal이나 결제 제출 함수를 호출할 수 없음.
- 테스트: 중단 시점(fsync 이전/이후), partial write, 복구 중 중복 시도, 두 프로세스 충돌, 파일 손상·삭제·권한·symlink, 총액·수수료 미확인, 자동 결제 전/후 Stop, 합성 리허설, Desktop 재시작 후 경고. CI [GitHub Actions](https://github.com/White-Fantail/tixbam/actions/runs/38010430610) **SUCCESS**, Desktop 128/128, API/MCP 29/29, Crawler 3/3, Desktop/Admin 빌드 통과.
- **범위와 안전 한계:** 한 기기/한 로컬 저장소 내의 자동 제출만 보호. 다른 기기와 동기화하지 않음(AB-06). 공식 제공업체 조회로 실제 청구 여부를 판정하는 Reconciliation은 AB-14. lock 잔여/손상 기록은 운영자 검증 없이 자동 제거 금지. 전체 기록이 가득 차면 삭제 대신 새 결제 제출을 차단. 사용자가 직접 업체 웹사이트에서 수동 결제하는 것까지 차단할 수는 없음. AB-01 정책에 따라 라이브 무인 자동 결제는 여전히 비활성.


## AB-06 — 동시 실행 및 멀티 윈도우 소유권

**명령:** "AB-06 구현해. 사용자/공연/회차 별 중복 구매를 차단하도록 Run Lock과 소유권을 구현해."

**목표:** 동일 계정/동일 판매 목표를 여러 창에서 열어도 구매 제출 1개만 허용.
**예상 파일:** electron/booking/session-coordinator.cjs, window-binding.cjs, main.cjs, controller.cjs, tests; 필요 시 backend non-secret lease API.
**구현:** account+seller+sale+performance+intent key, per-window owner, fenced lock, cancellation and takeover semantics. 다른 기기에서 자동 구매 시 server lease 필요하고 API outage 시 auto-pay deny. 복구 시 stale lease/memory never re-submit.
**완료 조건:** 두 창 또는 두 프로세스의 중복 commit deny; 대기열/로그인 창을 임의 닫지 않음; 별도 회차는 유효한 구매 조건 내 독립 실행 가능.
**테스트:** windows concurrent, stale IPC sender, app crash + lease timeout, account switch.
**Do not:** lease expiry를 결제 재제출 근거로 사용.

**완료 기록 (2026-10-10):**
- FastAPI: purchase_intent_leases 테이블과 인증된 /v1/me/automation/leases/acquire, renew, release, claim, GET 구현. 소유자 계정의 등록 Booking Plan, 업체, 판매 및 연결된 회차 검증. 브라우저 쿠키·카드·세션·주문 원문은 서버에 저장하지 않음.
- DB에서 user/provider/sale/performance 유니크 키와 compare-and-swap을 사용. 결제 전 만료 lease만 takeover 가능하며 fencingToken 단조 증가. 이전 owner/lease token/fencing 번호의 renew/release/claim은 거부.
- 서버 claim은 영구 claimed 상태: 임대 만료 또는 앱 재실행 시에도 새 결제 시도 불허. 구매 전 서버 claim 확인 -> AB-05 로컬 fsync -> 결제 실행 순서. 실패하거나 응답이 불분명하면 자동 재시도 금지.
- Desktop SessionCoordinator: 창+실제 공연/판매 단위 단일 소유권, 비동기 중복 시작 차단, 45초 lease/갱신, Stop/계정 전환/창 닫힘 시 무효화. 인증된 계정의 Booking Plan을 매번 온라인 조회. 서버 장애/불일치 시 자동 수행 중단, 실제 사이트 수동 이용만 가능. 큐/로그인 브라우저 창은 닫지 않음.
- 기존 오프라인 리허설은 로컬에서 동작하며 서버 lease가 필요하지 않음. 운영 환경의 무인 자동 결제는 계속 차단.
- 검증: 다중 창/기기 간 중복, 사용자 격리, 다른 공연의 독립 소유권, stale fencing, lease 만료 takeover, 서버 claim 고정, 네트워크 장애, 동시 시작, 중단·후행 응답, 기존 리허설 회귀.
- 한계: 동일 TixBam 사용자 계정의 자동 실행만 조정. 다른 계정이나 예매처에서 직접 구매하는 행위는 막지 못함. 네트워크 분할 시 판매처 수준 exactly-once를 보장하지 않으며 결제 결과 검증은 AB-14 책임.

## AB-07 — 모든 애드온 공통 오프라인 리허설

**명령:** "AB-07 구현해. 검증된 Action/FSM을 사용하는 공통 Rehearsal Driver를 만들어."

**목표:** provider-neutral 단계/오류/구매 정책을 실제 사이트에 접속하지 않고 재현.
**예상 파일:** electron/booking/rehearsal-driver.cjs, fixtures/*, src/rehearsal/*, SDK fixtures, tests.
**구현:** fake browser observations, fake inventory/seat modes (assigned/standing/automatic), fake payment, 3DS/user handoff, sold out, fees change, timeout, queue/manual captcha, stale state, artificial crashes.
**완료 조건:** Cityline 별도 리허설 창 동작 유지; 모든 신규 애드온은 같은 시뮬레이션 인터페이스를 사용; real card/network/payment execution = 0.
**테스트:** deterministic seeded scenarios, quantity, budget, seat constraints, unknown charge, UI completion persistence.
**Do not:** production ticket provider를 rehearsal test target으로 이용.

**완료 기록 (2026-10-10):**
- `apps/desktop/electron/booking/rehearsal-fixtures.cjs`: 모든 provider에 공통으로 제공되는 고정 14개 오프라인 시나리오(정상, 대기열, 매진, 가격/수수료 변경, CAPTCHA, 3DS, 타임아웃, 미확인 결제, 재시작, 스탠딩, 자동 배정, 비인접 좌석, 선택 중 재고 변경). seed 기반 가상 좌석과 수수료 포함 가상 견적.
- `rehearsal-driver.cjs`: 실제 AB-02 BookingRunner/FSM과 AB-03 deterministic host action guard, AB-05 Ledger를 사용하는 synthetic adapter/driver. 실예매처 요청/실카드/실결제 경로 없음. 각 run은 userData 하위 별도 `rehearsal-lab` 디렉터리에서 가상 Journal을 기록하며 운영 `booking-safety`와 혼용하지 않음.
- 재시작 복구: versioned 마지막 가상 상태 파일을 atomic rename/fsync로 보관. 앱이 다시 시작돼도 실행 중이던 Runner/결제 실행 권한은 복구하지 않고, 실제 가상 Journal에 미확인 commit이 있으면 `payment_unknown`으로 고정. 사용자는 기존 실행을 다시 submit할 수 없음; 다른 시드로 새 mock 연습은 가능.
- `main.cjs`/`rehearsal-preload.cjs`: 기존 별도 리허설 BrowserWindow의 main-frame sender를 검증한 좁은 IPC만 공개. 정적 시나리오 선택/step/사용자 인증 재개/모의 주문 확인/Stop/재시작만 가능. 원격 URL/셀렉터/JS/카드 데이터/클라우드 토큰/결제 실행 IPC 없음.
- `src/rehearsal/ScenarioLab.tsx`/`RehearsalApp.tsx`: Cityline 기존 화면형 리허설과 공통 Stress Lab 모드 전환, 14개 시나리오 선택·seed·단계/주문/안전 경고/실행 기록, 한국어 기본/영어 선택, 모의 완료 기록의 기존 Booking Plan 저장 흐름 연계. Stress Lab에서는 기존 OpenRouter AI Advisor를 숨겨 외부 전송 없음.
- `booking-rehearsal-driver.test.cjs` 회귀: fake inventory/assigned/standing/automatic, quantity/예산/연석 제한, 가격/수수료 drift, queue/CAPTCHA/3DS 인간 인증, timeout/unknown outcome 단일 제출, 실행 중 Stop, 가상 크래시 후 복구, PII 누출 금지, 네트워크 호출 0. 기존 Cityline 리허설도 계속 동작.
- **범위 제한:** Cityline 실제 사이트나 타 제공업체의 정확한 좌석 맵을 복제하는 기능이 아님. 연습 결과는 공식 구매·결제 성공 증거가 아니다. 제공업체 자동화 허가, AI 플래너, 라이브 결제는 활성화하지 않음. 다음 AB-08 단계에서 AI 명령 제안을 별도 검증하되 실행은 그대로 차단.
- 검증된 구현 CI: [GitHub Actions](https://github.com/White-Fantail/tixbam/actions/runs/38015384097) Desktop 154/154, API/MCP 30/30, crawler 3/3, Desktop/Admin 빌드 성공. 이후 한국어 안내 보강과 문서 추가 포함 최종 CI 재확인.

## AB-08 — OpenRouter PlannerV1

**명령:** "AB-08 구현해. Admin 기능별 모델 설정을 이용해 AI가 ActionProposal만 반환하는 PlannerV1을 추가해."

**목표:** 조언 API는 보존하면서 별도 structured action planning 기능 도입.
**예상 파일:** services/api/app/ai_planner.py, ai.py, models.py, app/main.py, apps/admin/app/ai/*, apps/desktop/electron/booking/ai-planner.cjs, tests.
**구현:** authenticated POST /v1/ai/plans, strict schema typed ProposalV1, model feature check, per-user/run quota/cost guard, timeout/dedupe, snapshot binding, locale ko/en, token-safe failure, Admin task model choice and kill switch.
**완료 조건:** malformed tool responses and prompt injections denied; model is never able to invoke host actions directly; no screenshot/HTML/secret payload; old /v1/ai/advice unchanged.
**테스트:** mock OpenRouter valid/invalid/timeout/5xx, model lacks structured output, server policy disabled, cost/quota, stale snapshot.
**Do not:** allow generative response to call shell/devtools, payment or arbitrary browser actions.

**완료 기록 (2026-10-10):**
- `services/api/app/ai_planner.py`: 인증된 `POST /v1/ai/plans` 생성. AB-04 `AIObservationV1`만 허용하는 Pydantic `extra=forbid` 스키마; `rehearsal=true`만 허용. 요청 ID·Run nonce·Snapshot ID는 서버 바인딩에만 쓰고 모델 프롬프트에서 제외. 모델에는 `locale` 및 `stage/challenge/confidence/optionCounts/opaque task target token`만 전달. 원본 HTML/URL·자격 증명·카드·시트·금액·계정·Run 정보 없음.
- OpenRouter `response_format=json_schema` strict + `provider.require_parameters=true`; 모델 응답은 Action/TargetToken/사전 정의한 RationaleCode 3필드만 검증. 모델이 반환한 임의 명령/선택자/스크립트/URL/임의 토큰/이상 JSON/미지원 모델/미완료 응답은 502로 거부하고 실패 내용을 사용자에게 노출하지 않음.
- Admin AI 모델 설정에 별도 `planner_v1` task·enable kill switch·strict structured output verified 스위치 추가. 모델 ID/timeout/output token은 기존 Admin 설정 재사용. Admin이 처리 중 기능을 끄거나 모델을 교체하면 모델 응답 폐기. 기존 `/v1/ai/advice` API는 3개 기존 task 전용으로 유지.
- 예산: 로그인별 Planner 최대 20회/시간, 하나의 rehearsal run nonce별 최대 8회/시간, 전체 AI 30회/시간, 입력 4096bytes, 모델 출력 256 tokens 상한, timeout 2~12초. API DB에는 상태/모델/불투명한 요청·Run fingerprint만 남기고 대화·관찰·응답 원본은 저장하지 않음. `ai_model_policies.structured_output_verified` 추가 마이그레이션과 `ai_planner_requests` DB 저장.
- `apps/desktop/electron/booking/ai-planner.cjs`: AB-04 `ObservationPipeline.capture` + `projectForAI` (rehearsal only)로 민감정보 마스킹, AB-03 `strictProposal`로 응답을 호스트 내부 ActionProposalV1으로 검증. Snapshot/Run/revision/현재 stage/짧은 TTL/임시 TargetToken 전부 재검증. 모델은 어떤 `executeReviewedProposal` 또는 `BookingRunner.step`도 호출하지 않음. 계정 전환/로그아웃/창 닫힘/인증 단계 변경 및 비정상 네트워크 응답은 수동 `ASK_USER` fallback.
- 별도 리허설 Electron preload에는 `labPropose()` 단일 수동 트리거만 공개. `ScenarioLab.tsx`는 제안 액션/사유만 **실행 없이** 표시하며 자동 호출하지 않음. 기존 Cityline 화면형 리허설과 `Rehearsal AI Advisor`를 유지.
- 회귀 테스트: OpenRouter 완전 mock·JWT 필수·정확한 프롬프트 마스킹·모델 토큰 비용/중복·쿼터·엄격 output JSON·CAPTCHA/3DS/비정상 모델/타임아웃/5xx·실행 안 됨·낡은 snapshot/로그아웃/후행 응답·Admin feature gate/upgrade.
- 안전 한계: **실사이트 AI 행동 실행/자동화 정책 허가는 전혀 활성화하지 않음.** AB-09에서 별도 supervised recovery engine을 설계해야 하고, 실제 결제는 AB-13/14까지 불가. OpenRouter 호출에는 사용자 클릭과 로그인이 모두 필요하며 OpenRouter API key는 서버에만 위치.


## AB-09 — 제한적 AI 자동 복구

**명령:** "AB-09 구현해. AI가 제안한 안전한 복구만 Host Validator를 통과해서 실행하도록 연결해."

**목표:** 검증된 허용 동작에 한해 AI planning→execute→postcondition 검사 자동화.
**예상 파일:** electron/booking/recovery.cjs, orchestrator.cjs, action-validator.cjs, src/booking/*, tests.
**구현:** dry-run/rehearsal first, action allowlist: WAIT, REOBSERVE, ASK_USER, STOP, RETURN_TO_VERIFIED_STEP where provider approval exists; selection actions require policy. Strict maxAttempts and step deadlines; failed postcondition => manual takeover.
**완료 조건:** no uncontrolled loops, browser reload on queue, CAPTCHA solver, unauthorized navigation or terms acceptance; unknown page => user.
**테스트:** page button text changes, seat sold out, stale snapshot, queue, virtual session expired, injected malicious instructions.
**Do not:** turn AI recommendation into unrestricted executor.

**완료 기록 (2026-10-10):**
- `apps/desktop/electron/booking/recovery.cjs`: 호스트 전용 `RecoveryEngine`. AB-08의 `takeRecoveryContext()`가 검증된 제안을 1회만 꺼내고, AB-03 `ActionValidator.inspect` 및 `claim`을 정상 실행 직전 다시 호출한다. 원본 Run ID·Snapshot ID·계정·창·Plan·업체·정책 revision·페이지 generation·유효시간을 확인한다.
- 자동 연속 실행이나 백그라운드 티켓 구매는 구현하지 않음. 리허설 창에서 사용자가 **별도의 두 번째 버튼으로 승인**한 경우에 한해 `REOBSERVE`(모의 read-only 상태 재관찰) 또는 `SELECT_APPROVED_OFFER`(AB-07 `ScenarioAdapter`에서 검증된 가상 좌석 선택) 최대 한 단계 실행. 승인 정보는 host가 생성하며 모델/렌더러가 권한, URL, 셀렉터를 지정할 수 없음.
- 기존 AB-03 `executeReviewedProposal`을 재사용하여 실행 직전 실제 가상 화면을 재조회하고, 요청한 offer의 금액·수수료 포함 여부·수량·좌석·회차·가격대·행동 가능 상태 일치를 재검사. 실행 후 예상 주문·페이지 전이 postcondition도 확인. 운영 프로바이더 어댑터는 타입 제한으로 실행 불가.
- `WAIT`, `ASK_USER`, `STOP`은 권고로만 남기며 실제 Runner를 멈추거나 웹사이트를 갱신하지 않는다. `RETURN_TO_VERIFIED_STEP`, 메뉴/배송/임의 선택/실사이트 이동은 사용 중인 공통 리허설에 실행 handler를 제공하지 않고 거부한다. Queue/CAPTCHA/login/3DS/checkout/영수증 상태에서는 AI 자동 동작 불가.
- 단일 Run 최대 3 승인 시도, 최대 2 실패, 가상 좌석 선택 최대 1회. 동일 단계·동일 대상·동일 페이지 반복 시도 차단. 실행당 2초 deadline; abort signal로 비동기 가상 선택을 취소하며, timeout 및 postcondition 실패 시 회복 실행 잠금·수동 전환. 리허설 실행/중단/재시작과 직렬화하여 경쟁 조건 차단.
- `main.cjs`, `rehearsal-preload.cjs`, `ScenarioLab.tsx`: 기존 Planner 표시와 별도로 `labRecover()` 고정 IPC 및 수동 승인 UI 연결. Electron main의 검증된 리허설 창 발신자만 호출 가능하며 무제한 명령 실행 API나 실제 브라우저/결제 API는 노출하지 않음. 로그인 전환·창 종료 시 Planner/Recovery 상태 모두 무효화.
- 테스트: 정상 시뮬레이터 좌석·재관찰, 동시 승인·재사용 거부, 반복/루프·timeout·손상된 화면 postcondition, 매진/금액 drift, Snapshot 만료·정상 Runner 단계 이동, 사용자 Stop/로그아웃, queue/CAPTCHA/3DS, 악성 버튼/프롬프트 주입, 실제 결제 경로 차단, 기존 BookingRunner/리허설 회귀. Mock OpenRouter만 사용, 실구매 없음.
- **라이브 AI 자동 복구는 AB-09에서 활성화하지 않음**. AB-10의 검증된 offer/fee 정책과 AB-12의 제공업체 허가 없이 실사이트 셀렉션·방향 전환·결제 실행 금지. 이 구현은 순수 가상 리허설 장치다.


## AB-10 — 좌석 선택 및 Offer Ranking

**명령:** "AB-10 구현해. 가격·수수료·좌석 타입을 포함한 범용 Offer/Seat Policy와 자동 선택 규칙을 추가해."

**목표:** provider-agnostic normalized offer schema; exact hard constraints then preference ranking.
**예상 파일:** packages/addon-sdk/index.d.ts, electron/booking/offer-policy.cjs, preferences.cjs, tests, simulator fixtures.
**구현:** performance/price/section/floor/seat mode/adjacency/real-name/restricted-view/delivery/fees, standing vs assigned vs auto allocation; unknown total fail; currency minor units; deterministic sorting with explicit fallbacks; cart refresh before checkout.
**완료 조건:** quantity=1/2, incompatible currencies, sold out, fees change and restricted-view handled; AI cannot relax conditions.
**테스트:** generative offer variants, no stable seat labels, invalid adjacency, secondary tier fallback consent, optional extras.
**Do not:** claim a provider has verified seat-map support until separately proven.

**완료 기록 (2026-10-10):**
- `apps/desktop/electron/booking/offer-policy.cjs`: 업체 종속 코드 없이 v1/v2 offer를 정규화. 모의/실제 제공업체 관찰의 providerId/eventKey/performance, 수량/통화/가격대/구역/층/좌석 유형/수령 방식, 판매 수량 제한, 실제 정합성 증거, 지정석·스탠딩 GA·자동배정, 연석·가려진 시야·실명·연령·접근성 제한·추가 상품을 제약 조건으로 평가. **v2**는 수수료 5개 항목의 합이 최종 총액과 같고 검증됨이 확인돼야 인정.
- hard filter 후 사용자가 명시적으로 정한 가격 등급 → 구역 → 층 순서, 총액, 고정 ID 순으로 결정적으로 정렬. 불허된 2순위 fallback, 모르는 총액/수수료, 불일치 통화, 매진, 연석 증거 누락, 자동배정/GA 혼동 및 임의 보험·구독 추가는 후보/최종 주문에서 차단. KRW/JPY 등도 환산 없는 ISO minor unit 정수만 사용.
- `preferences.cjs`는 기존 공개 `chooseOffer`/`validOrder` 함수 서명과 v1 객체 동일성 유지. `BookingPreferences.terms`는 선택적 명시적 opt-in만 허용하며, renderer에 동의 UI가 없는 상태에서는 기본적으로 모든 위험 조건/추가 상품 차단. 원래 Cityline 예약 옵션 기능/동작은 유지.
- `runner.cjs`: 선택된 화면의 실제 eventKey 바인딩과 최종 주문의 canonical signature를 대조해 가격/수수료/좌석/업체/좌석 모드/부가 상품/제한 조건 변경 시 결제 전에 거부. `action-validator.cjs`와 `action-registry.cjs`: AB-03 모델/애드온 제안용 immutable offer handles가 v2 리스크·수수료 필드를 빠뜨리지 않으며, 시뮬레이터의 후보를 다시 읽고 동일한 canonical fingerprint인지 확인.
- AB-07 `rehearsal-driver.cjs` strict v2 모의 주문 및 `rehearsal-fixtures.cjs` 신규 3개 상황(시야 제한, 미확인 수수료, 미검증 자동배정). 가상 판매 단계에서 총 17개 시나리오를 제공하고 운영 사이트 트래픽/결제 없음.
- 회귀 테스트: 1/2장, 지정석/스탠딩/자동배정, 증거 미확인, GA 번호없는 티켓, 비인접, 다중 통화/예산, 명시적 consent, 통합 수수료 합계, 익명 부가상품, fallback 순위, 동일 점수 ID 정렬, 페이지 변경/가격 drift, 안전한 가상 리허설과 기존 Cityline v1 호환.
- **권한 경계:** 이것은 정책 데이터/호스트 검증 엔진이지 제공업체의 실제 좌석 맵 지원·자동화 승인을 뜻하지 않음. Cityline의 seats/payment implementation은 여전히 pending. NOL/Ticketmaster/AXS restriction 유지. AB-11에서 동의 및 선택 UX 보강, AB-12에서 업체 권한·프로파일 검증.


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

- 현 단계: **AB-01~AB-10 완료 (dev) · AB-11 다음 단계**. 라이브 자율 결제와 실사이트 AI 행동 실행은 비활성.
- 진행 체크리스트 (작업 완료 후 근거와 커밋을 기록할 것):
  - [x] AB-01 Provider Policy — `a5cf93d` (API/DB/Admin/SDK/host baseline, CI verified)
  - [x] AB-02 State Machine — `b8c090d` (FSM/Orchestrator, runner & rehearsal integration, CI verified)
  - [x] AB-03 Action Validator — `9a0563b` (strict proposals/host registry, rehearsal mock & regression verified)
  - [x] AB-04 Observation — `9c531b8` (redacted, navigation-aware host snapshots; CI verified)
  - [x] AB-05 Journal — `53086d9` (durable write-ahead ledger, restart recovery, CI verified)
  - [x] AB-06 Session Coordinator — server leases, fencing and host window ownership
  - [x] AB-07 Offline Rehearsal — common 14-scenario simulator, isolated mock Ledger and restart-safe UI (CI verified)
  - [x] AB-08 AI Planner — strict OpenRouter proposal-only pipeline, privacy and quota, rehearsal manual trigger (CI verified)
  - [x] AB-09 Recovery Engine — explicit rehearsal approval, fresh host validation, one-shot synthetic selection/reobserve, deadline & loop guard (CI verified)
  - [x] AB-10 Seat/Offer Policy — strict all-in fee normalization, deterministic seat ranking, v1 compatibility and 17 offline drills (CI verified)
  - [ ] AB-11 Desktop UX
  - [ ] AB-12 Provider Onboarding
  - [ ] AB-13 Gated Payment Executor (mock)
  - [ ] AB-14 Reconciliation
  - [ ] AB-15 Security/E2E Release Readiness

**다음 명령:** "AB-11 구현해." 이후 Runbook 순서대로 진행. 필요하면 "AB-05 진행 상황 확인해." / "AB-09 테스트 강화해." / "AB-01~AB-05 설계와 구현 비교 검토해."도 가능하다.
