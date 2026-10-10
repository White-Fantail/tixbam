import { useEffect, useState } from "react";
import { ArrowLeft, FlaskConical, ShieldCheck } from "lucide-react";
import type { RehearsalTarget, AIAdvisoryContext } from "../types";
import { RehearsalAIAdvisor } from "./AIAdvisor";
import { useLanguage, LANGUAGES, tx } from "../i18n";
import { RehearsalSimulator } from "../BookingWorkspace";
import { CitylineRehearsal } from "./CitylineRehearsal";
import { ScenarioLab } from "./ScenarioLab";
import { ProviderPreview } from "./ProviderPreview";

/** No account/vault/provider APIs are exposed to this separate Electron window. */
export default function RehearsalApp() {
  const { language, setLanguage } = useLanguage();
  const changeLanguage = (code: "ko" | "en") => {
    setLanguage(code);
    void window.tixbamRehearsal?.setLanguage(code).catch(() => {});
  };
  useEffect(() => {
    const bridge = window.tixbamRehearsal;
    if (!bridge) return;
    let active = true;
    void bridge.getLanguage().then(code => { if (active) setLanguage(code); }).catch(() => {});
    const off = bridge.onLanguageChanged(code => { if (active) setLanguage(code); });
    return () => { active = false; off(); };
  }, [setLanguage]);
  const [plan, setPlan] = useState<RehearsalTarget | null>(null);
  const [mode,setMode]=useState<"preview"|"practice"|"lab">("preview");
  const [aiSnapshot, setAiSnapshot] = useState<Partial<AIAdvisoryContext> | null>(null);
  const [error, setError] = useState("");
  const bridge = window.tixbamRehearsal;

  useEffect(() => {
    if (!bridge) {
      setError("Rehearsals open in a separate TIXBAM desktop window.");
      return;
    }
    let live = true;
    bridge.getContext().then(target => {
      if (!live) return;
      setPlan(target);

    }).catch(err => {
      if (live) setError(err instanceof Error ? err.message : "Could not load the rehearsal.");
    });
    return () => { live = false; };
  }, [bridge]);

  useEffect(() => {
    if (plan) document.title = language === "ko"
      ? "TIXBAM 리허설 — " + plan.artist : "TIXBAM Rehearsal — " + plan.artist;
  }, [language, plan?.artist]);
  
  async function close() {
    try { await bridge?.close(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not close this window."); }
  }

  return <main className="rehearsal-window">
    <header className="rehearsal-window-toolbar">
      <div className="rehearsal-window-brand">
        <span className="rehearsal-brand-mark"><FlaskConical size={19}/></span>
        <div><strong>TIXBAM</strong><small>PROVIDER PRE-SALE BRIEFING</small></div>
      </div>
      <div className="language-switcher language-switcher-compact" role="group" aria-label={tx("Display language")}>
        {LANGUAGES.map(option => <button className={"button "+(language === option.code ? "button-primary" : "button-outline")}
          key={option.code} aria-pressed={language === option.code} onClick={() => changeLanguage(option.code)}>{option.nativeName}</button>)}
      </div>
      <span className="rehearsal-window-trust"><ShieldCheck size={15}/> No live purchases</span>
      <button type="button" className="button button-outline"
        onClick={() => void close()}><ArrowLeft size={16}/> Back to TIXBAM</button>
    </header>
    <div className="rehearsal-window-body">
      {error && <p className="form-error" role="alert">{error}</p>}
      {!error && !plan && <div className="empty-state"><h3>Loading your booking rehearsal…</h3></div>}
      {plan&&<div className="lab-mode-switch" role="group" aria-label={language==="ko"?"예매 준비 모드":"Pre-sale modes"}>
        <button type="button" className={"button "+(mode==="preview"?"button-primary":"button-outline")}
          onClick={()=>setMode("preview")} aria-pressed={mode==="preview"}>
          {language==="ko"?"예매 절차 미리보기":"Expected booking steps"}</button>
        <button type="button" className={"button "+(mode==="practice"?"button-primary":"button-outline")}
          onClick={()=>setMode("practice")} aria-pressed={mode==="practice"}>
          {language==="ko"?"예매처 화면 리허설":"Provider walkthrough"}</button>
        <button type="button" className={"button "+(mode==="lab"?"button-primary":"button-outline")}
          onClick={()=>setMode("lab")} aria-pressed={mode==="lab"}>
          {language==="ko"?"예외 상황 Stress Lab":"Safety Stress Lab"}</button>
      </div>}
      {plan && (mode==="preview"
        ? <ProviderPreview plan={plan} onComplete={async()=>{await bridge!.complete();}}/>
        : mode==="lab"
        ? <ScenarioLab plan={plan} onComplete={async()=>{await bridge!.complete();}}/>
        : plan.providerId === "cityline"
        ? <CitylineRehearsal plan={plan} onContextChange={setAiSnapshot} onComplete={async () => { await bridge!.complete(); }} onClose={() => void close()}/>
        : <RehearsalSimulator plan={plan} onComplete={async () => { await bridge!.complete(); }}
            onClose={() => void close()}/>)}
      {plan && mode==="practice" && <RehearsalAIAdvisor plan={plan} language={language} snapshot={aiSnapshot}/>}
    </div>
  </main>;
}
