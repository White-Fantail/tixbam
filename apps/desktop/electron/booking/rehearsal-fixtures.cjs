'use strict';
/** Offline only. These are simulated exercises, not live vendor capabilities. */
const DEFINITIONS=Object.freeze([
  {id:'standard',kind:'success',title:'Normal purchase',ko:'정상 구매',hint:'Mock selection, review, payment and synthetic receipt.',hintKo:'좌석 선택부터 모의 결제 확인까지'},
  {id:'queue',kind:'queue',title:'Waiting room',ko:'대기열',hint:'Pause until the user dismisses the simulated queue.',hintKo:'대기열 통과 후 수동 재개'},
  {id:'sold_out',kind:'sold_out',title:'Sold out',ko:'매진',hint:'No qualifying inventory; never invent replacement seats.',hintKo:'매진 시 임의 대체 구매 금지'},
  {id:'price_change',kind:'price_change',title:'Price changes',ko:'가격 변경',hint:'Final verified total changes before checkout.',hintKo:'결제 직전 가격 상승 확인'},
  {id:'fees_change',kind:'fees_change',title:'Fees change',ko:'수수료 변경',hint:'Final verified all-in fees change.',hintKo:'결제 직전 수수료 변동 확인'},
  {id:'captcha',kind:'captcha',title:'CAPTCHA',ko:'캡차',hint:'Must be completed by the user.',hintKo:'사용자가 직접 인증 후 재개'},
  {id:'bank_3ds',kind:'bank_3ds',title:'Bank 3-D Secure',ko:'3D Secure 인증',hint:'Manual bank challenge after mock checkout.',hintKo:'모의 결제 후 사용자 은행 인증'},
  {id:'payment_timeout',kind:'payment_timeout',title:'Payment timeout',ko:'결제 타임아웃',hint:'Unknown result must never auto-retry.',hintKo:'결제 응답 지연 시 재결제 금지'},
  {id:'unknown_charge',kind:'unknown_charge',title:'Unknown charge',ko:'결제 결과 불명확',hint:'Possible charge without verified receipt.',hintKo:'영수증 불명확 시 구매 잠금'},
  {id:'restart',kind:'restart',title:'Crash and restart',ko:'앱 재시작',hint:'Persist unknown payment before simulated restart.',hintKo:'강제 종료 후 미확인 결제 복구'},
  {id:'standing',kind:'standing',title:'Standing admission',ko:'스탠딩',hint:'No individually assigned seats.',hintKo:'비지정 입장권의 조건 검증'},
  {id:'automatic',kind:'automatic',title:'Automatic allocation',ko:'자동 배정',hint:'Allocated seats are mock, not venue seats.',hintKo:'자동 좌석 배정 조건 확인'},
  {id:'adjacency',kind:'adjacency',title:'Seats separated',ko:'좌석 비인접',hint:'Your together requirement must be respected.',hintKo:'일행과 떨어진 좌석 거절'},
  {id:'restricted_view',kind:'restricted_view',title:'Restricted-view seats',ko:'시야 제한 좌석',hint:'Verify explicit consent for obstructed sight lines.',hintKo:'시야 제한 좌석은 명시적 동의가 필요해요'},
  {id:'unknown_fees',kind:'unknown_fees',title:'Unverified fees',ko:'수수료 불명',hint:'Reject unknown checkout costs and extras.',hintKo:'모든 수수료를 확인하지 못하면 결제를 거절해요'},
  {id:'auto_unverified',kind:'auto_unverified',title:'Unverified automatic seats',ko:'미확인 자동 배정',hint:'Automatic allocation is not proof of adjacent seats.',hintKo:'자동 배정 좌석의 연석 여부를 반드시 확인해요'},
    {id:'stale',kind:'stale',title:'Page changes',ko:'페이지 상태 변경',hint:'Inventory changes between observing and selecting.',hintKo:'선택 도중 재고 변경'},
]);
const getScenario=id=>DEFINITIONS.find(s=>s.id===id)||null;
module.exports={DEFINITIONS,getScenario};
