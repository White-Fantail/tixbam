import type { RehearsalTarget } from "../types";
import { useLanguage } from "../i18n";
/** Short data-only briefing, never an event-specific validated seat map. */
export function ProviderPreview({plan,onComplete}:{plan:RehearsalTarget;onComplete:()=>Promise<void>}) {
  const {language}=useLanguage(),ko=language==="ko";
  const cityline=plan.providerId==="cityline";
  const steps=cityline?[
    [ko?"공식 공연·회차 선택":"Choose official event and performance",
      ko?"회차별로 판매 조건이 다를 수 있어.":"Requirements may vary by performance."],
    [ko?"대기열 및 회원 확인":"Queue and sign-in",
      ko?"대기열 새로고침·자동 우회를 시도하지 마.":"Do not reload or bypass the queue."],
    [ko?"가격대와 매수 선택":"Price tier and quantity",
      ko?"Express 배정 또는 Normal 직접 선택 여부는 공연마다 달라.":"Express allocation or Normal map depends on the event."],
    [ko?"좌석과 장바구니 확인":"Verify seats and official cart",
      ko?"장바구니가 임시 확보를 실제로 표시하는지 확인해.":"Only the official provider can confirm a temporary hold."],
    [ko?"결제와 주문 확인":"Payment and official receipt",
      ko?"3DS는 직접 완료하고 결제 불명확 시 재결제하지 마.":"Complete bank challenges yourself; do not repeat an uncertain charge."]
  ]:[
    [ko?"공식 판매 링크·회차 확인":"Verify official agent and date",
      ko?"프로모터 페이지와 예매처는 다를 수 있어.":"The promoter page may not be the ticketing agent."],
    [ko?"회원·선예매 조건 확인":"Confirm login and presale eligibility",
      ko?"계정 인증과 대기열은 직접 진행해.":"Login, bank and queue challenges are user-managed."],
    [ko?"판매되는 좌석·가격 확인":"Review options and prices",
      ko?"실제 좌석 배치는 사이트가 열리기 전에는 확정되지 않을 수 있어.":"Actual seat availability and layout may only be known on sale day."],
    [ko?"장바구니 및 영수증 검증":"Verify cart and receipt",
      ko?"TixBam의 안내만으로 좌석 확보가 증명되지는 않아.":"A TixBam guide never proves a reservation."]
  ];
  const limit=plan.budgetMinor>0 ? plan.currency+" "+(plan.budgetMinor/(["JPY","KRW"].includes(plan.currency)?1:100)).toLocaleString():ko?"미설정":"Not set";
  return <section className="scenario-lab">
    <div><span className="eyebrow">{ko?"사전 안내 · 실시간 예매 아님":"PRE-SALE BRIEFING · NOT LIVE"}</span>
      <h2>{ko?"예매 전에 알아둘 사항":"What to expect before booking"}</h2>
      <p>{ko?"공개된 일반 절차 기반 안내야. 이벤트별 실제 좌석, 가격, 화면 구조는 아직 확인되지 않았을 수 있어.":
        "A general provider workflow preview. Event-specific seat maps, prices and screens may be unknown."}</p></div>
    <div className="assist-priorities">
      <strong>{plan.artist} · {plan.title}</strong>
      <p>{ko?"목표 매수":"Quantity"}: {plan.quantity} · {ko?"총액 상한":"All-in limit"}: {limit}</p>
      <p>{ko?"좌석 우선순위":"Seat preferences"}: {plan.seatPreferences?.priceTier?.join(" → ")||"—"} · {plan.seatPreferences?.section?.join(" → ")||"—"}</p>
    </div>
    <ol className="copilot-brief-list">{steps.map(([label,note],i)=>
      <li key={i}><strong>{label}</strong><p>{note}</p></li>)}</ol>
    <p className="live-warning">{ko?"단계는 예상 안내일 뿐, 특정 이벤트의 실제 예매 화면을 검증했다는 뜻이 아니야.":
      "These are expected steps, NOT verification of a specific event's live checkout."}</p>
    <button className="button button-primary" onClick={()=>void onComplete()}>
      {ko?"안내 내용 확인 완료":"Mark briefing reviewed"}</button>
  </section>;
