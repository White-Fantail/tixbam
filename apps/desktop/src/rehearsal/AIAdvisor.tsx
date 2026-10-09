import { useEffect, useRef, useState } from "react";
import { BrainCircuit, ShieldCheck } from "lucide-react";
import type { AIAdvisoryContext, AIAdvisoryResponse, RehearsalTarget } from "../types";

export function RehearsalAIAdvisor({plan, language, snapshot}: {
  plan: RehearsalTarget; language: "ko" | "en"; snapshot: Partial<AIAdvisoryContext> | null;
}) {
  const [result, setResult] = useState<AIAdvisoryResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isKo = language === "ko";
  // Never transmit free-form website contents, credentials, screenshots or card information.
  const stage = snapshot?.stage || "practice_setup";
  const sequence = useRef(0);
  useEffect(() => { sequence.current += 1; setResult(null); setError(""); setBusy(false); }, [stage, plan.id, language]);
  async function ask() {
    if (busy || !window.tixbamRehearsal) return;
    const requestId = ++sequence.current;
    setBusy(true); setError(""); setResult(null);
    try {
      const advice = await window.tixbamRehearsal.aiAdvice({
        task: "rehearsal_guidance", provider_id: plan.providerId,
        context: {
          stage, issue: snapshot?.issue || "", quantity: plan.quantity,
          currency: snapshot?.currency || plan.currency,
          budget_minor: snapshot?.budget_minor ?? plan.budgetMinor,
          total_minor: snapshot?.total_minor ?? null,
          require_together: plan.requireTogether, allow_fallback: plan.allowFallback,
          locale: language, signals: snapshot?.signals || {},
        }
      });
      if (!advice.advisoryOnly || advice.task !== "rehearsal_guidance" || advice.providerId !== plan.providerId)
        throw new Error("Unexpected AI response");
      if (sequence.current === requestId) setResult(advice);
    } catch (e) {
      if (sequence.current === requestId) setError(e instanceof Error ? e.message : (isKo ? "AI 안내를 사용할 수 없습니다." : "AI guidance unavailable."));
    } finally { if (sequence.current === requestId) setBusy(false); }
  }
  return <section className="rehearsal-ai-advisor" aria-label={isKo ? "AI 리허설 도우미" : "AI rehearsal advisor"}>
    <div className="rehearsal-ai-head">
      <div><BrainCircuit size={21}/><strong>{isKo ? "AI 리허설 도우미" : "AI rehearsal advisor"}</strong></div>
      <span><ShieldCheck size={14}/>{isKo ? "안내만 제공" : "Advice only"}</span>
    </div>
    <p>{isKo
      ? "현재 연습 단계와 수량·예산 같은 제한된 정보만 분석합니다. 모델은 관리자가 지정하며, 결제나 좌석 선택을 AI가 실행하지 않습니다."
      : "Reviews only the current practice step and limited booking constraints. Admins manage models; AI cannot select seats or pay."}</p>
    <button type="button" className="button button-outline" disabled={busy} onClick={() => void ask()}>
      <BrainCircuit size={16}/>{busy ? (isKo ? "분석 중…" : "Analyzing…") : (isKo ? "현재 단계 AI 조언 받기" : "Get AI guidance for this step")}
    </button>
    {error && <p role="status" className="rehearsal-ai-error">{error}
      <small>{isKo ? "AI 없이도 리허설은 계속 진행할 수 있습니다." : "The rehearsal still works without AI."}</small></p>}
    {result && <div className="rehearsal-ai-result" role="status">
      <strong>{result.summary}</strong>
      <ul>{result.tips.map((tip,i)=><li key={i}>{tip}</li>)}</ul>
      <small>{isKo ? "최종 선택은 사용자가 확인해야 합니다." : "Verify each decision yourself."}</small>
    </div>}
  </section>;
}
