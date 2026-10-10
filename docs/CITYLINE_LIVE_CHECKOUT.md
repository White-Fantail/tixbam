# Cityline 실제 자동 구매: 구현과 활성화 조건

검토: 2026-10-10. 현재 실제 자동 구매는 **미완료**다. 결제 코어 테스트 통과를 실제 Cityline 결제 성공으로 표시하지 않는다.

이 문서는 이전 로컬 작업 환경이 유지되지 않아 원격 `dev`의 `bf9cecf`에서 복원한 결제 계약을 설명한다. 이전에 보고한 로컬 `dde8ff4`는 원격으로 push되지 않았다. 이번 복원은 동일 SHA 재생성이 아니라 계약과 회귀 테스트의 기능 복원이다.

## 공식 근거

- [구매 안내](https://www.cityline.com/BuyEventTickets.do?lang=en_US): 공연/가격 선택 → 좌석/수량 → Shopping Cart의 결제·수령정보와 Check Out → Transaction Preview의 Confirm → 성공 시 Receipt.
- [약관](https://www.cityline.com/en_US/ReleaseNotes.html#termsconditions) 21항: 자동화된 접근·상호작용·거래 금지. 앞선 검토에서 브라우저로 해당 항목을 직접 확인했다. 별도 허용 근거를 실제로 확인하기 전에는 `restricted` baseline을 해제하지 않는다.

안내의 버튼 이름·스크린샷만으로 현재 DOM selector, PSP origin, 주문 API 또는 성공 응답을 추정하지 않는다. 일반 공개 사이트를 둘러본 것은 로그인 후 checkout 검증이 아니다. 실제 티켓 예약·결제는 실행하지 않았다.

## 현재 코드와 부족한 연결

| 항목 | 구현한 부분 | 실제 활성화에 남은 부분 |
|---|---|---|
| 공연 identity | `identityVersion:2`; provider 공연 ID와 서버 UUID 분리; 두 ID와 event ID를 order signature/digest에 포함 | 서버가 검증한 provider event/performance와 canonical 공연 대응 관계 |
| 결제 트랜잭션 | host 내부 `CheckoutTransaction`; 최신 주문 확인, durable preclaim, server guard, postclaim 재관찰, fsync 후 1회 submit | 현재 Cityline checkout observer/submitter와 runner bridge |
| 영수증 | typed receipt contract, opaque proof, durable intent와 전체 permit/order digest 일치 검사 | 실제 Cityline 성공 상태·영수증·주문 이력 observer |
| 정책 | 최신 Cityline restriction metadata; stale DB/forged permission도 차단 | 별도 허용 근거의 action/country/domain/version/expiry/철회 검증 |
| 준비 상태 | `booking-readiness` IPC, context 및 release report의 개별 blockers | 위 조건이 실제로 충족된 evidence와 approved source release |
| 카드·인증 | 코어는 카드/PAN/CVV/비밀/HTML 입력을 받지 않음; 준비되지 않은 카드 입력 숨김 | 허용된 hosted/tokenized 경계, 수동 로그인/CAPTCHA/queue/3DS 복귀 검증 |

`CitylineAdapter`에는 현재 공연·가격 options 관찰/선택만 있다. 좌석 reserve, cart/preview 주문 관찰, 실제 final Confirm, receipt 매핑은 없다. production controller의 live payment는 여전히 `null`이다. 새 클래스에 `verified:true` 필드나 renderer에서 실행 가능한 submit IPC는 없다.

## 거래 ID와 금액 계약

permit은 인증된 host/server target에서 accountId, planId, saleId, canonical `performanceId`, eventKey를 가져와야 한다. `providerEventId`와 `providerPerformanceId`는 검증된 대응 관계에서 가져와야 하며, preferences의 provider 공연 ID를 서버 UUID로 단순 대입하지 않는다.

주문의 `performance`는 provider 공연 ID, `canonicalPerformanceId`는 서버 UUID다. 영구 구매 차단 scope는 `(accountId, performanceId)`이며 seller/sale/provider event/plan/quantity가 바뀌어도 재구매를 허용하지 않는다. identity v1 저널의 HMAC 계산은 유지하고 기존 파일을 다시 쓰거나 과거 latch를 삭제하지 않는다.

최종 주문은 strict v2의 수량·통화·all-in 금액·fee breakdown·좌석/배정·수령방법·restrictions·extras와 일치해야 한다. 미확인 수수료, 자동 환율 변환, 미승인 추가 상품 또는 알 수 없는 인접성을 허용하지 않는다.

## 트랜잭션 순서

1. 실제 ledger/coordinator와 account/performance/plan/sale/event, run/window, lease/fence를 맞춘다.
2. `READY_TO_COMMIT`에서 review 확인을 받아 opaque approval을 만든다. order signature, checkout session, 예약 만료와 최대 15초 승인 시간을 묶는다. automatic 모드는 사전 승인된 permit을 전제로 한다.
3. 첫 await 전에 1회 latch를 잡고 expected order를 복사한다. 권한·owner 재검사 후 최신 주문을 읽는다.
4. `CLAIM_REQUESTED`를 fsync한 다음 서버 claim을 요청한다. scope v2 guard/claim UUID와 fence가 일치해야 한다.
5. claim 완료 후 권한·owner·주문·session·만료를 다시 검사한다. 변경됐으면 제출하지 않고 claim-only 안전 검토 상태를 유지한다.
6. `COMMIT_INTENT_RECORDED`를 fsync한 후 한 번 submit한다. 실제 driver는 문서 안에서 주문/session/만료/abort/유일한 최종 control을 클릭 직전에 원자적으로 재검사해야 한다. **이 driver는 아직 없다.**
7. 반환은 `submitted`일 뿐 paid가 아니다. timeout/응답 오류는 `payment_unknown`, claim 모호성은 `claim_unknown`; 재시도하지 않는다. 모든 async boundary를 abort/timeout으로 제한한다.

`BookingRunner`의 기존 claim/journal 처리와 이 코어를 동시에 호출하면 안 된다. future live bridge는 해당 작업을 transaction에 위임하고 상태를 `CLOUD_CLAIM_UNKNOWN` 또는 `PAYMENT_UNKNOWN`으로 반영해야 한다. 현재 bridge는 연결하지 않았다.

## 영수증과 복구

qualified host observer만 typed receipt contract를 공급한다. confirmation, challenge 없음, 명시적 paid, transaction reference, 주문 ID, provider/event/performance, 수량·통화·금액 및 전체 주문 signature가 일치해야 opaque proof를 만든다. 일반 성공 문구, 이메일 도착 여부, 사용자 보고, server claim 또는 submit 반환은 증거가 아니다.

ledger는 proof의 permit/order digest가 durable attempt와 일치하는지 검사하고 receipt reference HMAC만 기록한다. raw 카드·계정·주문·좌석·영수증은 journal에 저장하지 않는다. `reconcile`은 읽기 전용이며 claim/submit을 호출하지 않고 진행 중 submit과 겹칠 수 없다. 확인 완료 후에도 purchase tombstone을 유지한다. 실제 merchant observer가 없으므로 이 계약이 실제 Cityline 영수증을 검증했다는 뜻은 아니다.

로그인·CAPTCHA·queue·3DS는 공식 창에서 사용자에게 맡긴다. 다른 PSP/bank origin을 임의로 신뢰 범위에 추가하거나, 모호한 결제를 미결제로 단정하거나, 재시작 후 자동 재구매하지 않는다.

## 실제 자동 구매 완료까지 필요한 입력과 작업

1. Cityline가 허용한 테스트 환경/계정, 공식 API 또는 결제 연동 문서와 허용 범위를 확인한다. 일반 사용자 계정 보유는 별도 자동화 허용 근거가 아니다. 비밀번호·카드 정보를 채팅으로 받지 않는다.
2. 허용된 테스트 event에서 현재 좌석, cart, preview, final Confirm, PSP/3DS return, receipt 계약을 관찰한다. 대상·수량·예산이 없는 실제 재고 예약/청구를 하지 않는다.
3. fixed host-owned Cityline observer/actions, provider/canonical mapping, 정책 근거 검증, hosted 결제 경계와 receipt observer를 구현한다.
4. runner에 transaction을 연결한다. fixture 성공이나 server toggle만으로 release를 승인하지 않는다.
5. 승인된 sandbox에서 실제 end-to-end 구매 완료·영수증 일치, 가격 변경, decline, timeout, late reply, 3DS, 재시작/중복 제출을 검증한다.
6. 실제 금전이 발생하는 canary에는 사용자가 지정한 대상·수량·가격 상한·결제 승인이 별도로 필요하다. 초기 final-order review 검증 후에만 automatic 모드의 source release를 검토한다.

허용된 실제 환경이 제공되기 전에는 위 실제 adapter 활성화 단계가 막혀 있다. 내부 계약 테스트만 추가하며 "실제 자동 구매 완료"라고 표시하지 않는다.

## 회귀 검증

`checkout-transaction.test.cjs`의 13개 케이스는 synthetic host/merchant 응답으로 identity, guard/fence, 중복 확인, 정책 변경, postclaim 주문 변경, 만료, 응답 유실, Stop, timeout/late reply, receipt mismatch, 영구 구매 차단 및 concurrent reconcile을 검증한다. 실제 Cityline selector/API/청구 검증이 아니다.
