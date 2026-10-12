import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Clock3,
  ExternalLink, Globe2, Layers3, LockKeyhole, Monitor, ShieldAlert, TicketCheck, X } from "lucide-react";
import type { BookingRun } from "../../../packages/addon-sdk";
import type { BookingPlan } from "./booking-plans";
import { currencyFactor } from "./booking-plans";
import { tx, tr, localDate } from "./i18n";
import { SaleCountdown } from "./BookingWorkspace";
import { LiveCopilotPanel } from "./copilot/LiveCopilotPanel";
import { ProviderLiveGuide } from "./booking/ProviderLiveGuide";
import { bookingGuide, looksLikeSignIn } from "./booking/live-guidance";
import { formatSaleLocalTime } from "./ticket-sales";
import type { CopilotAdvanceInfo, LiveHistory, LivePhase, TicketAddon, TicketWindow } from "./types";
import { useLanguage } from "./i18n";

const steps: Array<{ id: LivePhase; name: string; help: string }> = [
  { id: "preparing", name: "Preparing", help: "Verify the exact event, performance and official ticket agent. Complete provider sign-in yourself." },
  { id: "waiting", name: "Waiting room", help: "Follow the official waiting room instructions. Opening or refreshing windows may reset your position." },
  { id: "queue", name: "In queue", help: "Keep this window open. TIXBAM does not bypass, speed up or read your queue position." },
  { id: "selecting", name: "Selecting tickets", help: "Check the performance, ticket count, adjacent-seat requirement and total including all fees." },
  { id: "checkout", name: "Checkout", help: "Confirm your final order matches your hard limits. Finish any bank or identity verification in the official window." },
  { id: "verification", name: "Verify outcome", help: "Check the provider's receipt and order history. Do not repeat a payment if its outcome is uncertain." }
];
const riskStages = new Set<LivePhase>(["checkout", "verification"]);
const terminal = new Set(["completed", "failed", "stopped", "payment_unknown"]);

function money(plan: BookingPlan): string {
  if (!plan.budgetMinor) return tx("No maximum budget set");
  const factor = currencyFactor(plan.currency);
  return plan.currency + " " + (plan.budgetMinor / factor).toLocaleString(undefined, {
    minimumFractionDigits: factor === 1 ? 0 : 2, maximumFractionDigits: factor === 1 ? 0 : 2
  });
}
function summarizeRun(run: BookingRun): { heading: string; action: string; dangerous: boolean } {
  if (run.safetyRecoveryRequired) return { heading: "Purchase safety review required",
    action: "Payment submission is not established. Review purchase safety records before any new attempt.", dangerous: true };
  switch (run.status) {
    case "awaiting_user": return { heading: "Your action is required", action: "Complete the requested step in the provider window, then resume.", dangerous: false };
    case "review": return { heading: "Final order review", action: "Verify all ticket and payment conditions before authorizing a charge.", dangerous: true };
    case "payment_unknown": return { heading: "Payment outcome unknown", action: "Check the official order history or contact the provider. Do not retry payment.", dangerous: true };
    case "completed": return { heading: run.rehearsal ? "Simulation finished" : "Provider receipt recorded", action: run.rehearsal ? "This was not a real purchase." : "Verify the provider receipt and your order history.", dangerous: false };
    case "failed": return { heading: "Run stopped with an error", action: "Inspect the official browser before deciding whether to retry.", dangerous: true };
    case "submitting": return { heading: "Payment submission in progress", action: "Do not refresh, close or attempt another charge.", dangerous: true };
    case "stopped": return { heading: "Automation stopped", action: "Any previously submitted charge must still be checked with the provider.", dangerous: false };
    default: return { heading: "Assistance in progress", action: "Keep the official browser open. No ticket is confirmed yet.", dangerous: false };
  }
}

type Props = {
  plans: BookingPlan[];
  windows: TicketWindow[];
  addons: TicketAddon[];
  history: LiveHistory[];
  selectedPlanId: string | null;
  onSelectPlan: (id: string) => void;
  onBackToPlan: (id: string) => void;
  onStart: (plan: BookingPlan) => Promise<void>;
  onFocus: (id: number) => Promise<void>;
  onClose: (id: number) => Promise<void>;
  onPhase: (id: number, phase: LivePhase) => Promise<void>;
  onDismissHistory: (id: string) => Promise<void>;
  onTicketAgent: (id: number) => Promise<void>;
};

export function LiveBookingWorkspace({
  plans, windows, addons, history, selectedPlanId, onSelectPlan, onBackToPlan,
  onStart, onFocus, onClose, onPhase, onDismissHistory, onTicketAgent
}: Props) {
  const {language}=useLanguage();
  const [runs, setRuns] = useState<BookingRun[]>([]);
  const [advance,setAdvance]=useState<CopilotAdvanceInfo|null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reviewApprovals,setReviewApprovals]=useState<Record<string,{signature:string;at:number}>>({});
  const reviewKey=(run:BookingRun)=>JSON.stringify({id:run.id,order:run.order});
  const isReviewApproved=(run:BookingRun)=>{
    const approved=reviewApprovals[run.id];
    return run.status==="review"&&!!run.order&&!!approved&&
      approved.signature===reviewKey(run)&&Date.now()-approved.at<60_000;
  };
  const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    window.tixbam?.listBookings().then(items => { if (active) setRuns(items); })
      .catch(() => { if (active) setError("Booking run details are currently unavailable."); });
    const off = window.tixbam?.onBookingChanged(run => {
      if (active) setRuns(previous => [...previous.filter(item => item.id !== run.id), run]);
    });
    return () => { active = false; off?.(); };
  }, []);

  const planSessions = useMemo(() => windows.filter(item => item.planId && !item.popup), [windows]);

  const selectedPlan = plans.find(item => item.id === selectedPlanId);
  const activePlan = plans.find(item => planSessions.some(win => win.planId === item.id));
  // An ongoing sale should be visible immediately, even after browsing another plan.
  const chosenPlan = selectedPlan && (!activePlan ||
    planSessions.some(win => win.planId === selectedPlan.id)) ? selectedPlan :
    activePlan || selectedPlan || plans.find(item => item.id === history[0]?.planId) || null;
  const plan = chosenPlan;
  const matching = planSessions.filter(item => item.planId === plan?.id);
  const primary = matching[matching.length - 1];
  const extra = windows.filter(item => item.planId === plan?.id && item.popup);
  const remainingPopup = !primary && extra.length ? extra[extra.length - 1] : null;
  const selectedWindow = [...matching,...extra].find(item => item.id === selectedWindowId) || primary || extra[0];
  const relatedRuns = runs.filter(run => !run.rehearsal && (!selectedWindow
    ? false : run.windowId === selectedWindow.id));
  const orphanRuns = runs.filter(run => !run.rehearsal && (!run.windowId ||
    !windows.some(win => win.id === run.windowId)));
  const standalone = windows.filter(item => !item.planId);
  const unknownLinked = windows.filter(item => item.planId && !plans.some(p => p.id === item.planId) && !item.popup);
  const planHistory = history.filter(item => plans.some(p => p.id === item.planId));
  const advancedWindowId=selectedWindow?.id ?? primary?.id ?? null;
  const guide=bookingGuide(selectedWindow,advance,language==="ko");
  useEffect(()=>{
    let active=true;
    setAdvance(null);
    if(advancedWindowId===null)return;
    const off=window.tixbam?.onCopilotAdvanceUpdate(info=>{
      if(!active || info.planId!==plan?.id)return;
      setAdvance(info);
      // Follow the sole active executor when an official seat flow moves into
      // a linked, allowlisted popup; never create a second booking session.
      if(info.reason.includes('linked official provider popup'))
        setSelectedWindowId(info.windowId);
    });
    void window.tixbam?.copilotAdvanceStatus(advancedWindowId)
      .then(info=>{if(active)setAdvance(info);}).catch(()=>{});
    return()=>{active=false;off?.();};
  },[advancedWindowId,plan?.id]);

  async function invoke(key: string, operation: () => Promise<unknown>) {
    setBusy(key); setError("");
    try { await operation(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not perform that action."); }
    finally { setBusy(""); }
  }

  function openCopilotTools(){
    const element=document.getElementById("live-copilot-tools") as HTMLDetailsElement|null;
    if(element){element.open=true;element.scrollIntoView({behavior:"smooth",block:"start"});}
  }
  async function guideAction(){
    if(guide.action==="tools"){openCopilotTools();return;}
    if(guide.action==="open" && plan){await invoke("start",()=>onStart(plan));return;}
    if(selectedWindow)await invoke("focus",()=>onFocus(selectedWindow.id));
  }
  async function resumeAdvance(){
    if(!advance||!window.tixbam)return;
    await invoke("resume-advance",async()=>{
      const next=await window.tixbam!.copilotAdvanceResume(advance.windowId);
      setAdvance(next);
    });
  }
  async function runControl(run: BookingRun, action: "resume" | "stop") {
    if (!window.tixbam) return;
    if (action === "stop" && !window.confirm("Stop TIXBAM automation? This does not cancel any order already submitted to the ticket provider.")) return;
    if (action === "resume" && run.status === "review") {
      const order = run.order;
      if (!order) { setError("No verifiable order to review."); return; }
      if (!isReviewApproved(run)){
        setError(tx("Approval expired or order changed. Review and confirm the exact order again."));
        return;
      }
      const amount = (order.totalMinor / currencyFactor(order.currency)).toFixed(currencyFactor(order.currency) === 1 ? 0 : 2);
      if (!window.confirm(tx("Authorize the exact displayed order and submit payment once?") + "\n" +
        tr("{count} ticket(s)", {count: order.quantity}) + ", " + order.currency + " " + amount +
        " " + tx("including fees.") + "\n" + tx("Verify the official provider page first."))) return;
    }
    await invoke("run-" + run.id, async () => {
      const updated = action === "stop"
        ? await window.tixbam!.stopBooking(run.id)
        : await window.tixbam!.resumeBooking(run.id, run.status === "review");
      setReviewApprovals(current=>{const next={...current};delete next[run.id];return next;});
      setRuns(previous => [...previous.filter(item => item.id !== updated.id), updated]);
    });
  }

  return <section className="live-workspace">
    <div className="section-heading">
      <div>
        <span className="eyebrow">LIVE BOOKING · OFFICIAL PROVIDER WINDOWS</span>
        <h2>{language==="ko"?"실전 예매 도우미":"Live booking assistant"}</h2>
        <p>{language==="ko"
          ?"지금 해야 할 행동을 확인하고 공식 예매창에서 진행하세요. 필요한 순간에만 화면 분석 도구를 사용하면 됩니다."
          :"Follow the next action in the official booking window. Open screen guidance only when needed."}</p>
      </div>
      <span className="counter-badge"><Monitor size={14}/>{tr("Browser windows: {count}", { count: windows.length })}</span>
    </div>
    {error && <p role="alert" className="form-error">{tx(error)}</p>}
    {planHistory.length > 0 && <div className="live-recovery" role="alert">
      <div className="live-recovery-head"><AlertTriangle size={21}/>
        <div><strong>Review previous ticketing sessions</strong>
          <p>These windows were closed or interrupted. TIXBAM did not restore their queue position or payment state.</p></div>
      </div>
      {planHistory.map(item => {
        const previous = plans.find(p => p.id === item.planId);
        return <div className="live-recovery-item" key={item.planId}>
          <span><b>{previous?.artist || "Booking plan"}</b> · {item.reason === "interrupted" ? "Session interrupted" : "Window closed"} · {localDate(item.updatedAt)}
            {riskStages.has(item.phase) ? tx(" · Checkout may need verification") : ""}</span>
          <button className="button button-outline" disabled={busy !== ""} onClick={() => void invoke("dismiss-" + item.planId, () => onDismissHistory(item.planId))}>
            Dismiss reminder</button>
        </div>;
      })}
      <p className="live-warning">If you attempted payment, check the ticket provider's order history before paying again. Dismissing a reminder never confirms a purchase.</p>
    </div>}
    <div className="live-target-switcher">
      {planSessions.length ? planSessions.map(win => {
        const p = plans.find(item => item.id === win.planId);
        return <button key={win.id} className={"live-target" + (plan?.id === win.planId ? " selected" : "")}
          onClick={() => { if (win.planId) { onSelectPlan(win.planId); setSelectedWindowId(win.id); } }}>
          <TicketCheck size={15}/><span>{p?.artist || "Linked session"}</span><small>{addons.find(addon => addon.id === win.providerId)?.name || win.providerId} · #{win.id}</small>
        </button>;
      }) : <p>No live Booking Plan window is open. Choose a plan below to launch its official website.</p>}
    </div>
    {plan && <section className="live-guide" data-testid="live-booking-guide"
      aria-label={language==="ko"?"지금 해야 할 예매 단계":"Your next booking step"}>
      <div className="live-guide-top">
        <span className="eyebrow">{language==="ko"?"지금 해야 할 일":"YOUR NEXT STEP"}</span>
        <span className="live-guide-limit">{tr("{count} ticket(s)",{count:plan.quantity})} · {money(plan)} {tx("including fees")}</span>
      </div>
      <div className="live-guide-steps" role="list"
        aria-label={language==="ko"?"예매 진행 안내":"Booking progress guide"}>
        {(language==="ko"
          ? ["접속 · 로그인","대기 · 입장","좌석 · 선택","주문 · 확인"]
          : ["Open · Sign in","Wait · Enter","Choose a seat","Review · Verify"])
          .map((item,i)=><span key={item} role="listitem"
            className={"live-guide-step"+(i===guide.step?" active":i<guide.step?" passed":"")}>
            <span>{i+1}</span>{item}</span>)}
      </div>
      <h2 data-testid="live-guide-heading">{guide.title}</h2>
      <p className="live-guide-description">{guide.instruction}</p>
      <div className="live-guide-actions">
        <button className="button button-primary" data-testid="live-guide-primary"
          disabled={!!busy} onClick={()=>void guideAction()}>{guide.action==="open"
            ? (language==="ko"?"공식 예매창 열기":"Open official window")
            :guide.action==="tools"
              ? (language==="ko"?"화면 분석 · 좌석 도움":"Open seat-selection guide")
              : (language==="ko"?"공식 예매창 확인":"View official window")}
          <ArrowRight size={16}/></button>
        {selectedWindow && guide.action==="tools" &&
          <button className="button button-outline" disabled={!!busy}
            onClick={()=>void invoke("focus",()=>onFocus(selectedWindow.id))}>
            <ExternalLink size={15}/>{language==="ko"?"공식 창으로 이동":"Go to provider window"}</button>}
        {selectedWindow && guide.kind==="signin" && !looksLikeSignIn(selectedWindow.url) &&
          advance?.providerStep?.step!=="human_gate" && !selectedWindow.loadError &&
          <button className="button button-outline" data-testid="live-guide-mark-selecting"
            disabled={!!busy} onClick={()=>{
              if(!window.confirm(language==="ko"
                ?"공식 예매창에서 실제 티켓·좌석 선택 화면이 열렸나요? 로그인·대기열·결제 중이라면 취소하세요."
                :"Are you actually on the ticket-selection page? Cancel during login, queue or checkout."))return;
              void invoke("stage",()=>onPhase(selectedWindow.id,"selecting"));
            }}>{language==="ko"?"좌석 선택 화면에 들어왔어요":"I'm selecting tickets"}</button>}
        {selectedWindow && ["awaiting_user","paused"].includes(advance?.status||"") &&
          <button className="button button-outline" disabled={!!busy}
            onClick={()=>void resumeAdvance()}>
            {language==="ko"?"직접 조작을 마쳤어요 · 계속":"I finished · Resume assistance"}</button>}
      </div>
      {guide.step===2 && advance?.strategyInfo?.recommended && advance.strategyInfo.recommended.length>0 &&
        <div className="live-guide-offers" data-testid="live-guide-candidates" role="note">
          <strong>{language==="ko"?"AI가 확인한 좌석 후보 순서 · 실제 재고 미확인":
            "AI-suggested seat order · availability unverified"}</strong>
          {advance.strategyInfo.recommended.slice(0,3).map((offer,index)=>
            <p key={index}><span>{index+1}. {offer.label}</span>
              {offer.usedFallback && <em>{language==="ko"?"대안":"Alternative"}</em>}
              {offer.apparentTotalMinor!==null&&offer.apparentTotalMinor!==undefined &&
                <small>KRW {offer.apparentTotalMinor.toLocaleString()} · {language==="ko"?
                  "AI 추정가":"Visual estimate"}</small>}</p>)}
          <small>{language==="ko"?"공식 사이트에서 조건·좌석·가격을 직접 확인하세요.":
            "Confirm seat, price and conditions in the official site."}</small>
        </div>}
      <p className="live-guide-note"><ShieldAlert size={14}/>{guide.caution}</p>
      <p className="live-guide-confidence">{language==="ko"
        ?"안내는 참고용입니다. 공식 사이트에서 단계와 확보 여부를 확인하세요."
        :"Guidance is advisory. Verify the stage and any hold in the official site."}</p>
    </section>}
    {plan ? <div className="live-workspace-grid">
      <div className="live-main">
        <div className="live-site-card">
          <div className="live-site-head">
            <div><span className="eyebrow">CURRENT TARGET</span><h3>{plan.artist} · {plan.title}</h3>
              <p>{addons.find(a => a.id === plan.providerId)?.name || plan.providerId}{plan.city ? " · " + plan.city : ""}</p>
            </div>
            <button className="button button-outline" onClick={() => onBackToPlan(plan.id)}><ArrowLeft size={15}/> Plan</button>
          </div>
          <div className="live-sale-time">
            <SaleCountdown saleAt={plan.saleAt}/>
            <span>{plan.saleAt ? tx("Scheduled sale:") + " " + formatSaleLocalTime(plan.saleAt, plan.timezone || undefined) :
              "Official sale date not yet published"}</span>
          </div>
          <div className="live-browser-status">
            <Globe2 size={20}/>
            <div className="live-browser-meta"><strong>{selectedWindow ? selectedWindow.site || "Official browser" : "Official browser not opened"}</strong>
              <span>{selectedWindow?.loadError ? "The provider page reported a load failure. Inspect its window before taking action." :
                selectedWindow?.loading ? "Browser loading — do not reload unnecessarily" :
                selectedWindow ? "Window open · Site steps are not automatically detected" : "Open the official site when you are ready"}</span>
            </div>
            {selectedWindow?.loadError ? <span className="live-state live-error">Load error</span> :
              selectedWindow ? <span className="live-state">{selectedWindow.loading ? "Loading" : "Open"}</span> :
              <span className="live-state">Not opened</span>}
          </div>
          <div className="live-actions">
            {addons.find(addon => addon.id === plan.providerId)?.bookingAssistance?.mode === "manual" &&
              <button className="button button-outline" onClick={() => onBackToPlan(plan.id)}>{tx("Edit booking conditions")}</button>}
            {selectedWindow ? <button className="button button-outline" disabled={busy !== ""}
                onClick={() => void invoke("focus", () => onFocus(selectedWindow.id))}><ExternalLink size={16}/> Focus official site</button> :
              remainingPopup ? <button className="button button-primary" disabled={busy !== ""}
                onClick={() => void invoke("focus-popup", () => onFocus(remainingPopup.id))}>
                <ExternalLink size={16}/> Focus remaining verification popup</button> :
              <button className="button button-primary" disabled={busy !== "" || !plan.bookingUrl}
                onClick={() => void invoke("start", () => onStart(plan))}><ExternalLink size={16}/> Open official ticket site</button>}
            {selectedWindow && <button className="button button-outline" disabled={busy !== ""}
              onClick={() => void invoke("close", () => onClose(selectedWindow.id))}><X size={16}/> Close browser…</button>}
            {selectedWindow && addons.find(a => a.id === selectedWindow.providerId)?.kind === "event-presale" &&
              <button className="button button-outline" disabled={busy !== ""}
                onClick={() => void invoke("agent", () => onTicketAgent(selectedWindow.id))}>Open official ticket agent <ArrowRight size={15}/></button>}
          </div>
          {remainingPopup && <p className="live-warning">The main ticket window is closed, but a provider popup is still open. Check it before starting another booking attempt.</p>}
          {extra.length > 0 && <div className="live-popups"><strong>{tx("Provider popups")} ({extra.length})</strong>
            <p>Login and payment verification can open additional windows. They are not extra queue positions.</p>
            {extra.map(win => <div key={win.id} className="live-popup-action">
              <span>#{win.id} · {win.site || "loading"}</span>
              <button className="button button-outline" onClick={() => setSelectedWindowId(win.id)}>
                {selectedWindow?.id === win.id ? "✓ " : ""}{tx("Use in Copilot")}
              </button>
              <button className="button button-outline" onClick={() => void invoke("popup" + win.id, () => onFocus(win.id))}>{tx("Focus popup")}</button>
            </div>)}
          </div>}
        </div>
        {selectedWindow?.popup && <p className="live-manual-label">
          {tr("Copilot target: linked popup #{id}",{id:selectedWindow.id})} · {selectedWindow.site}. {tx("Only supported ticket-provider pages are eligible.")}
        </p>}
        {primary && selectedWindow?.popup && <button className="button button-outline" onClick={() => setSelectedWindowId(primary.id)}>{tx("Use main browser in Copilot")}</button>}
        {advance && advance.status!=="off" && <div className="live-automation-card live-advance-card" role="status">
          <div className="live-card-head"><ShieldAlert size={18}/>
            <h3>{language==="ko"?"예매 도우미 진행 상태":"Booking assistant status"}</h3></div>
          <p>{language==="ko"
            ?advance.status==="hold_unverified"?"공식 예매창에서 좌석 확보 여부를 확인해야 해요."
              :advance.status==="awaiting_user"?"필요한 조작을 마쳤다면 위의 '계속' 버튼을 누르세요."
                :"공식 예매창의 진행을 도와드리고 있어요."
            :advance.status==="hold_unverified"?"Verify the seat hold in the official window."
              :advance.status==="awaiting_user"?"Finish the action in the provider window, then resume."
                :"Assistance follows the official booking window."}</p>
          <details className="live-diagnostics" data-testid="live-diagnostics">
            <summary>{language==="ko"?"고급 진단 · 엔진 상태 확인":"Advanced diagnostics · engine status"}</summary>
            <div className="live-card-head"><h4>{language==="ko"?"사전 승인 코파일럿":"Advance-approved Copilot"}</h4></div>
          <p><strong>{advance.status==="progress"
            ? (language==="ko"?"자동 예매 단계 진행 중":"Continuing approved steps")
            : advance.status==="observing"
              ? (language==="ko"?"다음 동작 분석 중":"Analyzing next step")
              : advance.status==="awaiting_user"
                ? (language==="ko"?"사용자 조작 대기":"Waiting for user")
                : advance.status==="hold_unverified"
                  ? (language==="ko"?"좌석 보류 확인 필요":"Verify seat hold")
                  : advance.status==="guiding"
                    ? (language==="ko"?"화면 안내 중":"Guidance active")
                    : advance.status==="paused"
                      ? (language==="ko"?"일시 중단":"Paused")
                      : advance.status==="stopped"
                        ? (language==="ko"?"중지됨":"Stopped")
                        : (language==="ko"?"준비됨":"Armed")}</strong> · {advance.reason}</p>
          {advance.providerId==="nol" && advance.validationMetrics &&
            <p className="settings-note" role="status">
              <strong>{language==="ko"?"NOL 검증 진단":"NOL validation diagnostics"}</strong>
              {" · "}{language==="ko"?"화면 분석":"Observations"}: {advance.validationMetrics.observationCount}
              {" · "}{language==="ko"?"인계":"Manual pauses"}: {advance.validationMetrics.manualPauses}
              {" · "}{language==="ko"?"대기열 진입/복귀":"Queue transitions"}:
              {" "}{advance.validationMetrics.queueEntries}/{advance.validationMetrics.queueResumptions}
              {advance.validationMetrics.observationLatencyMs.p95!==null &&
                <span> · P95 {language==="ko"?"분석 소요":"analysis elapsed"}:
                  {" "}{advance.validationMetrics.observationLatencyMs.p95}ms</span>}
              {" · "}{language==="ko"
                ?"비식별 세션 진단값 · 티켓 확보 검증 아님"
                :"Aggregate session data only · not ticket hold verification"}
            </p>}
          {advance.providerId==="nol" && advance.holdEvidence && <p className="settings-note" role="status">
            <strong>{language==="ko"?"NOL 공식 좌석 보류 검증: 미연결":"NOL official seat hold verification: unavailable"}</strong>
            {" · "}{language==="ko"
              ?"공식 예매창에서 좌석, 1장, 수수료 포함 총액과 남은 시간을 직접 확인하세요. 화면 진입만으로 좌석이 확보된 것은 아닙니다."
              :"Check the official window for one ticket, final fees and hold expiration. Reaching checkout does not secure a seat."}
          </p>}
          {advance.providerId==="nol" && advance.providerStep && <p className="settings-note" role="status">
            <strong>{language==="ko"?"NOL 화면 진단: ":"NOL screen check: "}</strong>
            {({
              event_detail:language==="ko"?"공연 상세":"Event details",
              selection_unknown:language==="ko"?"티켓 선택 단계 (세부 미확인)":"Ticket selection (substep unknown)",
              human_gate:language==="ko"?"사용자 조작 필요":"Manual step required",
              checkout_unverified:language==="ko"?"결제 단계 / 좌석 보류 미확인":"Checkout / hold unverified",
              unknown:language==="ko"?"화면 단계 미확인":"Unknown stage"
            })[advance.providerStep.step]}
            {advance.providerStep.evidence==="visual_hint"
              ? " · "+Math.round(advance.providerStep.confidence*100)+"%" : ""}
            {advance.providerStep.substep && advance.providerStep.substep!=="unknown" &&
              <span> · {({
                event_detail:language==="ko"?"공연 상세":"Event details",
                performance_date:language==="ko"?"날짜·회차 선택":"Date / performance",
                seat_map:language==="ko"?"좌석 배치·구역 선택":"Seat map / section",
                price_quantity:language==="ko"?"가격·매수 선택":"Price / quantity",
                seat_conflict:language==="ko"?"좌석 선택 충돌 · 사용자 확인":"Seat conflict · review needed",
                sold_out:language==="ko"?"매진 표시 · 사용자 확인":"Sold out · review needed",
                cart_review:language==="ko"?"장바구니·주문 검토 · 보류 미확인":"Cart / review · hold unverified",
                human_gate:language==="ko"?"인증·대기열 · 사용자 조작":"Authentication / queue · user action"
              })[advance.providerStep.substep]}</span>}
            {language==="ko"?" · 이 진단은 좌석 확보 증거가 아닙니다.":" · Not proof of a seat hold."}
          </p>}
          {advance.providerId==="nol" && advance.strategyInfo &&
            <div className="copilot-candidates" role="status">
              <strong>{language==="ko"?"NOL · 1장 우선 후보 검토":"NOL · one-ticket candidate review"}</strong>
              <p>{advance.strategyInfo.reason}</p>
              {advance.strategyInfo.recommended.slice(0,3).map((item,i)=>
                <p key={i}>
                  {i+1}. {item.label}{item.usedFallback
                    ? (language==="ko"?" · 대안":" · fallback") : ""}
                  {item.apparentTotalMinor!==null && item.apparentTotalMinor!==undefined
                    ? " · KRW "+item.apparentTotalMinor.toLocaleString()+
                      (item.feesShownIncluded
                        ? (language==="ko"?" (AI 추정 수수료 포함)":" (AI visual all-in estimate)")
                        : (language==="ko"?" (수수료 미확인)":" (fees unknown)"))
                    : ""}
                  {" · "}{language==="ko"?"공식 화면 확인 필요":"verify on official page"}
                </p>)}
              {advance.strategyInfo.recovery && <p>
                {language==="ko"?"실패 처리: ":"Recovery: "}{advance.strategyInfo.recovery.reason}
              </p>}
              <p className="settings-note">{language==="ko"
                ?"화면 인식 후보는 실제 재고·금액·좌석 보류 증명이 아닙니다. 검증 전에는 자동 확정하지 않습니다."
                :"Visual candidates do not prove ticket inventory, total price or a held seat. No unverified auto-confirmation."}</p>
            </div>}
          <p className="settings-note">{language==="ko"
            ?"사전 승인한 동작만 화면별로 검증해 이어서 진행합니다. 로그인·대기열·CAPTCHA·결제는 사용자가 직접 처리해야 합니다. 클릭 자체는 좌석 확보의 증거가 아닙니다."
            :"Approved non-payment actions continue across screens. Login, queue and payment require you. A click does not prove a seat hold."}</p>
          {advance.attempts!==undefined&&<small>{language==="ko"?"AI 분석":"AI observations"}: {advance.attempts}/24 · {language==="ko"?"자동 클릭":"Automatic clicks"}: {advance.automaticClicks??0}/20</small>}
          {advance.targets.length>0&&<div className="copilot-candidates">
            {advance.targets.map((target,index)=><p key={index}>
              {target.label} · {Math.round(target.confidence*100)}% · {target.reason}
            </p>)}
          </div>}
          {(advance.status==="awaiting_user" || advance.status==="paused") &&
            <button className="button button-primary" onClick={()=>void invoke("resume-advance",async()=>{
              const next=await window.tixbam!.copilotAdvanceResume(advance.windowId);
              setAdvance(next);
            })}>{language==="ko"?"사용자 조작 완료 · 계속 진행":"I finished · Resume Copilot"}</button>}
          {!["stopped","off"].includes(advance.status) &&
            <button className="button button-outline" onClick={()=>
              void invoke("stop-advance",async()=>{
                await window.tixbam?.copilotAdvanceStop(advance.windowId);
                setAdvance(null);
              })}>{language==="ko"?"자동화 중지":"Stop automation"}</button>}
          </details>
        </div>}
        <details className="live-tools-disclosure" id="live-copilot-tools"
          data-testid="live-copilot-tools">
          <summary>{language==="ko"?"화면 분석 · 클릭 위치 도우미":"Screen analysis · click guide"}</summary>
          <p className="live-tools-description">{language==="ko"
            ?"공식 창에서 티켓 선택 화면까지 진행한 다음, 여기서 화면을 가져오고 필요한 버튼의 위치를 확인하세요."
            :"After reaching ticket selection in the provider window, capture the screen here and inspect suggested buttons."}</p>
        <LiveCopilotPanel
          key={String(selectedWindow?.id ?? plan.id)+":"+String(selectedWindow?.phase)+":"+String(selectedWindow?.url)+":"+String(selectedWindow?.loading)}
          bookingWindow={selectedWindow} plan={plan}
          onSelectTicketStep={() => onPhase(selectedWindow!.id, "selecting")}/>
        </details>
        {addons.find(addon => addon.id === plan.providerId)?.bookingAssistance?.mode === "manual" && (
          <details className="live-tools-disclosure">
            <summary>{language==="ko"?"예매처별 실전 도움말":"Provider-specific instructions"}</summary>
          <ProviderLiveGuide key={selectedWindow?.id ?? plan.id}
            addon={addons.find(addon => addon.id === plan.providerId)!}
            phase={selectedWindow?.phase || "preparing"}/>
          </details>
        )}
        {relatedRuns.length>0 && <div className="live-automation-card">
          <div className="live-card-head"><ShieldAlert size={19}/><h3>Booking assistance</h3></div>
          <p>Automation is not guaranteed for this provider. It must not bypass CAPTCHA, the queue or bank verification.</p>
          {relatedRuns.length ? relatedRuns.map(run => {
            const status = summarizeRun(run);
            return <div key={run.id} className={"live-run"+(status.dangerous ? " live-run-alert" : "")}>
              <strong>{tx(status.heading)}</strong><p>{run.message}</p><p>{tx(status.action)}</p>
              {run.status === "review" && run.order && <p><b>Order:</b> {tr("{count} ticket(s)", { count: run.order.quantity })} · {run.order.currency} {(run.order.totalMinor / currencyFactor(run.order.currency)).toFixed(currencyFactor(run.order.currency) === 1 ? 0 : 2)} {tx("including fees")} · {run.order.seats.join(", ")}</p>} 
              {run.status==="review"&&run.order&&<div className="booking-review-panel" role="group" aria-label={tx("Final order approval")}>
                <strong>{tx("Final order approval")}</strong>
                <p>{tx("Manually verify the official provider window; unknown fees, seats or restricted terms must not be approved.")}</p>
                <dl><dt>{tx("Performance")}</dt><dd>{run.order.performance||tx("Not verified")}</dd>
                  <dt>{tx("Price tier")}</dt><dd>{run.order.priceTier||tx("Not verified")}</dd>
                  <dt>{tx("Seat allocation type")}</dt><dd>{tx(run.order.seatMode||"Not verified")}</dd>
                  <dt>{tx("Seats")}</dt><dd>{run.order.seats.length?run.order.seats.join(", "):tx("Standing / allocation details require confirmation")}</dd>
                  <dt>{tx("Restricted view")}</dt><dd>{run.order.restrictedView===undefined?tx("Not verified"):run.order.restrictedView?tx("Yes"):tx("No")}</dd>
                  <dt>{tx("Real-name requirement")}</dt><dd>{run.order.realNameRequired===undefined?tx("Not verified"):run.order.realNameRequired?tx("Yes"):tx("No")}</dd>
                  <dt>{tx("Optional extra products")}</dt><dd>{run.order.extras?.length?run.order.extras.map(item=>item.id).join(", "):tx("None included")}</dd>
                </dl>
                <label className="booking-review-check">
                  <input type="checkbox" checked={isReviewApproved(run)}
                    onChange={event=>setReviewApprovals(current=>{
                      if(!event.target.checked){const next={...current};delete next[run.id];return next;}
                      return {...current,[run.id]:{signature:reviewKey(run),at:Date.now()}};
                    })}/>
                  {tx("I personally checked the exact order. This approval is one-use and expires in 60 seconds.")}
                </label>
                <p>{tx("Actual unattended provider payment remains disabled.")}</p>
              </div>}
              {run.receipt && <p>Receipt reference reported by provider: {run.receipt}</p>}
              <div className="booking-actions">
                {["review", "awaiting_user"].includes(run.status) && <button className="button button-primary"
                  disabled={Boolean(busy)||(run.status==="review"&&!isReviewApproved(run))} onClick={() => void runControl(run, "resume")}>
                  {run.status === "review" ? "Review and authorize payment…" : "Resume after completing required step"}</button>}
                {!terminal.has(run.status) && <button className="button button-outline"
                  disabled={Boolean(busy)} onClick={() => void runControl(run, "stop")}>Stop assistance</button>}
              </div>
            </div>;
          }) : null}
        </div>}
      </div>
      <aside className="live-assistant">
        <div className="live-assistant-card">
          <h3><Clock3 size={18}/>{language==="ko"?"나의 예매 목표":"Your booking target"}</h3>
          <p><b>{tr("{count} ticket(s)", { count: plan.quantity })}</b> · {money(plan)} {tx("including fees")}</p>
          <p>{plan.requireTogether ? "Adjacent seats required" : "Separate seats allowed"}
            · {plan.allowFallback ? "Ranked alternatives allowed" : "No unranked alternatives"}</p>
          <details className="live-seat-summary live-target-details" role="note">
            <summary>{language==="ko"?"구역·등급·제한 조건 자세히 보기":"Seat and restrictions details"}</summary>
            <strong>{tx("Mode: manual / reviewed assistance only")}</strong>
            <p>{tx("Unattended checkout is disabled unless the ticket agent explicitly authorizes it and the implementation is verified.")}</p>
            {plan.seatPreferences&&<p>{tx("Seat allocation type")}: {tx(plan.seatPreferences.seatMode||"No seat mode preference")}
              {plan.seatPreferences.priceTier.length>0&&<> · {tx("Price tier")}: {plan.seatPreferences.priceTier.join(" → ")}</>}
              {plan.seatPreferences.section.length>0&&<> · {tx("Section")}: {plan.seatPreferences.section.join(" → ")}</>}
            </p>}
            <p>{tx("High-risk permissions")}: {[
              plan.terms?.allowRestrictedView&&tx("Restricted view"),
              plan.terms?.allowRealName&&tx("Real-name requirement"),
              plan.terms?.allowAgeRestricted&&tx("Age restriction"),
              plan.terms?.allowAccessibilityRestricted&&tx("Accessibility restriction")
            ].filter(Boolean).join(", ")||tx("None approved")}</p>
          </details>
          {!plan.preferencesReady && <p className="live-warning">Preferences have not been marked ready in the Booking Plan.</p>}
        </div>
        <details className="live-assistant-card live-stage-disclosure">
          <summary>{language==="ko"?"실제 화면과 다르면 단계 수정":"Correct the stage if it differs from the site"}</summary>
          <h3>{language==="ko"?"현재 안내 단계 · 직접 선택":"Current step · chosen by you"}</h3>
          <p className="live-stage-disclaimer">TIXBAM cannot reliably detect the ticket site's queue, seats or payment status. Choose the stage yourself only to see relevant guidance.</p>
          {selectedWindow ? <>
            <label htmlFor="live-step">My current stage</label>
            <select id="live-step" value={selectedWindow.phase || "preparing"} disabled={Boolean(busy)}
              onChange={e => void invoke("stage", () => onPhase(selectedWindow.id, e.target.value as LivePhase))}>
              {steps.map(step => <option key={step.id} value={step.id}>{tx(step.name)}</option>)}
            </select>
            <p className="live-next-action">{tx(steps.find(s => s.id === (selectedWindow.phase || "preparing"))?.help || "")}</p>
            {riskStages.has(selectedWindow.phase || "preparing") && <p className="live-warning"><AlertTriangle size={15}/> Never retry an uncertain payment automatically.</p>}
          </> : <p>Open the official browser first. Its exact stage will not be inferred by TIXBAM.</p>}
        </details>
        <details className="live-assistant-card live-safety-disclosure">
          <summary><LockKeyhole size={17}/>{language==="ko"?"안전하게 예매하기":"Booking safety"}</summary>
          <p>No verified provider receipt means no confirmed purchase. Avoid extra windows and refreshes during a queue. Keep your bank authentication available.</p>
        </details>
      </aside>
    </div> : <div className="empty-state"><Layers3 size={35}/>
      <h3>No Booking Plan selected</h3><p>Prepare your target ticket sale in My Bookings, then open its official browser here.</p>
      <button className="button button-outline" onClick={() => plans[0] && onSelectPlan(plans[0].id)}
        disabled={!plans.length}>Select first plan</button>
    </div>}
    {unknownLinked.length > 0 && <section className="live-other-windows">
      <h3>Windows from another or unavailable plan</h3>
      <p>Ticket-site logins remain on this device after TIXBAM account changes. These windows are not assigned to the current account's plans; do not assume they represent the current target.</p>
      {unknownLinked.map(win => <div key={win.id} className="live-other-row">
        <span>#{win.id} · {addons.find(a => a.id === win.providerId)?.name || win.providerId} · {win.site || "Loading"}</span>
        <button className="button button-outline" disabled={Boolean(busy)} onClick={() => void invoke("focus"+win.id, () => onFocus(win.id))}>Focus</button>
        <button className="button button-outline" disabled={Boolean(busy)} onClick={() => void invoke("close"+win.id, () => onClose(win.id))}>Close…</button>
      </div>)}
    </section>}
    {standalone.length > 0 && <section className="live-other-windows"><h3>Other provider windows</h3>
      <p>These browser windows were not launched from a Booking Plan. Avoid confusing them with your active ticket target.</p>
      {standalone.map(win => <div key={win.id} className="live-other-row">
        <span>#{win.id} · {addons.find(a => a.id === win.providerId)?.name || win.providerId} · {win.site || "loading"}</span>
        <button className="button button-outline" onClick={() => void invoke("focus" + win.id, () => onFocus(win.id))}>Focus</button>
        <button className="button button-outline" onClick={() => void invoke("close" + win.id, () => onClose(win.id))}>Close</button>
      </div>)}
    </section>}
    {orphanRuns.length > 0 && <section className="live-other-windows"><h3>Other booking runs</h3>
      <p>These runs no longer have a tracked official browser window. They must not be treated as confirmed purchases.</p>
      {orphanRuns.map(run => <div className="live-other-row" key={run.id}><strong>{run.status.replaceAll("_", " ")}</strong><span>{run.message}</span>
        {["review", "awaiting_user"].includes(run.status) && <button className="button button-outline"
          disabled={Boolean(busy)} onClick={() => void runControl(run, "stop")}>Stop run</button>}</div>)}
    </section>}
  </section>;
}