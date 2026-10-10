import { useEffect, useState } from "react";
import type { RehearsalLabScenario, RehearsalLabState, RehearsalTarget, RehearsalPlannerView, RehearsalRecoveryResult } from "../types";
import { tx, useLanguage } from "../i18n";


const practiceMessagesKo:Record<string,string>={
  "Preparing session.":"리허설 세션을 준비하고 있어요.",
  "Reading booking page…":"가상 예매 화면을 확인하고 있어요.",
  "Evaluating booking page.":"예매 단계와 구매 조건을 확인하고 있어요.",
  "Validating preferred options.":"선호 좌석과 가격대를 검증하고 있어요.",
  "Selecting performance and price.":"공연 회차와 가격대를 선택하고 있어요.",
  "Preferred performance and price selected. Waiting for the next step.":"공연 회차와 가격대를 선택했어요. 다음 단계로 진행하세요.",
  "A matching seat offer was found.":"조건에 맞는 가상 좌석을 찾았어요.",
  "Validating seat reservation.":"가상 좌석 예약 조건을 검증하고 있어요.",
  "Reserving preferred offer.":"선호하는 가상 좌석을 선택하고 있어요.",
  "Selected seats. Checking the final order.":"좌석을 선택했어요. 최종 주문 내용을 검토하세요.",
  "Checking the final order.":"모의 주문의 총액과 좌석을 확인하세요.",
  "Check the final order, then confirm payment.":"최종 모의 주문을 확인한 후 결제 연습을 승인하세요.",
  "Final order was rechecked.":"최종 모의 주문을 다시 검증했어요.",
  "Submitting payment once.":"모의 결제 요청을 한 번만 제출하고 있어요.",
  "Waiting for provider confirmation.":"가상 예매처의 주문 확인을 기다리고 있어요.",
  "Booking confirmed by the provider.":"가상 영수증을 검증했어요. 실제 결제는 없었어요.",
  "Simulated queue: user handoff required.":"가상 대기열입니다. 사용자 확인 후 재개하세요.",
  "Simulated CAPTCHA: a person must complete this challenge.":"가상 CAPTCHA입니다. 사용자가 직접 확인 후 재개하세요.",
  "Simulated bank 3-D Secure: user approval required.":"가상 은행 3D Secure 인증입니다. 사용자 확인 후 재개하세요.",
  "No seats satisfy the quantity, adjacency, preferences and budget including fees.":"좌석 수량·연석·선호 조건·수수료 포함 예산을 만족하는 좌석이 없어요.",
  "The payment page changed. Review the provider window.":"결제 직전 가격 또는 페이지가 바뀌었어요. 다시 검토하세요.",
  "Booking could not continue. Payment preparation cleared. Stop and start again.":"리허설 실행이 중단됐어요. 구매 조건을 다시 확인하세요.",
  "Payment outcome is unknown. Check the provider order history; automatic retry is disabled.":"모의 결제 결과를 확인할 수 없어요. 자동 재시도는 차단됐어요.",
  "Payment was submitted once. Check the provider order history before trying again.":"모의 결제 요청이 이미 제출됐어요. 중복 요청하지 마세요.",
  "Stopped. Payment preparation cleared.":"리허설이 중단됐어요.",
  "Payment submission may have occurred. Check the provider order history. Automatic retry is disabled.":"모의 결제 요청이 처리됐을 수 있어요. 재시도가 차단됐어요.",
  "Simulated payment status unknown after restart; never retry.":"재시작 후 모의 결제 결과가 불명확해요. 자동 재시도는 불가해요.",
  "Practice interrupted; start a new simulation.":"리허설이 중단됐어요. 새 연습을 시작하세요.",
  "Practice recovery record damaged; automatic resume denied.":"리허설 복구 기록이 손상되어 자동 재개할 수 없어요.",
  "The booking page has not advanced. Check the selected options before resuming.":"가상 예매 화면이 진행되지 않았어요. 선택 조건을 확인하세요.",
  "This page needs your attention. Continue in the provider window, then resume.":"사용자의 확인이 필요해요. 내용을 검토하고 재개하세요."
};

export function ScenarioLab({plan,onComplete}:{
  plan:RehearsalTarget;onComplete:()=>Promise<void>;
}) {
  const {language}=useLanguage(),ko=language==="ko";
  const bridge=window.tixbamRehearsal;
  const present=(message:string)=>ko?(practiceMessagesKo[message]||tx(message)):message;
  const [scenarios,setScenarios]=useState<RehearsalLabScenario[]>([]);
  const [selected,setSelected]=useState("standard");
  const [seed,setSeed]=useState(2027);
  const [state,setState]=useState<RehearsalLabState|null>(null);
  const [busy,setBusy]=useState(false);
  const [planning,setPlanning]=useState(false);
  const [recovering,setRecovering]=useState(false);
  const [recovery,setRecovery]=useState<RehearsalRecoveryResult|null>(null);
  const [proposal,setProposal]=useState<RehearsalPlannerView|null>(null);
  const [error,setError]=useState("");
  const [acknowledged,setAcknowledged]=useState(false);
  const [synced,setSynced]=useState(false);
  useEffect(()=>{
    let live=true;
    if(!bridge)return;
    Promise.all([bridge.labScenarios(),bridge.labStatus()]).then(([items,status])=>{
      if(live){setScenarios(items);setState(status);}
    }).catch(e=>{if(live)setError(String(e));});
    return ()=>{live=false;};
  },[bridge]);
  async function action(task:()=>Promise<RehearsalLabState>){
    setBusy(true);setError("");setSynced(false);setProposal(null);setRecovery(null);
    try{setState(await task());setAcknowledged(false);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }

  async function suggest(){
    if(!bridge||busy||planning||!state?.active)return;
    setPlanning(true);setProposal(null);setRecovery(null);setError("");
    try{setProposal(await bridge.labPropose());}
    catch{setProposal({action:"ASK_USER",rationaleCode:"MODEL_UNAVAILABLE",
      advisoryOnly:true,source:"fallback"});}
    finally{setPlanning(false);}
  }
  async function recover(){
    if(!bridge||busy||planning||recovering||!state?.active)return;
    setRecovering(true);setError("");
    try{
      const result=await bridge.labRecover();
      setRecovery(result);setProposal(null);
      setState(await bridge.labStatus());
    }catch{
      setRecovery({executed:false,code:"EXECUTION_FAILED",manualTakeover:true});
      setProposal(null);
    }finally{setRecovering(false);}
  }
  const actionable=proposal?.source==="openrouter" &&
    ["REOBSERVE","SELECT_APPROVED_OFFER"].includes(proposal.action);
  const actionLabels:Record<RehearsalPlannerView["action"],[string,string]>={
    WAIT:["기다리기","Wait"],REOBSERVE:["페이지 재확인","Reobserve"],
    ASK_USER:["사용자 확인","Ask the user"],STOP:["중단 고려","Consider stopping"],
    SELECT_PERFORMANCE:["공연 회차 검토","Review performance"],
    SELECT_PRICE_TIER:["가격대 검토","Review price tier"],
    SELECT_APPROVED_OFFER:["조건에 맞는 좌석 검토","Review eligible offer"],
    CHOOSE_VERIFIED_DELIVERY:["배송 방식 검토","Review verified delivery"],
    RETURN_TO_VERIFIED_STEP:["이전 검증 단계 검토","Review prior verified step"]
  };

  const scenario=scenarios.find(s=>s.id===selected);
  const terminal=!!state&&["completed","stopped","failed","payment_unknown"].includes(state.status);
  const labComplete=state?.status==="completed"||
    (state?.status==="payment_unknown"&&acknowledged);
  async function finish(){
    setBusy(true);setError("");
    try{await onComplete();setSynced(true);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  return <section className="scenario-lab" aria-label={ko?"공통 오프라인 티켓팅 훈련":"Provider-neutral offline booking lab"}>
    <div className="cl-drill-top"><div>
      <span className="eyebrow">TIXBAM · PROVIDER-NEUTRAL · OFFLINE ONLY</span>
      <h3>{ko?"예외 상황 실전 리허설":"Booking safety stress lab"}</h3>
      <p>{ko?"실제 예매창, 카드, 네트워크, 결제 없이 상태 머신과 결제 안전장치를 시험합니다.":
        "Exercise the real booking state machine and synthetic payment journal without touching any ticketing site."}</p>
    </div></div>
    <div className="cl-drill-notice" role="note">
      {ko?"모든 좌석·가격·대기열·결제는 가상입니다. 실제 티켓이 구매되거나 카드가 청구되지 않습니다.":
        "All inventory, prices, queues, challenges, orders and receipts are synthetic. No actual purchase or charge is possible."}
    </div>
    <div className="lab-scenario-tools">
      <label>{ko?"상황 선택":"Select scenario"}
        <select aria-label={ko?"상황 선택":"Select scenario"} value={selected}
          disabled={busy||Boolean(state?.active)} onChange={e=>setSelected(e.target.value)}>
          {scenarios.map(item=><option key={item.id} value={item.id}>
            {ko?item.ko:item.title}
          </option>)}
        </select>
      </label>
      <label>{ko?"재현용 시드":"Reproducible seed"}
        <input type="number" min={0} max={999999} value={seed} disabled={busy||Boolean(state?.active)}
          onChange={e=>setSeed(Number(e.target.value))}/>
      </label>
      <button className="button button-primary" type="button"
        disabled={busy||Boolean(state?.active)||!scenario||plan.budgetMinor<=0}
        onClick={()=>bridge&&void action(()=>bridge.labStart(selected,seed))}>
        {ko?"새 리허설 시작":"Start new drill"}
      </button>
    </div>
    {scenario&&<p className="cl-drill-helper">{ko?scenario.hintKo:scenario.hint}</p>}
    {plan.budgetMinor<=0&&<p className="cl-drill-block">
      {ko?"연습할 예산을 Booking Plan에 먼저 설정하세요.":"Set a practice budget in your Booking Plan first."}
    </p>}
    {error&&<p role="alert" className="cl-drill-feedback">{error}</p>}
    {state&&state.status!=="idle"&&<div className="lab-run">
      <div className="lab-run-summary">
        <strong>{ko?"현재 상태":"Current status"}: {state.status.replaceAll("_"," ").toUpperCase()}</strong>
        <small>{ko?"시나리오":"Scenario"}: {ko?(scenarios.find(s=>s.id===state.scenarioId)?.ko||state.scenarioId):
          (scenarios.find(s=>s.id===state.scenarioId)?.title||state.scenarioId)} ·
          {ko?"시드":"Seed"} {state.seed??seed}</small>
      </div>
      <p aria-live="polite">{present(state.message)}</p>
      {state.recovered&&<p className="cl-drill-block">
        {ko?"중단 전 실행 권한은 복구하지 않았습니다. 결제 결과가 불명확하면 재결제하지 않고 영수증을 확인해야 합니다.":
          "Old execution authority was NOT restored. Unknown payments must never be retried without independent verification."}
      </p>}
      {state.order&&<div className="cl-drill-rules"><strong>{ko?"모의 주문 검토":"Synthetic order review"}</strong>
        <span>{state.order.quantity} × {state.order.currency} · {state.order.totalMinor} {ko?"최소 단위, 수수료 포함":"minor units including fees"}</span>
        <small>{ko?"모의 좌석":"Mock seats"}: {state.order.seats.join(", ")}</small>
      </div>}
      {state.status==="payment_unknown"&&<div className="cl-drill-block">
        {ko?"실제 상황에서는 주문·결제 내역을 공식 예매처에서 확인하기 전까지 자동 재시도하면 안 됩니다.":
          "In a real case, check official merchant order/payment history before even considering another attempt."}
      </div>}
      <div className="cl-drill-nav">
        {state.status==="running"&&<button className="button button-primary" disabled={busy}
          onClick={()=>bridge&&void action(()=>bridge.labNext("advance"))}>{ko?"다음 단계":"Next step"}</button>}
        {state.status==="awaiting_user"&&state.challenge!=="none"&&<button className="button button-primary"
          disabled={busy} onClick={()=>bridge&&void action(()=>bridge.labNext("manual"))}>
          {ko?"모의 사용자 인증 완료 후 재개":"Complete manual challenge & resume"}</button>}
        {state.status==="review"&&<button className="button button-primary" disabled={busy}
          onClick={()=>bridge&&void action(()=>bridge.labNext("confirm"))}>
          {ko?"모의 주문 확인 · 결제":"Confirm MOCK checkout"}</button>}
        {state.active&&<button className="button button-outline" disabled={busy}
          onClick={()=>bridge&&void action(()=>bridge.labStop())}>{ko?"중단":"Stop"}</button>}
        <button className="button button-outline" disabled={busy||state.recovered}
          onClick={()=>bridge&&void action(()=>bridge.labRestart())}>
          {ko?"앱 재시작 상황 재현":"Simulate app restart"}
        </button>
      </div>
      {state.active&&<div className="lab-ai-planner">
        <button className="button button-outline" type="button" disabled={busy||planning}
          onClick={()=>void suggest()}>
          {planning?(ko?"AI 제안 확인 중…":"Requesting AI proposal…"):
            (ko?"AI 다음 단계 제안 보기":"Suggest a next step with AI")}
        </button>
        <small>{ko?"선택한 경우에만 개인정보를 제거한 상태 정보가 TixBam API와 OpenRouter로 전송됩니다. AI는 클릭·선택·결제할 수 없습니다.":
          "Only when clicked, a redacted observation is sent through the TixBam API to OpenRouter. AI cannot click, reserve or pay."}</small>
        {proposal&&<div role="status" className="cl-drill-rules">
          <strong>{proposal.source==="fallback"?
            (ko?"안전한 수동 안내":"Safe manual fallback"):
            (ko?"AI 제안 (실행되지 않음)":"AI proposal (NOT executed)")}</strong>
          <span>{actionLabels[proposal.action][ko?0:1]}</span>
          <small>{proposal.rationaleCode.replaceAll("_"," ")}
            {proposal.model?" · "+proposal.model:""}</small>
          <small>{ko?"이 제안은 정보를 보여주기만 합니다. 아래의 기존 리허설 버튼으로만 진행하세요.":
            "This suggestion is read-only. Continue only with the existing rehearsal controls."}</small>
        </div>}
        {actionable&&<button className="button button-primary" type="button"
          disabled={busy||planning||recovering||!state.active}
          onClick={()=>void recover()}>
          {recovering?(ko?"호스트 검증 중…":"Validating recovery…"):
            (ko?"이 제안으로 모의 복구 1단계 실행":"Execute ONE approved mock recovery step")}
        </button>}
        {recovery&&<div className="cl-drill-rules" role="status">
          <strong>{recovery.executed?
            (ko?"모의 복구 단계 실행 완료":"Safe mock step completed"):
            (ko?"실행 차단 · 수동 확인 필요":"Blocked · manual takeover required")}</strong>
          <small>{recovery.code.replaceAll("_"," ")}</small>
          {typeof recovery.remaining==="number"&&<small>{
            ko?"남은 허용 시도: ":"Remaining approved attempts: "
          }{recovery.remaining}</small>}
        </div>}
      </div>}

      {(state.events?.length ?? 0)>0&&<details className="lab-history"><summary>{ko?"FSM 실행 기록":"FSM execution trace"}</summary>
        <ol>{(state.events??[]).map((event,i)=><li key={i}>
          <strong>{event.phase}</strong> — {present(event.message)}
        </li>)}</ol>
      </details>}
      {state.status==="payment_unknown"&&<label className="cl-drill-check">
        <input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/>
        {ko?"결제 결과 불명확 시 자동 재결제를 하지 않는 규칙을 확인했습니다.":
          "I understand an unknown payment must not be automatically retried."}
      </label>}
      {terminal&&labComplete&&<button type="button" className="button button-primary"
        disabled={busy||synced} onClick={()=>void finish()}>
        {synced?(ko?"연습 기록 저장 완료":"Practice record saved"):
          (ko?"연습 완료 기록 저장":"Save completed practice")}
      </button>}
    </div>}
  </section>;
}
