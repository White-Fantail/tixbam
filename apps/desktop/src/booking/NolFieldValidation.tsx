import { useState } from "react";
import { AlertTriangle, ClipboardCheck, Download, ShieldCheck } from "lucide-react";
import type { BookingPlan } from "../booking-plans";
import type { CopilotAdvanceInfo, TicketWindow } from "../types";
import { looksLikeSignIn } from "./live-guidance";
import {
  beginNolFieldSession, exportNolFieldReport, recordNolFieldEvent,
  stopNolFieldSession, FIELD_STEPS, FIELD_ISSUES,
  type NolFieldSession, type NolFieldStep, type NolFieldIssue
} from "./nol-field-validation";
import { useLanguage } from "../i18n";

const stepText: Record<NolFieldStep, [string, string]> = {
  site_ready: ["공식 창 연결", "Official window"],
  login_complete: ["로그인 완료 (직접 확인)", "Signed in (manually checked)"],
  queue_seen: ["대기열 진입 (직접 확인)", "Queue observed (manually checked)"],
  seat_selection: ["좌석/매수 화면 확인", "Ticket selection observed"],
  cart_review: ["주문 검토 화면 확인 (보류 미확인)", "Cart screen observed (hold unverified)"]
};
const issueText: Record<NolFieldIssue, [string, string]> = {
  screen_mismatch: ["화면 인식 오류", "Incorrect screen guidance"],
  analysis_slow: ["화면 분석 지연", "Slow analysis"],
  seat_conflict: ["좌석 선택 충돌", "Seat conflict"],
  sold_out: ["매진/재고 없음", "Sold out"],
  manual_handoff: ["수동 조작 필요", "Manual handoff"],
  other_blocker: ["기타 진행 차단", "Other blocker"]
};
function trustedNolWindow(win?: TicketWindow): boolean {
  if (!win || win.providerId !== "nol" || win.loading || win.loadError != null) return false;
  try {
    const u = new URL(win.url);
    return u.protocol === "https:" &&
      (u.hostname === "world.nol.com" || u.hostname === "nol.yanolja.com") &&
      !looksLikeSignIn(win.url);
  } catch { return false; }
}

/**
 * Human-directed field evidence collection. Never drives provider navigation,
 * Electron mouse input, screenshots, queue or checkout. No "hold verified" button.
 */
export function NolFieldValidation({ plan, bookingWindow, metrics, onOpenCopilot }: {
  plan: BookingPlan;
  bookingWindow?: TicketWindow;
  metrics?: CopilotAdvanceInfo["validationMetrics"];
  onOpenCopilot: () => void;
}) {
  const { language } = useLanguage();
  const ko = language === "ko";
  const l = (kr: string, en: string) => ko ? kr : en;
  const [session, setSession] = useState<NolFieldSession | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const trusted = trustedNolWindow(bookingWindow) && bookingWindow?.planId === plan.id;
  const matching = !!session && session.planId === plan.id &&
    session.windowId === bookingWindow?.id;
  const canRecord = trusted && matching && session?.status === "running";
  const events = session?.events ?? [];
  const lastStep = events.filter(e => e.kind === "step").at(-1)?.code as NolFieldStep | undefined;
  const lastIndex = FIELD_STEPS.indexOf(lastStep ?? "site_ready");
  const observation = metrics?.classification === "diagnostic_only"
    ? metrics.observationLatencyMs : null;
  const labelStep = (step: NolFieldStep) => stepText[step][ko ? 0 : 1];

  function mark(step: NolFieldStep) {
    if (!canRecord || !session) return;
    if (step === "cart_review" && !window.confirm(l(
      "공식 예매창에서 주문 검토 화면에 도달했나요? 이 기록은 좌석 보류나 결제 성공을 증명하지 않습니다. TixBam은 결제를 진행하지 않습니다.",
      "Is the official provider showing a cart/review screen? This does not prove a seat hold or purchase. TixBam will not pay."
    ))) return;
    setSession(recordNolFieldEvent(session, "step", step, Date.now()));
  }
  function issue(code: NolFieldIssue) {
    if (!canRecord || !session) return;
    setSession(recordNolFieldEvent(session, "issue", code, Date.now()));
  }
  function exportReport() {
    if (!session) return;
    const report = exportNolFieldReport(session, metrics);
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json"
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "tixbam-nol-field-report.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="live-automation-card nol-field-validation"
    aria-label={l("NOL 실전 검증", "NOL live field validation")}
    data-testid="nol-field-validation">
    <div className="live-card-head">
      <ClipboardCheck size={19}/>
      <h3>{l("NOL 실전 검증", "NOL live field validation")}</h3>
    </div>
    <p>{l(
      "실제 공식 예매창을 보면서 단계와 오류를 기록해요. 로그인·대기열·인증은 직접 진행하고, 결제와 반복 구매·취소는 테스트하지 않아요.",
      "Record real official-site steps and issues. Handle sign-in, queue and verification yourself; no checkout, repetitive purchases or cancellations."
    )}</p>
    <p className="settings-note"><ShieldCheck size={14}/> {l(
      "개인정보·좌석번호·URL·원본 화면은 기록하거나 전송하지 않습니다. 모든 체크는 사용자 관찰 기록이며 좌석 확보 증거가 아닙니다.",
      "No personal data, seat numbers, URLs or screenshots are logged or uploaded. All checks are human reports, not seat-hold evidence."
    )}</p>
    {!session ? <div className="booking-actions">
      <button type="button" className="button button-primary"
        data-testid="nol-field-start" disabled={!trusted}
        onClick={() => {
          if (!bookingWindow || !trusted) return;
          setSession(beginNolFieldSession(Date.now(), bookingWindow.id, plan.id));
        }}>{l("이 창에서 실전 검증 시작", "Start field validation for this window")}</button>
      {!trusted && <span className="settings-note">{l(
        "연결된 NOL 공식 예매창을 먼저 열어주세요. 로그인·인증·외부 주소에서는 검증 시작이 차단됩니다.",
        "Open an eligible NOL official page first. Sign-in, verification and external hosts are excluded."
      )}</span>}
    </div> : <>
      {session.status === "running" && !matching && <p role="alert" className="live-warning">
        <AlertTriangle size={15}/>{l(
          "예매창이 바뀌어 기록을 일시 중지했어요. 기존 보고서를 저장한 뒤 이 창에서 새 검증을 시작하세요.",
          "The linked browser changed. Recording is paused; export this report before starting a new one."
        )}</p>}
      {session.status === "running" && matching && !trusted && <p className="live-warning" role="alert">
        {l("인증·외부 페이지 또는 로딩 중에는 기록을 진행하지 않습니다.", "Recording pauses on sign-in, external or loading screens.")}
      </p>}
      <p role="status" data-testid="nol-field-status">
        <strong>{session.status === "running"
          ? l("기록 중 · 공식 구매 여부 미확인", "Recording · purchase unverified")
          : l("검증 종료 · 공식 구매 여부 미확인", "Session ended · purchase unverified")}</strong>
        {" · "}{l("수동 확인", "Manual steps")}: {events.filter(e => e.kind === "step").length}
        {" · "}{l("문제", "Issues")}: {events.filter(e => e.kind === "issue").length}
      </p>
      {session.status === "running" && <>
        <div className="booking-actions">
          <button type="button" className="button button-primary"
            disabled={!canRecord || bookingWindow?.phase !== "selecting"}
            onClick={onOpenCopilot}>{l("화면 분석 · 클릭 위치 도우미 열기", "Open screen analysis and click guide")}</button>
        </div>
        <div className="nol-field-steps" role="group" aria-label={l("관찰된 실제 단계", "Observed stages")}>
          {FIELD_STEPS.slice(1).map(step => {
            const index = FIELD_STEPS.indexOf(step);
            const complete = index <= lastIndex;
            const enabled = canRecord && index > lastIndex &&
              (step !== "cart_review" || lastIndex >= FIELD_STEPS.indexOf("seat_selection"));
            return <button type="button" className={"button " + (complete ? "button-outline" : "button-primary")}
              data-testid={"nol-field-step-" + step}
              key={step} disabled={!enabled} onClick={() => mark(step)}>
              {complete ? "✓ " : ""}{labelStep(step)}</button>;
          })}
        </div>
        <details open={showDetails} onToggle={event =>
          setShowDetails(event.currentTarget.open)}>
          <summary>{l("오류 · 지연 · 수동 인계 기록", "Record errors, delays and handoffs")}</summary>
          <div className="booking-actions">
            {FIELD_ISSUES.map(code =>
              <button type="button" className="button button-outline"
                key={code} disabled={!canRecord} onClick={() => issue(code)}>
                {issueText[code][ko ? 0 : 1]}</button>)}
          </div>
        </details>
      </>}
      <p className="settings-note">{l("마지막 수동 확인", "Last human-reported step")}: {labelStep(lastStep ?? "site_ready")}</p>
      {observation && <p className="settings-note" data-testid="nol-field-metrics">
        {l("코파일럿 화면 분석 실측", "Copilot observation metrics")}:
        {" P50 "}{observation.p50 ?? "—"}ms
        {" · P95 "}{observation.p95 ?? "—"}ms
        {" · "}{metrics?.observationCount ?? 0}{l("회 분석", " observations")}
      </p>}
      <p className="live-warning">{l(
        "검증 결과는 항상 HOLD · 좌석 보류 미확인 · 구매 미확인입니다. 실제 장바구니·가격·주문 결과는 NOL 공식 창에서만 확인하세요.",
        "Result is always HOLD · seat hold unverified · purchase unverified. Confirm any cart, price or purchase only on the official NOL site."
      )}</p>
      <div className="booking-actions">
        {session.status === "running"
          ? <button type="button" className="button button-outline"
              data-testid="nol-field-stop"
              onClick={() => setSession(stopNolFieldSession(session, Date.now()))}>
              {l("검증 중지", "Stop validation")}</button>
          : <button type="button" className="button button-outline"
              onClick={() => setSession(null)}>{l("새 검증", "New validation")}</button>}
        <button type="button" className="button button-outline"
          data-testid="nol-field-export" onClick={exportReport}>
          <Download size={15}/>{l("비식별 JSON 보고서 저장", "Save anonymous JSON report")}</button>
      </div>
    </>}
  </section>;
}
