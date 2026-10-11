# NOL-05: 현장 화면 검증 프로토콜 / Real-screen validation protocol

> **현재 상태: HOLD.** 현재 NOL 화면의 실제 인식 정확도, 좌석 확보율 및 회차별 성능은 아직 측정하지 않았습니다. `dev`의 NOL-05 리포트는 **합성 데이터 오프라인 회귀 검사**이며, 실서비스 자동화 허가나 실좌석 보류 증거가 아닙니다.

## 안전하게 검증할 대상

1. 공연 상세 → 날짜/회차 → 실제 좌석/구역 선택 → 가격·매수 선택의 **비민감 화면**을 수동으로 관찰합니다. 공연별·지역별 NOL 변형을 별개로 기록합니다.
2. 좌석 충돌·매진 경고는 사용자 인계가 정확히 발생하는지 확인합니다. 결제/장바구니에서 TixBam이 **hold_unverified**를 표시하는지 확인하되 해당 화면의 개인정보·결제정보는 수집하지 않습니다.
3. 로그인·대기열·CAPTCHA·실명 확인·OTP·결제·3DS는 **사람이 직접 처리**합니다. 이런 화면에 들어가기 전에 AI 화면 전송을 중단합니다. SPA에서 URL이 바뀌지 않을 수도 있으므로 보호 URL 규칙만 믿지 않습니다.
4. 실사이트 검증은 해당 판매처의 정책과 승인된 범위에서만 수행합니다. `npm run dev:copilot`은 공급자 자동화 허가를 제공하지 않습니다.

## 화면별 비교 자료 준비

실제 비민감 화면에서 다음 정보만 사람이 기록합니다. **원본 스크린샷, 상세 URL, 계정/쿠키, 토큰, 예매 번호, 좌석 번호, QR 코드, 결제정보는 보관하거나 업로드하지 않습니다.**

- 익명 `id` (영문 소문자·숫자·대시·밑줄만), 인간 관찰자가 확인한 정답 `expected.step/substep`
- 해당 시점 Desktop의 화면 단계(`phase`), AI의 `screenStage`, `visionStage` 신뢰도, `visionStep`, `visionStepConfidence`
- `url`은 오직 `https://nol.yanolja.com/product/offline-fixture` 또는 `https://world.nol.com/product/offline-fixture` 로 치환합니다.
- 스크린샷/광학 인식 성능은 현장에서 먼저 별도로 평가해야 합니다. 기록을 사람이 임의로 맞춰 적으면 잘못된 100% 결과가 나올 수 있습니다. 실제 캡처가 아닌 추측 자료는 `redacted_human_labeled_screen`으로 표시하지 마세요.

### 로컬 JSON 예제: 형식만 설명하는 가상 데이터

아래는 **가상 예시**입니다. 실제 검증 자료로 사용하면 안 됩니다. 각 항목은 실제 비민감 화면을 사람이 관찰한 뒤 별도로 교체합니다.

```json
{
  "schemaVersion": 1,
  "cases": [{
    "id": "screen-001",
    "fixtureType": "redacted_human_labeled_screen",
    "containsScreenshot": false,
    "humanReviewed": true,
    "modelOutputFromActualScreen": true,
    "input": {
      "url": "https://nol.yanolja.com/product/offline-fixture",
      "phase": "selecting",
      "visionStage": "selecting",
      "visionConfidence": 0.99,
      "visionStep": "seat_map",
      "visionStepConfidence": 0.99
    },
    "expected": {"step": "selection_unknown", "substep": "seat_map"}
  }]
}
```

진짜 검증 기록이 준비되면 아래 명령으로 **내 컴퓨터에서만** 분류 점수를 계산합니다.

```bash
node scripts/nol-score-screens.cjs ./my-private-nol-screen-metadata.json
```

이 도구는 파일 내 허용되지 않은 필드, 원본 URL, 이미지 데이터, 미검토 기록을 거절합니다. 출력에는 정답/예측 혼동행렬, 단계별 precision/recall, 민감 단계 누락 수와 **항상 HOLD인 출시 판정**이 포함됩니다. 파일은 저장소에 커밋하지 않습니다.

## 합성 회귀 검사 & 성능 보고서

```bash
npm run test:nol -w @tixbam/desktop
node scripts/nol-validation-report.cjs
```

이 명령은 NOL API나 브라우저에 접속하지 않습니다. 기존 18개 합성 단계 시나리오와 모의 예약 검증을 포함합니다. 보고서의 `syntheticFixtureAccuracy`는 실제 비전 모델 인식률이 아닙니다. `offlineReplayLatencyMs`는 정해진 합성 지연시간이지 실전 AI/사이트 지연이 아닙니다. 실전 P50/P95는 Desktop의 **NOL 검증 진단**에서 해당 세션의 단계 분석 경과를 볼 때만 의미가 있습니다.

### 향후 출시 승인 전 수동 검토 기준 (단순 통과만으로 출시 금지)

- NOL 변형별 실제 사례를 최소 수십 개 확보하고, 독립적인 정답 라벨 및 모델 버전 기록, 혼동행렬을 검토합니다.
- **민감 단계의 자동 행동 0건**, CAPTCHA/대기열 우회 0건, 실수로 인한 중복 주문 0건, 잘못된 '좌석 보류 확정' 0건을 입증합니다.
- 사용자 인계 후 같은 공식 예매창/팝업 세션을 보존하며, 대기열 위치 보존은 공식 기능 또는 허가된 테스트로 입증해야 합니다. 로컬 카운터만으로 입증되지 않습니다.
- 실측 P50/P95 분석 지연, 잘못된 버튼 안내율, 후보 재검증 실패율, 회차/금액 검증 실패율, 실제 공식 좌석 보류율을 수집하고 검토합니다.
- NOL의 서면 자동화 승인 범위, 공식 읽기/쓰기 어댑터, 만료 시각이 있는 진짜 보류 증빙, 영속적 저널·세션 fencing, 장애/재시작 복구, 전체 테스트/보안/법적 검토가 모두 필요합니다.
- 관리자가 보고서/JSON의 성공 표시만 바꾸거나 개발자 옵션을 켜서 출시 제약을 우회할 수 없습니다.

**보안 설계:** `nol-validation.cjs`의 집계 이벤트는 종류와 경과시간만 저장합니다. 실제 NOL로 결제·예약 요청을 보내거나 공식 보류 증빙을 발급하는 인터페이스는 없습니다.
