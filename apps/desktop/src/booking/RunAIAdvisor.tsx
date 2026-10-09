import { useEffect, useRef, useState } from "react";
import { BrainCircuit, ShieldCheck } from "lucide-react";
import { useLanguage } from "../i18n";
import type { BookingRun, AIAdvisoryResponse, AIAdvisoryTask } from "../../../../packages/addon-sdk";

/** Host-sourced, read-only AI guidance. No browser content or secrets leave the device. */
export function RunAIAdvisor({run}: {run: BookingRun}) {
  const {language} = useLanguage();
  const [advice,setAdvice] = useState<AIAdvisoryResponse | null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const token = useRef(0);
  const task: AIAdvisoryTask = run.status === "review" ? "seat_review" : "page_recovery";
  const shown = Boolean(run.providerId && run.aiContext &&
    (run.status === "review" || run.status === "awaiting_user"));
  useEffect(() => {
    token.current += 1;
    setAdvice(null); setError(""); setBusy(false);
  }, [run.id, run.status, run.aiPageStage, run.order?.totalMinor, language]);
  if (!shown) return null;
  const ko=language==="ko";
  async function ask() {
    if (!window.tixbam || busy || !run.providerId || !run.aiContext) return;
    const current=++token.current;
    setBusy(true); setError(""); setAdvice(null);
    try {
      const response=await window.tixbam.aiAdvice({
        task, provider_id: run.providerId,
        context: {
          stage: run.aiPageStage || (task==="seat_review" ? "payment" : "unknown"),
          locale: language,
          issue: task==="page_recovery" ? "Manual review required" : "Review the displayed order",
          quantity: run.aiContext.quantity, currency: run.aiContext.currency,
          budget_minor: run.aiContext.budget_minor,
          total_minor: task==="seat_review" ? run.order?.totalMinor ?? null : null,
          require_together: run.aiContext.require_together,
          allow_fallback: run.aiContext.allow_fallback,
          signals: {
            rehearsal: run.rehearsal,
            ...(task==="seat_review" && run.order
              ? {feesIncluded:run.order.feesIncluded, adjacent:run.order.adjacent===true}
              : {}),
          }
        }
      });
      if (!response.advisoryOnly || response.providerId !== run.providerId || response.task !== task)
        throw new Error("Unexpected AI response");
      if (current===token.current) setAdvice(response);
    } catch(e) {
      if (current===token.current)
        setError(e instanceof Error ? e.message : (ko ? "AI 조언을 사용할 수 없습니다." : "AI advice unavailable."));
    } finally { if (current===token.current) setBusy(false); }
  }
  return <div className="run-ai-advisor">
    <button type="button" className="button button-outline" disabled={busy} onClick={()=>void ask()}>
      <BrainCircuit size={15}/>{busy ? (ko?"분석 중…":"Analyzing…") :
      (task==="seat_review" ? (ko?"AI로 주문 조건 점검":"AI order check")
        :(ko?"AI 복구 안내":"AI recovery advice"))}
    </button>
    <p className="run-ai-disclaimer"><ShieldCheck size={14}/>
      {ko?"AI는 참고용 안내만 제공하며 결제·좌석 선택을 대신하지 않습니다.":"AI offers guidance only; it cannot select seats or pay."}</p>
    {error&&<p className="form-error" role="status">{error}</p>}
    {advice&&<div className="run-ai-advice" role="status">
      <strong>{advice.summary}</strong>
      <ul>{advice.tips.map((tip,i)=><li key={i}>{tip}</li>)}</ul>
    </div>}
  </div>;
}
