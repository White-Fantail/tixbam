import { useEffect, useState } from "react";
import type { RehearsalLabScenario, RehearsalLabState, RehearsalTarget } from "../types";
import { useLanguage } from "../i18n";

export function ScenarioLab({plan,onComplete}:{
  plan:RehearsalTarget;onComplete:()=>Promise<void>;
}) {
  const {language}=useLanguage(),ko=language==="ko";
  const bridge=window.tixbamRehearsal;
  const [scenarios,setScenarios]=useState<RehearsalLabScenario[]>([]);
  const [selected,setSelected]=useState("standard");
  const [seed,setSeed]=useState(2027);
  const [state,setState]=useState<RehearsalLabState|null>(null);
  const [busy,setBusy]=useState(false);
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
    setBusy(true);setError("");setSynced(false);
    try{setState(await task());setAcknowledged(false);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
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
      <p aria-live="polite">{state.message}</p>
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
      {state.events?.length>0&&<details className="lab-history"><summary>{ko?"FSM 실행 기록":"FSM execution trace"}</summary>
        <ol>{state.events.map((event,i)=><li key={i}>
          <strong>{event.phase}</strong> — {event.message}
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
