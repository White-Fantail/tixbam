# NOL-01~05 자동 회귀 검증 (Desktop 포함)

이제 이전에 수동 테스트로 분류했던 **(1) 로직/코파일럿 테스트**와 **(2) Desktop 화면 테스트**를 모두 자동 테스트케이스로 검증합니다. **실제 NOL 예매처의 현재 UI/정책/실좌석 확보**는 승인된 현장 테스트가 필요하며, 오프라인 테스트로 그 성공률을 확인했다고 표시하지 않습니다.

## 한 명령으로 실행

요구 조건: Node.js 22 이상, 루트 `npm ci`. Linux에서는 Electron UI 실행용 `xvfb-run` 필요. macOS에서는 별도 Xvfb 필요 없습니다.

```bash
git switch dev
git pull --ff-only origin dev
npm ci
npm run verify:nol
```

이 명령은 다음을 순서대로 수행합니다.

1. **NOL-01~05 Node 테스트**: 화면 분류(정식 호스트/보호 경로), 좌석 전략, 보류 검증/중복 실행 방지, 비식별 진단/배포 보류, LiveCopilot 호스트 통합 회귀
2. **실제 Desktop React UI E2E**: 테스트 전용 Vite 번들을 만든 후 격리된 Electron 브라우저에 **실제 `LiveBookingWorkspace` + `LiveCopilotPanel` 컴포넌트**를 렌더링하고 DOM 문구/버튼/상태전환을 자동 검사
3. **NOL-05 JSON 검증 보고서**: 18개 합성 단계 인식 fixture 및 실제/합성 구분, 출시 `HOLD`

각 테스트 개별 실행:

```bash
npm run test:nol
npm run test:ui:nol
node scripts/nol-validation-report.cjs
npm run build:desktop
```

**CI:** `.github/workflows/ci.yml`의 `dev` 푸시 / PR 검사에서 기존 `npm test`, TS 빌드, NOL 분류·안전성 회귀, **오프라인 Electron UI E2E**를 실행합니다. 로컬 `verify:nol`은 편의를 위해 NOL에 집중하며 전체 Admin/Python 빌드까지 대체하지 않습니다.

## Desktop UI 자동 테스트 세부 시나리오

테스트 구동: `apps/desktop/electron/nol-ui-e2e.cjs`, 사전 빌드: `vite.nol-ui.config.ts`, React fixture: `src/test/nol-ui-fixture.tsx`. **테스트용 UI는 `dist-nol-ui/` 별도 번들에 들어가고 생산 `vite.config.ts` 빌드에는 포함되지 않습니다.**

| 시나리오 | 실제 UI에서 검사하는 내용 | 정상 결과 |
|---|---|---|
| NOL-01 | 공연 상세 화면, 인증·대기열 경고 표시 | 단계 진단이 나타나고 인증은 사용자에게 인계 |
| NOL-02 | 좌석 배치, 좌석 충돌, 매진, 장바구니로 변경 | 단계별 문구 일치, cart는 `hold_unverified` |
| NOL-03 | 실제 1장 전략 결과를 UI에 주입: R/Main 우선, S/Balcony 차선 | 순위·대안 표시, 대안 불허/예산 초과 후보 제외, 자동 예매 버튼 비활성화 |
| NOL-04 | Checkout 단계 UI | 공식 보류 검증 `미연결`, 캡처 차단, 실예약/결제 요청 0회 |
| NOL-05 | 실제 코파일럿 진단 UI | 합성 경과시간 P95/대기열 진입·복귀/사용자 개입 집계 표시 |
| 사용자 조작 | 실제 React `My current stage` 콤보박스, `계속 진행`, `중지` 버튼 | 선택 단계에만 캡처 가능, 사용자 중단·재개가 IPC 모의 핸들러까지 연결 |

UI 이벤트 및 상태값은 `assessNolScreen`, `planChoices`, `NolValidationTimeline` 등 **프로덕션 로직**으로 생성합니다. UI 문자열을 별도 화면에 복사해서 검사하는 것이 아닙니다. 단, **NOL 웹사이트 HTML 자체를 렌더링하지 않고**, 공식 브라우저·Vision 응답 및 IPC 연결은 모의 데이터입니다.

## 격리와 보안

- Electron은 별도의 임시 사용자 프로필을 사용합니다. 기존 TixBam 로그인/쿠키/비밀번호/실제 예약 세션을 재사용하지 않습니다.
- 외부 `http(s)` 네트워크 요청은 Electron 테스트 세션에서 **무조건 차단**하며, NOL 공식 페이지에 접속하지 않습니다. 네트워크 시도 횟수와 실제 접속 성공은 다릅니다. 외부 폰트 도메인의 차단된 리소스 요청은 별도로 집계하지만, NOL 예매처 호스트로의 요청 시도 또는 알 수 없는 외부 호스트 요청은 **테스트 실패**로 간주합니다. 실패 로그에는 민감한 URL 경로/쿼리 대신 호스트명·요청 유형·시나리오만 기록합니다.
- Preload 모의 IPC는 스크린샷·수동 클릭·자동 실행을 포함한 실제 예매처 동작을 거절합니다. 앱의 공식 API/결제 프로세스는 시작하지 않습니다.
- UI 테스트를 컴파일한 fixture는 `dist-nol-ui/` 폴더에만 생성되고 일반 앱 배포 대상 `dist/`에는 포함되지 않습니다.
- 검증 보고서에서 오프라인 테스트 **PASS**와 공급자 실서비스 출시 **HOLD**는 서로 독립입니다. 실제 NOL 화면을 통한 정확도/좌석 보류 성공률은 여전히 **미측정**입니다.

## 실패 시 확인할 것

`npm run test:nol`이 실패하면 해당 NOL 분류/예산/중복 시나리오 이름과 Assertion을 확인합니다. `npm run test:ui:nol`이 실패하면 Electron 로그의 **NOL Desktop UI E2E FAILED**와 `passedSoFar`를 확인합니다. Linux에서 `xvfb-run`이 없다면 설치하거나 macOS에서 실행하세요. 테스트가 실패하면 우회 설정으로 통과시키지 말고 실제 UI/상태 전환 결함을 수정해야 합니다.

**미검증 상태:** NOL의 공식 자동화 권한, 실사이트 화면 데이터, 실제 좌석 보류 증거, 사람 개입 후 실제 대기열 위치 유지, 지연시간 실측. [실사이트 메타데이터 검증 절차](./NOL_05_REAL_SCREEN_VALIDATION.md).
