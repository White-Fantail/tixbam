import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, CircleHelp, Clock3,
  ExternalLink, Globe2, Layers3, LockKeyhole, Monitor, ShieldAlert, TicketCheck, X } from "lucide-react";
import type { BookingRun } from "../../../packages/addon-sdk";
import type { BookingPlan } from "./booking-plans";
import { currencyFactor } from "./booking-plans";
import type { LiveHistory, LivePhase, TicketAddon, TicketWindow } from "./types";

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
  if (!plan.budgetMinor) return "No maximum budget set";
  const factor = currencyFactor(plan.currency);
  return plan.currency + " " + (plan.budgetMinor / factor).toLocaleString(undefined, {
    minimumFractionDigits: factor === 1 ? 0 : 2, maximumFractionDigits: factor === 1 ? 0 : 2
  });
}
function summarizeRun(run: BookingRun): { heading: string; action: string; dangerous: boolean } {
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
  const [runs, setRuns] = useState<BookingRun[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
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
  const first = planSessions.find(item => item.planId === selectedPlanId);
  const chosenPlan = plans.find(item => item.id === selectedPlanId) ||
    plans.find(item => planSessions.some(win => win.planId === item.id)) ||
    plans.find(item => item.id === history[0]?.planId) || null;
  const plan = chosenPlan;
  const primary = planSessions.find(item => item.planId === plan?.id);
  const extra = windows.filter(item => item.planId === plan?.id && item.popup);
  const selectedWindow = windows.find(item => item.id === selectedWindowId && item.planId === plan?.id) ||
    first || primary;
  const relatedRuns = runs.filter(run => !run.rehearsal && (!selectedWindow
    ? false : run.windowId === selectedWindow.id));
  const orphanRuns = runs.filter(run => !run.rehearsal && (!run.windowId ||
    !windows.some(win => win.id === run.windowId)));
  const standalone = windows.filter(item => !item.planId);
  const planHistory = history.filter(item => plans.some(p => p.id === item.planId));

  async function invoke(key: string, operation: () => Promise<unknown>) {
    setBusy(key); setError("");
    try { await operation(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not perform that action."); }
    finally { setBusy(""); }
  }

  async function runControl(run: BookingRun, action: "resume" | "stop") {
    if (!window.tixbam) return;
    if (action === "stop" && !window.confirm("Stop TIXBAM automation? This does not cancel any order already submitted to the ticket provider.")) return;
    if (action === "resume" && run.status === "review") {
      const order = run.order;
      if (!order) { setError("No verifiable order to review."); return; }
      const amount = (order.totalMinor / (["KRW", "JPY"].includes(order.currency) ? 1 : 100)).toFixed(["KRW", "JPY"].includes(order.currency) ? 0 : 2);
      if (!window.confirm("Authorize the exact displayed order and submit payment once?\n" +
        order.quantity + " ticket(s), " + order.currency + " " + amount +
        " including fees.\nVerify the official provider page first.")) return;
    }
    await invoke("run-" + run.id, async () => {
      const updated = action === "stop"
        ? await window.tixbam!.stopBooking(run.id)
        : await window.tixbam!.resumeBooking(run.id, run.status === "review");
      setRuns(previous => [...previous.filter(item => item.id !== updated.id), updated]);
    });
  }

  return <section className="live-workspace">
    <div className="section-heading">
      <div>
        <span className="eyebrow">LIVE BOOKING · OFFICIAL PROVIDER WINDOWS</span>
        <h2>Ticketing Control Room</h2>
        <p>Keep the official browser in control. TIXBAM shows only observable window status and actions you report.</p>
      </div>
      <span className="counter-badge"><Monitor size={14}/>{windows.length} browser window(s)</span>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {planHistory.length > 0 && <div className="live-recovery" role="alert">
      <div className="live-recovery-head"><AlertTriangle size={21}/>
        <div><strong>Review previous ticketing sessions</strong>
          <p>These windows were closed or interrupted. TIXBAM did not restore their queue position or payment state.</p></div>
      </div>
      {planHistory.map(item => {
        const previous = plans.find(p => p.id === item.planId);
        return <div className="live-recovery-item" key={item.planId}>
          <span><b>{previous?.artist || "Booking plan"}</b> · {item.reason === "interrupted" ? "Session interrupted" : "Window closed"}
            {riskStages.has(item.phase) ? " · Checkout may need verification" : ""}</span>
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
          <TicketCheck size={15}/><span>{p?.artist || "Linked session"}</span><small>#{win.id}</small>
        </button>;
      }) : <p>No live Booking Plan window is open. Choose a plan below to launch its official website.</p>}
    </div>
    {plan ? <div className="live-workspace-grid">
      <div className="live-main">
        <div className="live-site-card">
          <div className="live-site-head">
            <div><span className="eyebrow">CURRENT TARGET</span><h3>{plan.artist} · {plan.title}</h3>
              <p>{addons.find(a => a.id === plan.providerId)?.name || plan.providerId}{plan.city ? " · " + plan.city : ""}</p>
            </div>
            <button className="button button-outline" onClick={() => onBackToPlan(plan.id)}><ArrowLeft size={15}/> Plan</button>
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
            {primary ? <button className="button button-primary" disabled={busy !== ""}
                onClick={() => void invoke("focus", () => onFocus(primary.id))}><ExternalLink size={16}/> Focus official site</button> :
              <button className="button button-primary" disabled={busy !== "" || !plan.bookingUrl}
                onClick={() => void invoke("start", () => onStart(plan))}><ExternalLink size={16}/> Open official ticket site</button>}
            {selectedWindow && <button className="button button-outline" disabled={busy !== ""}
              onClick={() => void invoke("close", () => onClose(selectedWindow.id))}><X size={16}/> Close browser…</button>}
            {primary && addons.find(a => a.id === primary.providerId)?.kind === "event-presale" &&
              <button className="button button-outline" disabled={busy !== ""}
                onClick={() => void invoke("agent", () => onTicketAgent(primary.id))}>Open official ticket agent <ArrowRight size={15}/></button>}
          </div>
          {extra.length > 0 && <div className="live-popups"><strong>Provider popups ({extra.length})</strong>
            <p>Login and payment verification can open additional windows. They are not extra queue positions.</p>
            {extra.map(win => <button key={win.id} className="button button-outline" onClick={() => void invoke("popup" + win.id, () => onFocus(win.id))}>Focus popup #{win.id} · {win.site || "loading"}</button>)}
          </div>}
        </div>
        <div className="live-automation-card">
          <div className="live-card-head"><ShieldAlert size={19}/><h3>Booking assistance</h3></div>
          <p>Automation is not guaranteed for this provider. It must not bypass CAPTCHA, the queue or bank verification.</p>
          {relatedRuns.length ? relatedRuns.map(run => {
            const status = summarizeRun(run);
            return <div key={run.id} className={"live-run"+(status.dangerous ? " live-run-alert" : "")}>
              <strong>{status.heading}</strong><p>{run.message}</p><p>{status.action}</p>
              {run.status === "review" && run.order && <p><b>Order:</b> {run.order.quantity} ticket(s) · {run.order.currency} {run.order.totalMinor / (["JPY", "KRW"].includes(run.order.currency) ? 1 : 100)} including fees · {run.order.seats.join(", ")}</p>}
              {run.receipt && <p>Receipt reference reported by provider: {run.receipt}</p>}
              <div className="booking-actions">
                {["review", "awaiting_user"].includes(run.status) && <button className="button button-primary"
                  disabled={Boolean(busy)} onClick={() => void runControl(run, "resume")}>
                  {run.status === "review" ? "Review and authorize payment…" : "Resume after completing required step"}</button>}
                {!terminal.has(run.status) && <button className="button button-outline"
                  disabled={Boolean(busy)} onClick={() => void runControl(run, "stop")}>Stop assistance</button>}
              </div>
            </div>;
          }) : <p className="live-manual-label"><CircleHelp size={15}/> Guided/manual booking. No automation run is active for this window.</p>}
        </div>
      </div>
      <aside className="live-assistant">
        <div className="live-assistant-card">
          <h3><Clock3 size={18}/> Your booking conditions</h3>
          <p><b>{plan.quantity} ticket(s)</b> · {money(plan)} including fees</p>
          <p>{plan.requireTogether ? "Adjacent seats required" : "Separate seats allowed"}
            · {plan.allowFallback ? "Ranked alternatives allowed" : "No unranked alternatives"}</p>
          {!plan.preferencesReady && <p className="live-warning">Preferences have not been marked ready in the Booking Plan.</p>}
        </div>
        <div className="live-assistant-card">
          <h3>Current step <small>Selected by you</small></h3>
          <p className="live-stage-disclaimer">TIXBAM cannot reliably detect the ticket site's queue, seats or payment status. Choose the stage yourself only to see relevant guidance.</p>
          {primary ? <>
            <label htmlFor="live-step">My current stage</label>
            <select id="live-step" value={primary.phase || "preparing"} disabled={Boolean(busy)}
              onChange={e => void invoke("stage", () => onPhase(primary.id, e.target.value as LivePhase))}>
              {steps.map(step => <option key={step.id} value={step.id}>{step.name}</option>)}
            </select>
            <p className="live-next-action">{steps.find(s => s.id === (primary.phase || "preparing"))?.help}</p>
            {riskStages.has(primary.phase || "preparing") && <p className="live-warning"><AlertTriangle size={15}/> Never retry an uncertain payment automatically.</p>}
          </> : <p>Open the official browser first. Its exact stage will not be inferred by TIXBAM.</p>}
        </div>
        <div className="live-assistant-card"><h3><LockKeyhole size={18}/> Safety</h3>
          <p>No verified provider receipt means no confirmed purchase. Avoid extra windows and refreshes during a queue. Keep your bank authentication available.</p>
        </div>
      </aside>
    </div> : <div className="empty-state"><Layers3 size={35}/>
      <h3>No Booking Plan selected</h3><p>Prepare your target ticket sale in My Bookings, then open its official browser here.</p>
      <button className="button button-outline" onClick={() => plans[0] && onSelectPlan(plans[0].id)}
        disabled={!plans.length}>Select first plan</button>
    </div>}
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