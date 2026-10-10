import { useEffect, useState, type MouseEvent } from "react";
import { Crosshair, Eye, MousePointerClick, ShieldAlert } from "lucide-react";
import type { BookingPlan } from "../booking-plans";
import type { CopilotSnapshot, TicketWindow } from "../types";
import { useLanguage } from "../i18n";

/** The image is a local one-shot provider preview, not an AI prediction.
 * Never run background captures, make automatic clicks or upload the image.
 */
export function LiveCopilotPanel({ bookingWindow, plan }: {
  bookingWindow: TicketWindow | undefined; plan: BookingPlan;
}) {
  const { language } = useLanguage();
  const ko = language === "ko";
  const [snapshot, setSnapshot] = useState<CopilotSnapshot | null>(null);
  const [point, setPoint] = useState<{x:number;y:number} | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setSnapshot(null); setPoint(null); setError("");setNotice(""); },
    [bookingWindow?.id, bookingWindow?.phase, bookingWindow?.site, plan.id]);
  const eligible = bookingWindow && !bookingWindow.popup && bookingWindow.phase === "selecting" &&
    !bookingWindow.loading && !bookingWindow.loadError;
  async function capture() {
    if (!bookingWindow || !window.tixbam) return;
    setBusy("capture");setError("");setNotice("");setSnapshot(null);setPoint(null);
    try {
      const next = await window.tixbam.copilotCapture(bookingWindow.id);
      setSnapshot(next);
      setNotice(ko ? "아래 이미지는 로컬에서 캡처한 현재 화면이야. 직접 클릭할 위치를 지정해." :
        "This is a local preview. Choose a target yourself; AI has not selected a button.");
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
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
  async function action(kind:"highlight"|"click") {
    if (!snapshot || !point || !window.tixbam || !bookingWindow) return;
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
    <p>{ko?"실전 예매를 위한 로컬 화면 안내. 지금은 직접 위치를 지정하고, 승인 후 클릭할 수 있어. AI 자동 화면 인식·무인 좌석 확보는 아직 활성화되지 않았어.":
      "Local screen guidance for a live sale. Select the target yourself, then approve one click. AI vision and unattended seat booking are not enabled yet."}</p>
    <p className="copilot-state"><ShieldAlert size={14}/>
      {ko?"현재 모드: 수동 지정 · 화면 변경 시 클릭 거부 · 자동 클릭 잠금":
        "Mode: human-directed · stale screen protection · unattended click locked"}
    </p>
    <div className="booking-actions">
      <button className="button button-primary" disabled={!eligible||!!busy} onClick={()=>void capture()}>
        <Eye size={15}/>{ko?"실제 예매 화면 가져오기":"Capture local screen"}</button>
      <button className="button button-outline" disabled title={ko?"사이트별 허가 및 검증이 필요해":"Requires verified provider permission"}>
        {ko?"AI 자동 진행 (미지원)":"AI auto (unavailable)"}</button>
    </div>
    {!eligible && <p className="live-warning">{ko
      ?"공식 예매 창을 열고 실제 좌석 선택 단계에 들어가면 'Current step'에서 Selecting tickets를 선택해. 대기열·로그인·결제 단계에서는 캡처와 클릭을 막아."
      :"Open a plan-linked browser and select 'Selecting tickets' at the actual seat step. Queue, login and payment steps are excluded."}</p>}
    {snapshot && <div className="copilot-preview">
      <p className="copilot-preview-note">{ko?"이미지를 눌러 대상 위치 지정 · 일회성 캡처 · 서버 전송 없음":
        "Click the picture to mark a target · one-time capture · never uploaded"}</p>
      <div className="copilot-image">
        <img src={snapshot.image} onClick={choose}
          alt={ko?"공식 예매 창의 임시 로컬 캡처":"Temporary local snapshot of the official ticket browser"}/>
        {point && <span className="copilot-crosshair" style={{left:(point.x*100)+"%",top:(point.y*100)+"%"}} aria-hidden="true">+</span>}
      </div>
      <div className="booking-actions">
        <button className="button button-outline" disabled={!point||!!busy}
          onClick={()=>void action("highlight")}><Crosshair size={15}/>{ko?"사이트에 위치 표시":"Highlight on site"}</button>
        <button className="button button-primary" disabled={!point||!!busy}
          onClick={()=>void action("click")}><MousePointerClick size={15}/>{ko?"확인 후 1회 클릭":"Approve one click"}</button>
      </div>
      <small>{ko?"화면에 변화가 있으면 캡처는 무효화돼. 다시 촬영해줘.":
        "Any screen change can invalidate the snapshot; capture again."}</small>
    </div>}
    {notice && <p role="status" className="copilot-note">{notice}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <p className="copilot-disclaimer">{ko
      ?"현재 AI가 좌석을 판독하거나 예약한 것은 아니야. 실제 장바구니·결제·영수증은 공식 사이트에서 확인해야 해."
      :"No seat, cart or receipt is verified by this preview. Check the official provider site."}</p>
  </section>;
