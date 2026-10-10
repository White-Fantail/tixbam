import { useEffect, useState, type MouseEvent } from "react";
import { Crosshair, Eye, MousePointerClick, ShieldAlert } from "lucide-react";
import type { BookingPlan } from "../booking-plans";
import type { CopilotSnapshot, CopilotSuggestion, TicketWindow } from "../types";
import { useLanguage } from "../i18n";

function readableCopilotError(error: unknown, ko: boolean): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!ko) return message;
  if (/sign in to use copilot vision|please sign in first/i.test(message))
    return "AI 분석을 사용하려면 TixBam 계정에 로그인해야 해. 화면 캡처와 수동 위치 지정은 계속 사용할 수 있어.";
  if (/vision is disabled|not enabled by tixbam/i.test(message))
    return "AI Vision이 비활성화돼 있어. Admin → AI Models → Copilot Vision에서 모델을 지정하고 기능을 켜야 해. 수동 안내는 사용 가능해.";
  if (/vision is not configured|ai is not configured/i.test(message))
    return "Railway API에 OPENROUTER_API_KEY 설정이 필요해. 설정 전에는 수동 안내를 사용해.";
  if (/screen analysis failed|timed out|timeout/i.test(message))
    return "AI 응답을 받지 못했어. Admin에서 비전 지원 모델과 제한 시간을 확인하고 재시도해. 화면을 직접 선택해도 돼.";
  if (/hourly limit|429/i.test(message))
    return "AI 분석 사용 한도에 도달했어. 나중에 다시 시도하거나 수동으로 표시해.";
  if (/not linked|provider domain|untrusted browser url/i.test(message))
    return "공식 예매처로 연결된 창인지 확인해. 다른 예매처로 이동했다면 해당 예매처 애드온이 필요할 수 있어.";
  if (/preview expired|capture again|take a new preview|selected button or seat changed/i.test(message))
    return "화면이나 대상 버튼이 바뀌었어. 다시 캡처하고 위치를 확인해.";
  if (/fully loaded|could not be captured|too small/i.test(message))
    return "공식 예매 창이 로딩 중이거나 캡처할 수 없어. 예매 창이 열린 상태인지 확인하고 다시 시도해.";
  return message;
}

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
  const eligible = bookingWindow &&
    (bookingWindow.phase === "selecting" || previewOnly) &&
    !bookingWindow.loading && !bookingWindow.loadError;
  async function capture() {
    if (!bookingWindow || !window.tixbam) return;
    setBusy("capture");setError("");setNotice("");setSnapshot(null);setPoint(null);setTargets([]);
    try {
      const next = await window.tixbam.copilotCapture(bookingWindow.id);
      setSnapshot(next);
      setNotice(next.mode === "diagnostic_preview"
        ? (ko ? "공식 예매 페이지가 연결됐어. AI 버튼 제안과 위치 표시는 가능하지만 클릭은 공식 사이트에서 직접 해야 해." :
          "Official browser connected. AI suggestions and highlights are available; click the official site yourself.")
        : (ko ? "아래 이미지는 로컬에서 캡처한 현재 화면이야. 직접 클릭할 위치를 지정해." :
          "This is a local preview. Choose a target yourself; AI has not selected a button."));
    } catch(e) { setError(readableCopilotError(e,ko)); }
    finally { setBusy(""); }
  }
  function choose(event: MouseEvent<HTMLImageElement>) {
    if(!snapshot) return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    setPoint({x:Math.max(0.001,Math.min(0.999,(event.clientX-rect.left)/rect.width)),
      y:Math.max(0.001,Math.min(0.999,(event.clientY-rect.top)/rect.height))});
    setNotice("");
  }
  async function analyze() {
    if(!snapshot||!window.tixbam||!bookingWindow)return;
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
      if (result.targets.length) setPoint({x:result.targets[0].x,y:result.targets[0].y});
      setNotice(result.targets.length
        ? (snapshot.mode === "diagnostic_preview"
          ? (ko?"AI가 예매 진입 버튼 후보를 찾았어. 위치를 표시한 뒤 공식 창에서 직접 눌러줘.":"AI found a booking-entry candidate. Highlight it, then click in the official site yourself.")
          : (ko?"AI가 후보를 찾았어. 반드시 화면에서 직접 확인한 뒤 선택해.":"AI found candidate targets. Verify them visually before choosing."))
        : (ko?"확실한 버튼을 찾지 못했어. 직접 선택하거나 화면을 다시 촬영해.":"No sufficiently confident targets. Choose manually or recapture."));
    }catch(e){setError(readableCopilotError(e,ko));}
    finally{setBusy("");}
  }
  async function action(kind:"highlight"|"click") {
    if (!snapshot || (kind==="click" && snapshot.mode !== "human_guidance") ||
      !point || !window.tixbam || !bookingWindow) return;
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
      setError(readableCopilotError(e,ko));
      setSnapshot(null);setPoint(null);
    } finally {setBusy("");}
  }
  return <section className="live-automation-card copilot-panel" aria-label="TixBam Live Copilot">
    <div className="live-card-head"><Crosshair size={20}/><h3>TixBam Live Copilot</h3></div>
    <p>{ko?"예매 시작 화면에서는 AI가 다음 버튼을 제안하고 표시할 수 있어. 티켓 선택 단계에서는 승인 후 1회 클릭을 테스트할 수 있어. 무인 자동 예매는 활성화되지 않았어.":
      "Check the official booking page with a local, read-only preview. At ticket selection, choose a target for a user-approved click. Unattended booking is disabled."}</p>
    <p className="copilot-state"><ShieldAlert size={14}/>
      {ko?"안내 모드: 캡처 · 선택적 AI 후보 · 직접 승인 · 무인 클릭 차단":
        "Guide mode: local capture · optional AI proposals · explicit approval · no unattended clicks"}
    </p>
    <div className="copilot-test-guide">
      <strong>{ko?"NOL 실전 점검 순서":"Live booking test"}</strong>
      <p>{ko
        ? "① 예매 화면 캡처 → ② 위치를 직접 찍거나 AI 후보 요청 → ③ 공식 창에 위치 표시 → ④ 예매 진입은 직접 클릭 → ⑤ 실제 좌석 선택 단계에서 승인 클릭 테스트"
        : "1. Capture  2. Mark a point or request AI  3. Highlight  4. Enter booking manually  5. Test an approved click at seat selection."}</p>
      {bookingWindow && <small>{ko?"선택된 창":"Target window"}: #{bookingWindow.id}{bookingWindow.popup?" · Popup":""} · {bookingWindow.site||"..."}</small>}
    </div>
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
        ? "현재는 예매 시작 화면이야. AI가 다음 버튼의 위치를 알려줄 수 있어. 공식 사이트에서 직접 누른 후 실제 티켓 선택 화면에 들어갔을 때 단계 변경을 해."
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
        ? (ko?"예매 시작 화면 · AI 분석은 동의 시 1회 전송 · 위치 표시는 클릭하지 않음":
          "Event page · AI upload only by consent · highlights never click")
        : (ko?"이미지를 눌러 대상 위치 지정 · 일회성 캡처 · 서버 전송 없음":
          "Click the picture to mark a target · one-time capture · never uploaded")}</p>
      <div className="copilot-image">
        <img src={snapshot.image} onClick={choose}
          alt={ko?"공식 예매 창의 임시 로컬 캡처":"Temporary local snapshot of the official ticket browser"}/>
        {point && <span className="copilot-crosshair" style={{left:(point.x*100)+"%",top:(point.y*100)+"%"}} aria-hidden="true">+</span>}
      </div>
      <div className="booking-actions">
        <button className="button button-outline" disabled={!!busy} onClick={()=>void analyze()}>
          {ko?"AI로 버튼 위치 찾기 (이미지 전송 동의)":"Find button with AI (opt-in upload)"}</button>
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
        {snapshot.mode === "human_guidance" && <button className="button button-primary" disabled={!point||!!busy}
          onClick={()=>void action("click")}><MousePointerClick size={15}/>{ko?"확인 후 1회 클릭":"Approve one click"}</button>}
      </div>
      <small>{snapshot.mode === "diagnostic_preview"
        ? (ko?"공식 예매 창에서 버튼을 직접 눌러줘. 화면이 바뀌면 새로 가져와.": "Click the official site's button yourself. Capture again after navigation.")
        : (ko?"클릭 전 화면이 변경되었다면 화면을 다시 가져와.": "Capture again if the page changes before clicking.")}</small>
    </div>}
    {notice && <p role="status" className="copilot-note">{notice}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <p className="copilot-disclaimer">{ko
      ?"현재 AI가 좌석을 판독하거나 예약한 것은 아니야. 실제 장바구니·결제·영수증은 공식 사이트에서 확인해야 해."
      :"No seat, cart or receipt is verified by this preview. Check the official provider site."}</p>
  </section>;
}
