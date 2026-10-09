import { useEffect, useState } from "react";
import { ArrowLeft, FlaskConical, ShieldCheck } from "lucide-react";
import type { RehearsalTarget } from "../types";
import { useLanguage, LANGUAGES, tx } from "../i18n";
import { RehearsalSimulator } from "../BookingWorkspace";
import { CitylineRehearsal } from "./CitylineRehearsal";

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
      document.title = "TIXBAM Rehearsal — " + target.artist;
    }).catch(err => {
      if (live) setError(err instanceof Error ? err.message : "Could not load the rehearsal.");
    });
    return () => { live = false; };
  }, [bridge]);

  async function close() {
    try { await bridge?.close(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not close this window."); }
  }

  return <main className="rehearsal-window">
    <header className="rehearsal-window-toolbar">
      <div className="rehearsal-window-brand">
        <span className="rehearsal-brand-mark"><FlaskConical size={19}/></span>
        <div><strong>TIXBAM</strong><small>OFFLINE TICKETING REHEARSAL</small></div>
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
      {plan && (plan.providerId === "cityline"
        ? <CitylineRehearsal plan={plan} onComplete={async () => { await bridge!.complete(); }} onClose={() => void close()}/>
        : <RehearsalSimulator plan={plan} onComplete={async () => { await bridge!.complete(); }}
            onClose={() => void close()}/>)}
    </div>
  </main>;
}
