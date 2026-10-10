import { useEffect, useState, type MouseEvent } from "react";
import { Crosshair, Eye, MousePointerClick, ShieldAlert } from "lucide-react";
import type { BookingPlan } from "../booking-plans";
import type { CopilotSnapshot, CopilotSuggestion, TicketWindow } from "../types";
import { useLanguage } from "../i18n";

/** The image is a local one-shot provider preview, not an AI prediction.
 * Never run background captures, make automatic clicks or upload the image.
 */
export function LiveCopilotPanel({ bookingWindow, plan, onSelectTicketStep }: {
  bookingWindow: TicketWindow | undefined; plan: BookingPlan;
  onSelectTicketStep: () => Promise<void>;
}) {
  const { language } = useLanguage();
  const ko = language === "ko";
  const [snapshot, setSnapshot] = useState<CopilotSnapshot | null>(null);
  const [point, setPoint] = useState<{x:number;y:number} | null>(null);
  const [targets, setTargets] = useState<CopilotSuggestion[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setSnapshot(null); setPoint(null); setTargets([]);setError("");setNotice(""); },
    [bookingWindow?.id, bookingWindow?.phase, bookingWindow?.url, bookingWindow?.loading, plan.id]);
  const previewOnly = bookingWindow?.phase === "preparing";
  const eligible = bookingWindow && !bookingWindow.popup &&
    (bookingWindow.phase === "selecting" || previewOnly) &&
    !bookingWindow.loading && !bookingWindow.loadError;
  async function capture() {
    if (!bookingWindow || !window.tixbam) return;
    setBusy("capture");setError("");setNotice("");setSnapshot(null);setPoint(null);setTargets([]);
    try {
      const next = await window.tixbam.copilotCapture(bookingWindow.id);
      setSnapshot(next);
      setNotice(next.mode === "diagnostic_preview"
        ? (ko ? "NOL 등 공식 예매 페이지의 화면 연결이 확인됐어. 이 단계에서는 클릭과 AI 분석이 잠겨 있어." :
          "Official browser preview captured. AI analysis and click actions are disabled at this stage.")
        : (ko ? "아래 이미지는 로컬에서 캡처한 현재 화면이야. 직접 클릭할 위치를 지정해." :
          "This is a local preview. Choose a target yourself; AI has not selected a button."));
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  function choose(event: MouseEvent<HTMLImageElement>) {
    if(!snapshot || snapshot.mode !== "human_guidance") return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    setPoint({x:Math.max(0.001,Math.min(0.999,(event.clientX-rect.left)/rect.width)),
      y:Math.max(0.001,Math.min(0.999,(event.clientY-rect.top)/rect.height))});
    setNotice("");
  }
  async function analyze() {
    if(!snapshot||snapshot.mode!=="human_guidance"||!window.tixbam||!bookingWindow)return;
    const consent=ko
      ? "이 화면 이미지를 AI 분석을 위해 TixBam 서버와 OpenRouter 모델에 1회 전송할까? 화면에 개인정보가 보이면 취소해. AI는 클릭을 실행하지 않아."
      : "Send this screenshot once to TixBam's server and an OpenRouter AI model? Cancel if personal data is visible. AI will NOT click.";
    if(!window.confirm(consent))return;
    setBusy("ai");setError("");setNotice("");setTargets([]);
    try {
      const result=await window.tixbam.copilotAnalyze(bookingWindow.id,snapshot.token,{
        quantity:plan.quantity,currency:plan.currency,budgetMinor:plan.budgetMinor,
        locale:language
      });
      if(!result.advisoryOnly||!result.humanApprovalRequired||result.snapshotToken!==snapshot.token)
        throw new Error("Unexpected vision result");
      setTargets(result.targets);
      setNotice(result.targets.length
        ? (ko?"AI가 후보를 찾았어. 반드시 화면에서 직접 확인한 뒤 선택해.":"AI found candidate targets. Verify them visually before choosing.")
        : (ko?"확실한 버튼을 찾지 못했어. 직접 선택하거나 화면을 다시 촬영해.":"No sufficiently confident targets. Choose manually or recapture."));
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy("");}
  }
  async function action(kind:"highlight"|"click") {
    if (!snapshot || snapshot.mode !== "human_guidance" || !point || !window.tixbam || !bookingWindow) return;
    if (kind==="click"&&!window.confirm(ko
      ? "직접 지정한 위치에 실제 클릭 1회를 보낼까? 공식 사이트의 내용을 다시 확인해. 자동 좌석 확보 또는 구매가 아니야."
      : "Send one REAL click to your chosen location? Check the official page first. This is NOT automatic booking.")) return;
    setBusy(kind);setError("");
    try {
      if(kind==="highlight") {
        await window.tixbam.copilotHighlight(bookingWindow.id,snapshot.token,point);
        setNotice(ko?"공식 사이트에 클릭 대상이 표시됐어. 강조 표시는 클릭을 가리지 않아.":
          "Your target is highlighted on the official browser without blocking its clicks.");
      } else {
        await window.tixbam.copilotClick(bookingWindow.id,snapshot.token,point);
        setSnapshot(null);setPoint(null);
        setNotice(ko?"사용자가 승인한 클릭 1회를 보냈어. 좌석 확보 여부는 공식 사이트에서 확인해.":
          "One user-approved click sent. Verify any reservation on the official site.");
      }
    } catch(e) {
      setError(e instanceof Error?e.message:String(e));
      setSnapshot(null);setPoint(null);
    } finally {setBusy("");}
  }
  return <section className="live-automation-card copilot-panel" aria-label="TixBam Live Copilot">
    <div className="live-card-head"><Crosshair size={20}/><h3>TixBam Live Copilot</h3></div>
    <p>{ko?"예매 시작 화면에서는 읽기 전용으로 연결을 확인할 수 있어. 실제 티켓 선택 단계에서는 위치 표시와 승인 후 1회 클릭을 사용할 수 있어. 자동 좌석 확보는 활성화되지 않았어.":
      "Check the official booking page with a local, read-only preview. At ticket selection, choose a target for a user-approved click. Unattended booking is disabled."}</p>
    <p className="copilot-state"><ShieldAlert size={14}/>
      {ko?"현재 모드: 수동 지정 · 화면 변경 시 클릭 거부 · 자동 클릭 잠금":
        "Mode: human-directed · stale screen protection · unattended click locked"}
    </p>
    <div className="booking-actions">
      <button className="button button-primary" disabled={!eligible||!!busy} onClick={()=>void capture()}>
        <Eye size={15}/>{previewOnly
          ? (ko?"예매 페이지 연결 확인 (읽기 전용)":"Check page connection (read-only)")
          : (ko?"실제 예매 화면 가져오기":"Capture local screen")}</button>
      <button className="button button-outline" disabled title={ko?"사이트별 허가 및 검증이 필요해":"Requires verified provider permission"}>
        {ko?"AI 자동 진행 (미지원)":"AI auto (unavailable)"}</button>
    </div>
    {previewOnly && <div className="copilot-note">
      <p>{ko
        ? "현재는 예매 시작 화면이야. 공식 사이트에서 '예매하기'를 직접 눌러 실제 티켓 선택 화면으로 이동한 다음에만 아래 단계를 변경해."
        : "On this event page, click the official Book button yourself. Change stages only once you reach the actual ticket-selection screen."}</p>
      <button className="button button-outline" disabled={!eligible || !!busy}
        onClick={() => {
          if (!window.confirm(ko
            ? "공식 사이트에서 실제 티켓/좌석 선택 화면에 진입했나요? 로그인·대기열·결제 화면에서는 사용하지 마세요."
            : "Are you on the actual ticket/seat-selection screen? Do not enable during login, queues or checkout.")) return;
          setBusy("phase"); setError("");
          void onSelectTicketStep().catch(e => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(""));
        }}>{ko?"티켓 선택 단계로 전환":"I'm selecting tickets now"}</button>
    </div>}
    {!eligible && <p className="live-warning">{ko
      ?"공식 예매 창을 열고 실제 좌석 선택 단계에 들어가면 '현재 단계'에서 '티켓 선택 중'을 선택해. 대기열·로그인·결제 단계에서는 캡처와 클릭을 막아."
      :"Open a plan-linked browser and select 'Selecting tickets' at the actual seat step. Queue, login and payment steps are excluded."}</p>}
    {snapshot && <div className="copilot-preview">
      <p className="copilot-preview-note">{snapshot.mode === "diagnostic_preview"
        ? (ko?"읽기 전용 연결 테스트 · 화면을 클릭해도 아무 동작 없음 · 서버 전송 없음":
          "Read-only connection check · no interactions or upload")
        : (ko?"이미지를 눌러 대상 위치 지정 · 일회성 캡처 · 서버 전송 없음":
          "Click the picture to mark a target · one-time capture · never uploaded")}</p>
      <div className="copilot-image">
        <img src={snapshot.image} onClick={snapshot.mode === "human_guidance" ? choose : undefined}
          alt={ko?"공식 예매 창의 임시 로컬 캡처":"Temporary local snapshot of the official ticket browser"}/>
        {point && <span className="copilot-crosshair" style={{left:(point.x*100)+"%",top:(point.y*100)+"%"}} aria-hidden="true">+</span>}
      </div>
      {snapshot.mode === "human_guidance" && <>
      <div className="booking-actions">
        <button className="button button-outline" disabled={!!busy} onClick={()=>void analyze()}>
          {ko?"AI로 버튼 후보 찾기 (이미지 전송 동의)":"Find targets with AI (opt-in upload)"}</button>
      </div>
      {targets.length>0 && <div className="copilot-candidates" role="group"
        aria-label={ko?"AI 버튼 후보":"AI click target candidates"}>
        {targets.map((target,i)=><button type="button" className="button button-outline"
          key={i} disabled={!!busy} onClick={()=>setPoint({x:target.x,y:target.y})}>
          {target.label} · {Math.round(target.confidence*100)}% · {target.reason}
        </button>)}
      </div>}
      <div className="booking-actions">
        <button className="button button-outline" disabled={!point||!!busy}
          onClick={()=>void action("highlight")}><Crosshair size={15}/>{ko?"사이트에 위치 표시":"Highlight on site"}</button>
        <button className="button button-primary" disabled={!point||!!busy}
          onClick={()=>void action("click")}><MousePointerClick size={15}/>{ko?"확인 후 1회 클릭":"Approve one click"}</button>
      </div>
      </>}
      <small>{ko?"화면에 변화가 있으면 캡처는 무효화돼. 다시 촬영해줘.":
        "Any screen change can invalidate the snapshot; capture again."}</small>
    </div>}
    {notice && <p role="status" className="copilot-note">{notice}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <p className="copilot-disclaimer">{ko
      ?"현재 AI가 좌석을 판독하거나 예약한 것은 아니야. 실제 장바구니·결제·영수증은 공식 사이트에서 확인해야 해."
      :"No seat, cart or receipt is verified by this preview. Check the official provider site."}</p>
  </section>;
}
