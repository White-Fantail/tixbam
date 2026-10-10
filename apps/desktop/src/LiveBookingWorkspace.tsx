import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CircleHelp, Clock3,
  ExternalLink, Globe2, Layers3, LockKeyhole, Monitor, ShieldAlert, TicketCheck, X } from "lucide-react";
import type { BookingRun } from "../../../packages/addon-sdk";
import type { BookingPlan } from "./booking-plans";
import { currencyFactor } from "./booking-plans";
import { tx, localDate } from "./i18n";
import { SaleCountdown } from "./BookingWorkspace";
import { formatSaleLocalTime } from "./ticket-sales";
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
  const [reviewApprovals,setReviewApprovals]=useState<Record<string,{signature:string;at:number}>>({});
  const reviewKey=(run:BookingRun)=>JSON.stringify({id:run.id,order:run.order});
  const isReviewApproved=(run:BookingRun)=>{
    const approved=reviewApprovals[run.id];
    return run.status==="review"&&!!run.order&&!!approved&&
      approved.signature===reviewKey(run)&&Date.now()-approved.at<60_000;
  };
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

  const selectedPlan = plans.find(item => item.id === selectedPlanId);
  const activePlan = plans.find(item => planSessions.some(win => win.planId === item.id));
  // An ongoing sale should be visible immediately, even after browsing another plan.
  const chosenPlan = selectedPlan && (!activePlan ||
    planSessions.some(win => win.planId === selectedPlan.id)) ? selectedPlan :
    activePlan || selectedPlan || plans.find(item => item.id === history[0]?.planId) || null;
  const plan = chosenPlan;
  const matching = planSessions.filter(item => item.planId === plan?.id);
  const primary = matching[matching.length - 1];
  const extra = windows.filter(item => item.planId === plan?.id && item.popup);
  const remainingPopup = !primary && extra.length ? extra[extra.length - 1] : null;
  const selectedWindow = matching.find(item => item.id === selectedWindowId) || primary;
  const relatedRuns = runs.filter(run => !run.rehearsal && (!selectedWindow
    ? false : run.windowId === selectedWindow.id));
  const orphanRuns = runs.filter(run => !run.rehearsal && (!run.windowId ||
    !windows.some(win => win.id === run.windowId)));
  const standalone = windows.filter(item => !item.planId);
  const unknownLinked = windows.filter(item => item.planId && !plans.some(p => p.id === item.planId) && !item.popup);
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
      if (!isReviewApproved(run)){
        setError(tx("Approval expired or order changed. Review and confirm the exact order again."));
        return;
      }
      const amount = (order.totalMinor / currencyFactor(order.currency)).toFixed(currencyFactor(order.currency) === 1 ? 0 : 2);
      if (!window.confirm("Authorize the exact displayed order and submit payment once?\n" +
        order.quantity + " ticket(s), " + order.currency + " " + amount +
        " including fees.\nVerify the official provider page first.")) return;
    }
    await invoke("run-" + run.id, async () => {
      const updated = action === "stop"
        ? await window.tixbam!.stopBooking(run.id)
        : await window.tixbam!.resumeBooking(run.id, run.status === "review");
      setReviewApprovals(current=>{const next={...current};delete next[run.id];return next;});
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
    {error && <p role="alert" className="form-error">{tx(error)}</p>}
    {planHistory.length > 0 && <div className="live-recovery" role="alert">
      <div className="live-recovery-head"><AlertTriangle size={21}/>
        <div><strong>Review previous ticketing sessions</strong>
          <p>These windows were closed or interrupted. TIXBAM did not restore their queue position or payment state.</p></div>
      </div>
      {planHistory.map(item => {
        const previous = plans.find(p => p.id === item.planId);
        return <div className="live-recovery-item" key={item.planId}>
          <span><b>{previous?.artist || "Booking plan"}</b> · {item.reason === "interrupted" ? "Session interrupted" : "Window closed"} · {localDate(item.updatedAt)}
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
          <TicketCheck size={15}/><span>{p?.artist || "Linked session"}</span><small>{addons.find(addon => addon.id === win.providerId)?.name || win.providerId} · #{win.id}</small>
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
          <div className="live-sale-time">
            <SaleCountdown saleAt={plan.saleAt}/>
            <span>{plan.saleAt ? "Scheduled sale: " + formatSaleLocalTime(plan.saleAt, plan.timezone || undefined) :
              "Official sale date not yet published"}</span>
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
            {selectedWindow ? <button className="button button-primary" disabled={busy !== ""}
                onClick={() => void invoke("focus", () => onFocus(selectedWindow.id))}><ExternalLink size={16}/> Focus official site</button> :
              remainingPopup ? <button className="button button-primary" disabled={busy !== ""}
                onClick={() => void invoke("focus-popup", () => onFocus(remainingPopup.id))}>
                <ExternalLink size={16}/> Focus remaining verification popup</button> :
              <button className="button button-primary" disabled={busy !== "" || !plan.bookingUrl}
                onClick={() => void invoke("start", () => onStart(plan))}><ExternalLink size={16}/> Open official ticket site</button>}
            {selectedWindow && <button className="button button-outline" disabled={busy !== ""}
              onClick={() => void invoke("close", () => onClose(selectedWindow.id))}><X size={16}/> Close browser…</button>}
            {selectedWindow && addons.find(a => a.id === selectedWindow.providerId)?.kind === "event-presale" &&
              <button className="button button-outline" disabled={busy !== ""}
                onClick={() => void invoke("agent", () => onTicketAgent(selectedWindow.id))}>Open official ticket agent <ArrowRight size={15}/></button>}
          </div>
          {remainingPopup && <p className="live-warning">The main ticket window is closed, but a provider popup is still open. Check it before starting another booking attempt.</p>}
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
              <strong>{tx(status.heading)}</strong><p>{run.message}</p><p>{tx(status.action)}</p>
              {run.status === "review" && run.order && <p><b>Order:</b> {run.order.quantity} ticket(s) · {run.order.currency} {(run.order.totalMinor / currencyFactor(run.order.currency)).toFixed(currencyFactor(run.order.currency) === 1 ? 0 : 2)} including fees · {run.order.seats.join(", ")}</p>} 
              {run.status==="review"&&run.order&&<div className="booking-review-panel" role="group" aria-label={tx("Final order approval")}>
                <strong>{tx("Final order approval")}</strong>
                <p>{tx("Manually verify the official provider window; unknown fees, seats or restricted terms must not be approved.")}</p>
                <dl><dt>{tx("Performance")}</dt><dd>{run.order.performance||tx("Not verified")}</dd>
                  <dt>{tx("Price tier")}</dt><dd>{run.order.priceTier||tx("Not verified")}</dd>
                  <dt>{tx("Seat allocation type")}</dt><dd>{tx(run.order.seatMode||"Not verified")}</dd>
                  <dt>{tx("Seats")}</dt><dd>{run.order.seats.length?run.order.seats.join(", "):tx("Standing / allocation details require confirmation")}</dd>
                  <dt>{tx("Restricted view")}</dt><dd>{run.order.restrictedView===undefined?tx("Not verified"):run.order.restrictedView?tx("Yes"):tx("No")}</dd>
                  <dt>{tx("Real-name requirement")}</dt><dd>{run.order.realNameRequired===undefined?tx("Not verified"):run.order.realNameRequired?tx("Yes"):tx("No")}</dd>
                  <dt>{tx("Optional extra products")}</dt><dd>{run.order.extras?.length?run.order.extras.map(item=>item.id).join(", "):tx("None included")}</dd>
                </dl>
                <label className="booking-review-check">
                  <input type="checkbox" checked={isReviewApproved(run)}
                    onChange={event=>setReviewApprovals(current=>{
                      if(!event.target.checked){const next={...current};delete next[run.id];return next;}
                      return {...current,[run.id]:{signature:reviewKey(run),at:Date.now()}};
                    })}/>
                  {tx("I personally checked the exact order. This approval is one-use and expires in 60 seconds.")}
                </label>
                <p>{tx("Actual unattended provider payment remains disabled.")}</p>
              </div>}
              {run.receipt && <p>Receipt reference reported by provider: {run.receipt}</p>}
              <div className="booking-actions">
                {["review", "awaiting_user"].includes(run.status) && <button className="button button-primary"
                  disabled={Boolean(busy)||(run.status==="review"&&!isReviewApproved(run))} onClick={() => void runControl(run, "resume")}>
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
          <div className="live-seat-summary" role="note">
            <strong>{tx("Mode: manual / reviewed assistance only")}</strong>
            <p>{tx("Unattended checkout is disabled unless the ticket agent explicitly authorizes it and the implementation is verified.")}</p>
            {plan.seatPreferences&&<p>{tx("Seat allocation type")}: {tx(plan.seatPreferences.seatMode||"No seat mode preference")}
              {plan.seatPreferences.priceTier.length>0&&<> · {tx("Price tier")}: {plan.seatPreferences.priceTier.join(" → ")}</>}
              {plan.seatPreferences.section.length>0&&<> · {tx("Section")}: {plan.seatPreferences.section.join(" → ")}</>}
            </p>}
            <p>{tx("High-risk permissions")}: {[
              plan.terms?.allowRestrictedView&&tx("Restricted view"),
              plan.terms?.allowRealName&&tx("Real-name requirement"),
              plan.terms?.allowAgeRestricted&&tx("Age restriction"),
              plan.terms?.allowAccessibilityRestricted&&tx("Accessibility restriction")
            ].filter(Boolean).join(", ")||tx("None approved")}</p>
          </div>
          {!plan.preferencesReady && <p className="live-warning">Preferences have not been marked ready in the Booking Plan.</p>}
        </div>
        <div className="live-assistant-card">
          <h3>Current step <small>Selected by you</small></h3>
          <p className="live-stage-disclaimer">TIXBAM cannot reliably detect the ticket site's queue, seats or payment status. Choose the stage yourself only to see relevant guidance.</p>
          {selectedWindow ? <>
            <label htmlFor="live-step">My current stage</label>
            <select id="live-step" value={selectedWindow.phase || "preparing"} disabled={Boolean(busy)}
              onChange={e => void invoke("stage", () => onPhase(selectedWindow.id, e.target.value as LivePhase))}>
              {steps.map(step => <option key={step.id} value={step.id}>{tx(step.name)}</option>)}
            </select>
            <p className="live-next-action">{tx(steps.find(s => s.id === (selectedWindow.phase || "preparing"))?.help || "")}</p>
            {riskStages.has(selectedWindow.phase || "preparing") && <p className="live-warning"><AlertTriangle size={15}/> Never retry an uncertain payment automatically.</p>}
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
    {unknownLinked.length > 0 && <section className="live-other-windows">
      <h3>Windows from another or unavailable plan</h3>
      <p>Ticket-site logins remain on this device after TIXBAM account changes. These windows are not assigned to the current account's plans; do not assume they represent the current target.</p>
      {unknownLinked.map(win => <div key={win.id} className="live-other-row">
        <span>#{win.id} · {addons.find(a => a.id === win.providerId)?.name || win.providerId} · {win.site || "Loading"}</span>
        <button className="button button-outline" disabled={Boolean(busy)} onClick={() => void invoke("focus"+win.id, () => onFocus(win.id))}>Focus</button>
        <button className="button button-outline" disabled={Boolean(busy)} onClick={() => void invoke("close"+win.id, () => onClose(win.id))}>Close…</button>
      </div>)}
    </section>}
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