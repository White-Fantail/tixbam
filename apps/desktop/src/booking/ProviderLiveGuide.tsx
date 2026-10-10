import { useState } from "react";
import { BookOpen, ShieldAlert } from "lucide-react";
import type { LivePhase, TicketAddon } from "../types";
import { useLanguage } from "../i18n";

/** Inline manual-provider help. Checks are user reports, not provider reservations. */
export function ProviderLiveGuide({ addon, phase }: { addon: TicketAddon; phase: LivePhase }) {
  const { language } = useLanguage();
  const ko = language === "ko";
  const cityline = addon.id === "cityline";
  const [checked, setChecked] = useState([false, false, false, false]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tips: Record<LivePhase, string> = ko ? {
    preparing: "공식 예매 페이지와 로그인·선예매 자격을 확인하세요.",
    waiting: "공식 대기실을 새로고침하거나 불필요한 창을 열지 마세요.",
    queue: "현재 대기열과 창을 유지하세요. 대기열 우회는 지원하지 않습니다.",
    selecting: cityline ? "Cityline의 Express 자동 배정 또는 Normal 직접 선택은 공연별로 다릅니다. 예산에 맞는 한 장 확보를 우선하세요." : "실제 좌석과 가격은 공식 예매창에서만 확인할 수 있습니다.",
    checkout: "공식 장바구니의 좌석, 가격과 잔여 시간을 직접 확인하세요.",
    verification: "공식 영수증과 주문 내역을 확인하세요. 불명확한 결제는 재시도하지 마세요."
  } : {
    preparing: "Verify the official event, sign-in and presale eligibility.",
    waiting: "Avoid refreshing the waiting room or opening extra windows.",
    queue: "Preserve this queue window. Queue bypass is not supported.",
    selecting: cityline ? "Cityline Express allocation and Normal seat selection vary by event. Prioritize an eligible ticket within budget." : "Only the official provider can show actual seat availability.",
    checkout: "Check the seats, fees and timer in the official cart yourself.",
    verification: "Verify the official receipt and order history. Never retry an uncertain payment."
  };
  const labels = ko
    ? ["공연·회차와 매수 확인", "좌석·구역 및 연석 여부 확인", "수수료 포함 총액과 예산 확인", "제한사항과 결제 조건 확인"]
    : ["Event, performance and quantity", "Seats, section and adjacency", "All-in total and budget", "Restrictions and payment requirements"];
  async function openGuide(kind: "guide" | "faq") {
    if (!window.tixbam || busy) return;
    setBusy(true); setError("");
    try { await window.tixbam.openAssistanceGuide(addon.id, kind); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not open the provider guide."); }
    finally { setBusy(false); }
  }
  return <section className="live-automation-card" aria-label={ko ? "예매처 실전 안내" : "Provider live guidance"}>
    <div className="live-card-head"><BookOpen size={19}/><h3>{ko ? "실전 예매 가이드" : "Live provider guide"} · {addon.name}</h3></div>
    <p>{tips[phase] || tips.preparing}</p>
    {(phase === "checkout" || phase === "verification") && <fieldset>
      <legend>{ko ? "공식 예매창에서 직접 확인" : "Confirm in the official window"}</legend>
      {labels.map((label, index) => <label className="booking-check" key={index}>
        <input type="checkbox" checked={checked[index]} onChange={event =>
          setChecked(previous => previous.map((v, i) => i === index ? event.target.checked : v))}/>
        {label}
      </label>)}
      <p className="settings-note">{ko
        ? "체크 표시는 이 창에서만 유지되는 메모입니다. 공식 좌석 확보 또는 결제 완료를 의미하지 않습니다."
        : "These local checks are not proof of an official seat hold or payment."}</p>
    </fieldset>}
    <div className="booking-actions">
      <button className="button button-outline" disabled={busy || !window.tixbam} onClick={() => void openGuide("guide")}>{ko ? "공식 구매 안내" : "Purchase guide"}</button>
      <button className="button button-outline" disabled={busy || !window.tixbam} onClick={() => void openGuide("faq")}>FAQ</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="settings-note"><ShieldAlert size={14}/>{ko
      ? "좌석·결제 및 인증은 예매처 규정에 따릅니다." : "Ticket selection, payment and verification follow provider rules."}</p>
  </section>;
}
