import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Clock3, CreditCard,
  FlaskConical, Info, LockKeyhole, RefreshCw, ShieldAlert, Ticket, XCircle } from "lucide-react";
import type { BookingPlan } from "../booking-plans";
import { currencyFactor } from "../booking-plans";
import {
  CITYLINE_SCENARIOS, CITYLINE_STEPS, CITYLINE_PERFORMANCES, CITYLINE_DELIVERY,
  CITYLINE_PRACTICE_HOLD_SECONDS, citylineScenario, citylineAvailableTiers,
  citylineMoney, citylineSeats, citylineQuote, expressSeatOffer,
  citylineOfferCheck, citylineNextFromResult
} from "./cityline-engine.mjs";

type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type PaymentOutcome = "simulated-receipt" | "unknown" | null;
type Report = { scenarioId: string; completedAt: string; durationSeconds: number; errors: number;
  outcome: "simulated-receipt" | "unknown-reviewed" };
const reportsKey = (planId: string) => "tixbam.rehearsal.cityline.v1." + planId;

function budgetLabel(plan: BookingPlan) {
  if (!plan.budgetMinor) return "Not set";
  const factor = currencyFactor(plan.currency);
  return plan.currency + " " + (plan.budgetMinor / factor).toLocaleString(undefined, {
    minimumFractionDigits: factor === 1 ? 0 : 2, maximumFractionDigits: factor === 1 ? 0 : 2
  });
}
function reportHistory(planId: string): Report[] {
  try {
    const item: unknown = JSON.parse(localStorage.getItem(reportsKey(planId)) || "[]");
    return Array.isArray(item) ? item.filter((report): report is Report => Boolean(report) &&
      typeof report === "object" && typeof report.scenarioId === "string" &&
      typeof report.durationSeconds === "number").slice(0, 10) : [];
  } catch { return []; }
}
function saveReport(planId: string, report: Report) {
  try {
    localStorage.setItem(reportsKey(planId),
      JSON.stringify([report, ...reportHistory(planId)].slice(0, 10)));
  } catch { /* private-browsing storage is optional; never block completing a drill */ }
}

export function CitylineRehearsal({ plan, onComplete, onClose }: {
  plan: BookingPlan; onComplete: () => Promise<void>; onClose: () => void;
}) {
  const [scenarioId, setScenarioId] = useState("standard");
  const [practiceBudgetHkd, setPracticeBudgetHkd] = useState("");
  const scenario = citylineScenario(scenarioId);
  const [stage, setStage] = useState<Stage>(0);
  const [loginMethod, setLoginMethod] = useState("email");
  const [memberReady, setMemberReady] = useState(false);
  const [presaleEligible, setPresaleEligible] = useState(false);
  const [performance, setPerformance] = useState(CITYLINE_PERFORMANCES[0].id);
  const [tierId, setTierId] = useState("");
  const [purchaseMode, setPurchaseMode] = useState<"normal" | "express">("normal");
  const [ticketType, setTicketType] = useState<"adult" | "concession">("adult");
  const [discountEligible, setDiscountEligible] = useState(false);
  const [identityReady, setIdentityReady] = useState(false);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [requestAdjacent, setRequestAdjacent] = useState(plan.requireTogether);
  const [deliveryId, setDeliveryId] = useState("eticket");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "wallet">("card");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [restrictedConsent, setRestrictedConsent] = useState(false);
  const [outcome, setOutcome] = useState<PaymentOutcome>(null);
  const [historyChecked, setHistoryChecked] = useState(false);
  const [challengeCompleted, setChallengeCompleted] = useState(false);
  const [checkoutEnds, setCheckoutEnds] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(CITYLINE_PRACTICE_HOLD_SECONDS);
  const [errors, setErrors] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [history, setHistory] = useState<Report[]>(() => reportHistory(plan.id));
  const [startAt, setStartAt] = useState(Date.now);
  const progress = useRef<HTMLDivElement>(null);

  const tiers = useMemo(() => citylineAvailableTiers(scenarioId), [scenarioId]);
  const seats = useMemo(() => citylineSeats(tierId || "b", scenarioId), [tierId, scenarioId]);
  const selectedSeats = seats.filter(seat => selectedSeatIds.includes(seat.id));
  const quote = citylineQuote({ tierId, quantity: plan.quantity, deliveryId });
  const possible = tierId && !tiers.find(t => t.id === tierId)?.soldOut;
  const offer = tierId ? citylineOfferCheck({
    tierId, quantity: plan.quantity, budgetMinor: trainingBudgetMinor, deliveryId,
    selectedSeatIds, seats, requireTogether: plan.requireTogether || requestAdjacent,
    acceptRestrictedView: restrictedConsent, scenarioId
  }) : null;
  const mismatch = plan.currency !== "HKD";
  const enteredHkd = Number(practiceBudgetHkd);
  const trainingBudgetMinor = mismatch ? Number.isFinite(enteredHkd) && enteredHkd > 0 &&
    enteredHkd < 100000000 && Number.isSafeInteger(Math.round(enteredHkd * 100))
      ? Math.round(enteredHkd * 100) : 0 : plan.budgetMinor;
  const canBegin = plan.quantity >= 1 &&
    plan.quantity <= scenario.maxTickets && trainingBudgetMinor > 0 && plan.preferencesReady;

  useEffect(() => {
    if (stage !== 7 || checkoutEnds === null) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((checkoutEnds - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [stage, checkoutEnds]);
  useEffect(() => {
    if (stage === 7 && remaining === 0 && checkoutEnds !== null) {
      setCheckoutEnds(null);
      setTermsAccepted(false);
      setFeedback("Practice checkout timer expired. The simulated offer has been released; choose tickets again.");
      setErrors(prev => prev + 1);
      setStage(3);
      setSelectedSeatIds([]);
    }
  }, [stage, remaining, checkoutEnds]);
  useEffect(() => {
    // Keep the current drill stage in view on smaller app windows.
    progress.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [stage]);

  function reset(id: string = scenarioId) {
    setScenarioId(id); setStage(0); setMemberReady(false); setPresaleEligible(false);
    setLoginMethod("email"); setTierId(""); setPurchaseMode(id === "express" || id === "presale" ? "express" : "normal");
    setTicketType("adult"); setDiscountEligible(false); setIdentityReady(false); setSelectedSeatIds([]);
    setRequestAdjacent(plan.requireTogether);
    setDeliveryId("eticket"); setPaymentMethod("card"); setTermsAccepted(false);
    setRestrictedConsent(false); setOutcome(null); setHistoryChecked(false); setChallengeCompleted(false);
    setCheckoutEnds(null); setRemaining(CITYLINE_PRACTICE_HOLD_SECONDS);
    setErrors(0); setFeedback(""); setSaveError(""); setSynced(false); setStartAt(Date.now());
  }
  function warn(message: string) { setFeedback(message); setErrors(n => n + 1); }
  function go(to: Stage) { setFeedback(""); setStage(to); }
  function chooseTier(id: string) {
    if (tiers.find(t => t.id === id)?.soldOut) { warn("This practice price zone is sold out. Choose another."); return; }
    setTierId(id); setSelectedSeatIds([]); setRestrictedConsent(false); setFeedback("");
  }
  function chooseSeat(id: string) {
    const seat = seats.find(s => s.id === id);
    if (!seat || seat.sold) return;
    setSelectedSeatIds(current => current.includes(id)
      ? current.filter(s => s !== id)
      : current.length >= plan.quantity ? [...current.slice(1), id] : [...current, id]);
    setFeedback("");
  }
  function seatStepNext() {
    if (plan.quantity > 1 && plan.requireTogether && !requestAdjacent)
      return warn("Your Booking Plan requires adjacent seats. Enable the adjacent-seat request before proceeding.");
    if (scenario.mapUnavailable && purchaseMode === "normal")
      return warn("The practice seat map failed to load. Use the organiser's available Express Purchase option or wait for official guidance; do not repeatedly refresh a live queue.");
    if (!possible) return warn("Select an available price zone first.");
    if (purchaseMode === "express") {
      const proposed = expressSeatOffer(seats, plan.quantity, plan.requireTogether || requestAdjacent);
      if (proposed.length < plan.quantity) return warn("No suitable practice allocation for your conditions. Try a different price zone or scenario.");
      setSelectedSeatIds(proposed.map(s => s.id));
      if (proposed.some(s => s.restrictedView) && !restrictedConsent)
        return warn("Express allocation includes a restricted-view seat. Explicitly accept or switch to another option.");
      go(5);
      return;
    }
    if (selectedSeatIds.length !== plan.quantity)
      return warn("Choose exactly " + plan.quantity + " practice seat" + (plan.quantity === 1 ? "" : "s") + ".");
    if ((plan.requireTogether || requestAdjacent) && selectedSeats.length > 1) {
      const result = citylineOfferCheck({
        tierId, quantity: plan.quantity, budgetMinor: trainingBudgetMinor, deliveryId,
        selectedSeatIds, seats, requireTogether: plan.requireTogether || requestAdjacent,
        acceptRestrictedView: restrictedConsent, scenarioId
      });
      if (!result.ok) return warn(result.reason);
    }
    const result = citylineOfferCheck({
      tierId, quantity: plan.quantity, budgetMinor: trainingBudgetMinor, deliveryId,
      selectedSeatIds, seats, requireTogether: plan.requireTogether || requestAdjacent,
      acceptRestrictedView: restrictedConsent, scenarioId
    });
    if (!result.ok) return warn(result.reason);
    go(5);
  }
  function cartNext() {
    if (!offer?.ok) return warn(offer?.reason || "Choose a valid ticket offer.");
    go(6);
  }
  function deliveryNext() {
    if (scenario.realName && !identityReady)
      return warn("Real-name ticketing needs matching attendee identification. Check the event's official requirements before proceeding.");
    if (ticketType === "concession" && !discountEligible)
      return warn("Reduced-price tickets may require valid proof of eligibility. Confirm the required documentation.");
    const result = citylineOfferCheck({
      tierId, quantity: plan.quantity, budgetMinor: trainingBudgetMinor, deliveryId,
      selectedSeatIds, seats, requireTogether: plan.requireTogether,
      acceptRestrictedView: restrictedConsent, scenarioId
    });
    if (!result.ok) return warn(result.reason);
    setCheckoutEnds(Date.now() + CITYLINE_PRACTICE_HOLD_SECONDS * 1000);
    setRemaining(CITYLINE_PRACTICE_HOLD_SECONDS);
    go(7);
  }
  function submitPractice() {
    if (!termsAccepted) return warn("Review and accept the simulated terms before confirming.");
    if (remaining === 0) return warn("The practice countdown expired. Select the tickets again.");
    if (!offer?.ok) return warn(offer?.reason || "The offer no longer meets the booking conditions.");
    setCheckoutEnds(null);
    setHistoryChecked(false);
    setChallengeCompleted(false);
    go(8);
  }
  async function finish() {
    if (!outcome || (outcome === "unknown" && !historyChecked)) {
      warn("For an uncertain payment, check Transaction History before considering another charge.");
      return;
    }
    setBusy(true); setSaveError("");
    const report: Report = { scenarioId, completedAt: new Date().toISOString(),
      durationSeconds: Math.max(1, Math.round((Date.now() - startAt) / 1000)),
      errors, outcome: outcome === "unknown" ? "unknown-reviewed" : "simulated-receipt" };
    saveReport(plan.id, report);
    setHistory(reportHistory(plan.id));
    try { await onComplete(); setSynced(true); }
    catch { setSaveError("Practice completed locally, but the Booking Plan rehearsal timestamp could not be synced. Check your connection."); }
    finally { setBusy(false); }
  }
  const pct = ((stage + 1) / CITYLINE_STEPS.length) * 100;
  const totalAmount = quote ? citylineMoney(quote.totalMinor) : "Choose a zone";
  return <section className="cityline-drill" aria-label="Cityline offline ticketing rehearsal">
    <div className="cl-drill-top"><div>
      <span className="eyebrow">CITYLINE FLOW TRAINING · 100% OFFLINE</span>
      <h3><FlaskConical size={21}/> Ticket purchase rehearsal</h3>
      <p>Based on Cityline's published purchase guide and FAQs. Not a live Cityline page, seat map, queue or quote.</p>
    </div><button className="button button-outline" onClick={onClose}>Close rehearsal</button></div>
    <div className="cl-drill-notice" role="note">
      <Info size={19}/><span>All prices, availability, sessions, seats, fees, payment steps and time limits shown below are <strong>sample training data</strong>. Nothing is held, purchased, charged or submitted to Cityline.</span>
    </div>
    <div className="cl-drill-summary"><div><strong>{plan.title}</strong><span>{plan.artist} · Cityline practice target</span></div>
      <div><strong>{plan.quantity} ticket{plan.quantity === 1 ? "" : "s"}</strong><span>Target quantity</span></div>
      <div><strong>{budgetLabel(plan)}</strong><span>Plan maximum, in {plan.currency}</span></div>
    </div>
    <div className="cl-drill-progress" ref={progress}><div><span>Step {stage + 1} of {CITYLINE_STEPS.length}</span>
      <strong>{CITYLINE_STEPS[stage]}</strong><span>{Math.round(pct)}%</span></div>
      <progress max={100} value={pct} aria-label="Rehearsal progress"/>
    </div>
    {feedback && <div className="cl-drill-feedback" role="alert"><AlertCircle size={18}/>{feedback}</div>}
    {stage === 0 && <div className="cl-drill-stage">
      <h4>Choose a Cityline practice scenario</h4>
      <p>Different events support different booking methods. Choose the situation you need to rehearse.</p>
      <div className="cl-drill-scenarios">
        {CITYLINE_SCENARIOS.map(item => <button type="button" key={item.id} aria-pressed={scenarioId === item.id}
          className={"cl-drill-scenario" + (scenarioId === item.id ? " selected" : "")}
          onClick={() => reset(item.id)}>
          <span>{item.difficulty}</span><strong>{item.title}</strong><small>{item.description}</small>
        </button>)}
      </div>
      <div className="cl-drill-rules"><h5>Booking Plan readiness</h5>
        <p><b>Currency:</b> The real Hong Kong Cityline ticketing flow generally lists amounts in HKD. This drill only compares HKD to HKD and does not guess exchange rates.</p>
        <p><b>Seats:</b> {plan.requireTogether ? "Adjacent seats required" : "Separate seats permitted"} · {plan.allowFallback ? "Price-zone fallback allowed only when you choose it" : "No automatic fallback"}.</p>
        <p><b>Account:</b> This drill never asks for your password, bank verification code, or real card details.</p>
        {mismatch && <div className="cl-drill-currency" role="note">
          <div className="cl-drill-block"><ShieldAlert size={17}/>
            Your Booking Plan budget is in {plan.currency}, while this simulated Cityline sale quotes HKD. Enter a separate practice-only HKD limit below. No exchange rate is assumed, and your saved Booking Plan is not changed. Update the real plan to the correct sale currency before live booking.</div>
          <label>Practice-only maximum total (HKD)
            <input type="number" min="0.01" max="99999999" step="0.01" value={practiceBudgetHkd}
              placeholder="Enter your manually determined HKD limit"
              onChange={e => setPracticeBudgetHkd(e.target.value)}/>
          </label>
          {trainingBudgetMinor > 0 && <p>Practice ceiling: {citylineMoney(trainingBudgetMinor)} including sample fees.</p>}
        </div>}
        {plan.quantity > scenario.maxTickets && <div className="cl-drill-block" role="alert">This example event has a practice purchase limit of {scenario.maxTickets} ticket(s). Change your plan quantity or choose another scenario.</div>}
        {!plan.preferencesReady && <div className="cl-drill-block" role="alert">Save your Booking Plan and mark its preferences ready before continuing.</div>}
      </div>
      <button className="button button-primary" disabled={!canBegin} onClick={() => go(1)}>Enter practice ticketing site <ArrowRight size={15}/></button>
    </div>}
    {stage === 1 && <div className="cl-drill-stage">
      <h4>Ticketing admission / waiting room</h4>
      {scenario.queue ? <div className="cl-drill-queue">
        <Clock3 size={28}/><strong>Practice: high traffic waiting room</strong>
        <p>All online ticketing sessions are busy in this scenario. Remain on the page. Cityline warns against rapid repeated retrying.</p>
        <span>Simulated waiting · no real queue number or position</span>
        <button className="button button-outline" onClick={() => warn("Avoid rapid retries or refreshes. In a real queue, follow Cityline's on-screen instructions.")}>Try refreshing the queue</button>
        <button className="button button-primary" onClick={() => go(2)}>Simulate admission <ArrowRight size={16}/></button>
      </div> : <div className="cl-drill-action-card">
        <CheckCircle2 size={24}/><strong>Training website is available</strong>
        <p>For some events Cityline may route you through an official waiting room before entering ticket selection.</p>
        <button className="button button-primary" onClick={() => go(2)}>Continue to account check <ArrowRight size={15}/></button>
      </div>}
    </div>}
    {stage === 2 && <div className="cl-drill-stage">
      <h4>{scenario.presale ? "Member presale eligibility" : "Cityline member sign-in"}</h4>
      <p>Real Cityline login may involve an activated account or a one-time verification code. Complete actual authentication only on the official provider page.</p>
      <div className="cl-drill-fields">
        <label>Practice login choice<select value={loginMethod} onChange={e => {setLoginMethod(e.target.value); setMemberReady(false);}}>
          <option value="email">Email account / one-time code</option><option value="google">Google sign-in</option>
          <option value="apple">Apple sign-in</option><option value="facebook">Facebook sign-in</option>
        </select></label>
        <label className="cl-drill-check"><input type="checkbox" checked={memberReady}
          onChange={e => setMemberReady(e.target.checked)}/> I completed the simulated member verification (no credentials entered)</label>
        {scenario.presale && <label className="cl-drill-check"><input type="checkbox" checked={presaleEligible}
          onChange={e => setPresaleEligible(e.target.checked)}/> I have checked the presale eligibility or required payment conditions</label>}
      </div>
      <p className="cl-drill-helper"><LockKeyhole size={15}/> This rehearsal never sends a login request or collects an OTP.</p>
      <div className="cl-drill-nav"><button className="button button-outline" onClick={() => go(1)}><ArrowLeft size={15}/> Back</button>
        <button className="button button-primary" onClick={() => memberReady && (!scenario.presale || presaleEligible) ?
          go(3) : warn("Complete the simulated member and presale checks first.")}>Continue <ArrowRight size={15}/></button></div>
    </div>}
    {stage === 3 && <div className="cl-drill-stage">
      <h4>Select performance, price zone and ticket type</h4>
      <div className="cl-drill-fields">
        <label>Performance (fictional session)<select value={performance} onChange={e => {setPerformance(e.target.value); setSelectedSeatIds([]);}}>
          {CITYLINE_PERFORMANCES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label>Ticket type<select value={ticketType} onChange={e => {setTicketType(e.target.value as "adult" | "concession"); setDiscountEligible(false);}}>
          <option value="adult">Standard ticket</option>
          <option value="concession">Concession ticket · eligibility may be required</option>
        </select></label>
      </div>
      <div className="cl-drill-options-line">
        <p className="cl-drill-helper">Target: {plan.quantity} ticket{plan.quantity === 1 ? "" : "s"} · Practice limit: {scenario.maxTickets}</p>
        <label className="cl-drill-check"><input type="checkbox" checked={requestAdjacent} disabled={plan.quantity === 1}
          onChange={e => {setRequestAdjacent(e.target.checked); setSelectedSeatIds([]);}}/>
          Request adjacent seats {plan.quantity === 1 ? "(not applicable to one ticket)" : plan.requireTogether ? "— required by your plan" : "(optional)"}</label>
      </div>
      {ticketType === "concession" && <p className="cl-drill-helper">Concession is an eligibility exercise here; no discount is applied to the invented prices. Actual terms and prices are event-specific.</p>}
      <h5>Price zone <span>Invented prices / sample inventory</span></h5>
      <div className="cl-drill-tiers">
        {tiers.map(tier => {
          const preview = citylineQuote({tierId:tier.id, quantity:plan.quantity, deliveryId:"eticket"});
          const over = Boolean(preview && preview.totalMinor > trainingBudgetMinor);
          return <button key={tier.id} aria-pressed={tierId === tier.id} type="button"
            className={"cl-drill-tier" + (tier.id === tierId ? " selected" : "")} onClick={() => chooseTier(tier.id)}>
            <span className="cl-drill-tier-label"><strong>{tier.label}</strong><small>Ticket price {citylineMoney(tier.priceMinor)}</small></span>
            <span className="cl-drill-tier-cost"><b>{preview ? citylineMoney(preview.totalMinor) : "—"}</b>
              <small>{tier.soldOut ? "SOLD OUT · PRACTICE" : over ? "Over max incl. sample fees" : tier.restrictedView ? "Restricted view · practice" : "Total incl. sample fees"}</small></span>
          </button>;
        })}
      </div>
      <h5>Purchase method</h5>
      <div className="cl-drill-methods">
        <button type="button" aria-pressed={purchaseMode==="express"} className={purchaseMode==="express"?"selected":""}
          onClick={() => {setPurchaseMode("express"); setSelectedSeatIds([]);}}>Express Purchase
          <small>Computer suggests seats; no individual seat map selection</small></button>
        {!scenario.expressOnly && <button type="button" aria-pressed={purchaseMode==="normal"} className={purchaseMode==="normal"?"selected":""}
          onClick={() => {setPurchaseMode("normal"); setSelectedSeatIds([]);}}>Normal Purchase
          <small>Choose practice seats from a simplified diagram</small></button>}
      </div>
      {scenario.expressOnly && <p className="cl-drill-helper">This sample organiser permits Express Purchase only. Cityline says this varies by event.</p>}
      <div className="cl-drill-nav"><button className="button button-outline" onClick={() => go(2)}><ArrowLeft size={15}/> Back</button>
        <button className="button button-primary" onClick={() => !tierId ? warn("Choose a ticket price zone.") :
          tiers.find(t => t.id === tierId)?.soldOut ? warn("This zone is sold out.") :
          citylineQuote({tierId, quantity:plan.quantity})!.totalMinor > trainingBudgetMinor ?
            warn("The selected price zone exceeds your maximum budget including sample fees. Try a cheaper zone.") : go(4)}>
          Choose tickets <ArrowRight size={15}/></button></div>
    </div>}
    {stage === 4 && <div className="cl-drill-stage">
      <h4>{purchaseMode === "express" ? "Express allocation" : "Normal Purchase · practice seat map"}</h4>
      <p>Sample layout only. Real events differ by venue, available inventory and organiser settings.</p>
      <div className="cl-drill-legend"><span><i className="available"/>Available</span><span><i className="selected"/>Selected</span>
        <span><i className="sold"/>Unavailable</span><span><i className="restricted"/>Restricted view</span></div>
      <div className="cl-drill-seat-stage">
        <div className="cl-drill-stage-front">STAGE · PRACTICE LAYOUT</div>
        {scenario.mapUnavailable && purchaseMode === "normal"
          ? <div className="cl-drill-express" role="alert">
              <ShieldAlert size={26}/>
              <strong>Practice seat map failed to load</strong>
              <p>For a live ticket sale, follow the site's guidance. Do not reload or open extra sessions just to bypass the wait.</p>
              <button className="button button-outline" onClick={() => {setPurchaseMode("express"); setSelectedSeatIds([]); setFeedback("");}}>
                Switch to Express Purchase (available in this practice scenario)
              </button>
            </div>
          : purchaseMode === "normal" ? <div className="cl-drill-seats" role="group" aria-label="Fictional seat map">
          {seats.map(seat => <button key={seat.id} type="button" disabled={seat.sold}
            aria-label={"Seat " + seat.id + (seat.sold ? " unavailable" : seat.restrictedView ? " restricted view" : "")}
            aria-pressed={selectedSeatIds.includes(seat.id)} title={"Practice seat " + seat.id}
            className={"cl-drill-seat" + (seat.sold ? " sold" : "") +
              (selectedSeatIds.includes(seat.id) ? " selected" : "") +
              (seat.restrictedView ? " restricted" : "")}
            onClick={() => chooseSeat(seat.id)}>{seat.id}</button>)}
        </div> : <div className="cl-drill-express">
          <Ticket size={26}/><p>Cityline's Express Purchase can allocate available seats rather than showing a manual seat map. The practice allocation is simulated.</p>
          <button className="button button-outline" onClick={() => {
            const alloc = expressSeatOffer(seats, plan.quantity, plan.requireTogether);
            if (!alloc.length || alloc.length < plan.quantity) return warn("No qualifying practice seats could be allocated. Try another price zone.");
            setSelectedSeatIds(alloc.map(seat => seat.id)); setFeedback("");
          }}>Request sample allocation</button>
        </div>}
      </div>
      <div className="cl-drill-seat-summary"><strong>Selected: {selectedSeatIds.length} / {plan.quantity}</strong>
        <span>{selectedSeatIds.length ? selectedSeatIds.join(", ") : "No seats allocated"}</span>
        <span>{plan.requireTogether ? "Your plan requires adjacent seats" : "Your plan allows non-adjacent seats"}</span></div>
      {(selectedSeats.some(seat => seat.restrictedView) || tiers.find(t => t.id === tierId)?.restrictedView) &&
        <label className="cl-drill-check"><input type="checkbox" checked={restrictedConsent}
          onChange={e => setRestrictedConsent(e.target.checked)}/>
          I explicitly accept restricted-view practice seats (this overrides no assumption about real ticket availability)</label>}
      <div className="cl-drill-nav"><button className="button button-outline" onClick={() => go(3)}><ArrowLeft size={15}/> Change zone</button>
        <button className="button button-primary" onClick={seatStepNext}>Add practice tickets to cart <ArrowRight size={15}/></button></div>
    </div>}
    {stage === 5 && <div className="cl-drill-stage">
      <h4>Shopping cart</h4>
      <p>Cityline's published guide includes a cart review before checkout. The practice tickets shown here have not been held on the real site.</p>
      <div className="cl-drill-receipt-lines">
        <div><span>Performance</span><b>{CITYLINE_PERFORMANCES.find(item => item.id === performance)?.label}</b></div>
        <div><span>Ticket type</span><b>{ticketType === "adult" ? "Standard" : "Concession · verify eligibility"}</b></div>
        <div><span>Seats</span><b>{selectedSeatIds.join(", ")} · {plan.quantity} ticket{plan.quantity===1?"":"s"}</b></div>
        <div><span>Zone</span><b>{tiers.find(t => t.id === tierId)?.label}</b></div>
        <div><span>Tickets</span><b>{quote ? citylineMoney(quote.ticketsMinor) : "—"}</b></div>
        <div><span>Illustrative service fees</span><b>{quote ? citylineMoney(quote.feeMinor) : "—"}</b></div>
        <div className="total"><span>Estimated practice total</span><b>{totalAmount}</b></div>
      </div>
      <div className="cl-drill-nav"><button className="button button-outline" onClick={() => {setSelectedSeatIds([]); go(3);}}>Buy more / change choice</button>
        <button className="button button-primary" onClick={cartNext}>Proceed to checkout <ArrowRight size={15}/></button></div>
    </div>}
    {stage === 6 && <div className="cl-drill-stage">
      <h4>Delivery and payment options</h4>
      <p>Cityline's available delivery and payment methods vary by event. These are examples only; no real information is collected.</p>
      <div className="cl-drill-fields">
        <label>Ticket delivery / pickup<select value={deliveryId} onChange={e => {setDeliveryId(e.target.value); setFeedback("");}}>
          {CITYLINE_DELIVERY.map(method => <option key={method.id} value={method.id}>{method.label} · {citylineMoney(method.feeMinor)}</option>)}
        </select></label>
        <label>Payment method to rehearse<select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as "card" | "wallet")}>
          <option value="card">Credit card / bank verification</option><option value="wallet">Digital payment / app confirmation</option>
        </select></label>
      </div>
      {ticketType === "concession" && <label className="cl-drill-check"><input type="checkbox" checked={discountEligible}
        onChange={e => setDiscountEligible(e.target.checked)}/> I have valid eligibility documentation for this practice concession ticket</label>}
      {scenario.realName && <div className="cl-drill-block"><ShieldAlert size={17}/>
        This practice event has real-name admission. Real ticket holders may need matching government-issued identification.
        Do not type a real attendee name or identity number into TIXBAM.</div>}
      {scenario.realName && <label className="cl-drill-check"><input type="checkbox" checked={identityReady}
        onChange={e => setIdentityReady(e.target.checked)}/>
        I checked the organiser's real-name and attendee ID requirements (no personal details entered)</label>}
      <div className="cl-drill-receipt-lines">
        <div><span>Tickets</span><b>{quote ? citylineMoney(quote.ticketsMinor) : "—"}</b></div>
        <div><span>Illustrative service fees</span><b>{quote ? citylineMoney(quote.feeMinor) : "—"}</b></div>
        <div><span>Illustrative delivery fee</span><b>{quote ? citylineMoney(quote.deliveryMinor) : "—"}</b></div>
        <div className="total"><span>Practice total including fees</span><b>{totalAmount}</b></div>
        <div><span>Your maximum</span><b>{citylineMoney(trainingBudgetMinor)}</b></div>
      </div>
      <p className="cl-drill-helper">For a real purchase, verify the organiser's delivery cutoff, real-name rules, age eligibility, payment methods and complete fee schedule before confirming.</p>
      <div className="cl-drill-nav"><button className="button button-outline" onClick={() => go(5)}><ArrowLeft size={15}/> Back to cart</button>
        <button className="button button-primary" onClick={deliveryNext}>Transaction preview <ArrowRight size={15}/></button></div>
    </div>}
    {stage === 7 && <div className="cl-drill-stage">
      <div className="cl-drill-preview-top"><h4>Transaction preview</h4>
        <strong className={remaining<=30?"cl-drill-timer urgent":"cl-drill-timer"}><Clock3 size={17}/>
          Training timer: {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,"0")}</strong></div>
      <div className="cl-drill-block"><Info size={18}/> This is an invented {CITYLINE_PRACTICE_HOLD_SECONDS}-second drill timer. Cityline does not publish one universal hold limit for all concert sales. Never assume this is a real Cityline countdown.</div>
      <div className="cl-drill-receipt-lines">
        <div><span>Event</span><b>{plan.title} · practice only</b></div>
        <div><span>Performance</span><b>{CITYLINE_PERFORMANCES.find(p => p.id===performance)?.label}</b></div>
        <div><span>Price zone / seats</span><b>{tiers.find(t => t.id===tierId)?.label} · {selectedSeatIds.join(", ")}</b></div>
        <div><span>Tickets</span><b>{plan.quantity} · {ticketType === "adult"?"Standard":"Concession"}</b></div>
        <div><span>Fulfillment</span><b>{CITYLINE_DELIVERY.find(item=>item.id===deliveryId)?.label}</b></div>
        <div><span>Practice payment</span><b>{paymentMethod==="card"?"Card / bank verification":"Digital payment"}</b></div>
        <div className="total"><span>All-in total</span><b>{totalAmount}</b></div>
        <div><span>Budget</span><b>{citylineMoney(trainingBudgetMinor)}</b></div>
      </div>
      <label className="cl-drill-check"><input type="checkbox" checked={termsAccepted}
        onChange={e => setTermsAccepted(e.target.checked)}/>
        I reviewed the simulated purchase details and the terms, and understand that real Cityline purchases are generally non-refundable once confirmed.</label>
      <div className="cl-drill-nav"><button className="button button-outline" onClick={() => {setCheckoutEnds(null); go(6);}}>Payment details</button>
        <button className="button button-primary" disabled={!termsAccepted || remaining===0} onClick={submitPractice}>
          <LockKeyhole size={16}/> Confirm simulated transaction</button></div>
      <p className="cl-drill-helper">This button only moves the offline simulation forward. No card, order or site request is submitted.</p>
    </div>}
    {stage === 8 && <div className="cl-drill-stage">
      <h4>Simulated bank / payment verification</h4>
      <div className="cl-drill-action-card">
        <CreditCard size={25}/>
        <strong>{paymentMethod === "card" ? "Practice 3-D Secure challenge" : "Practice digital payment confirmation"}</strong>
        <p>This is not an actual bank page. On a real purchase, your bank or payment provider may request verification on your phone, via an approved banking app, or another secure method.</p>
        <p>Do not enter your real OTP, card details or bank password into TIXBAM rehearsals.</p>
        <label className="cl-drill-check"><input type="checkbox" checked={challengeCompleted}
          onChange={e => setChallengeCompleted(e.target.checked)}/>
          I completed the simulated verification on my own device</label>
        <button className="button button-primary" disabled={!challengeCompleted}
          onClick={() => {setOutcome(citylineNextFromResult(scenarioId)); go(9);}}>
          Check simulated transaction outcome <ArrowRight size={15}/></button>
      </div>
    </div>}
    {stage === 9 && <div className="cl-drill-stage">
      {outcome === "unknown" ? <div className="cl-drill-uncertain">
        <ShieldAlert size={29}/><h4>Payment outcome unknown — practice scenario</h4>
        <p>A fictional bank challenge completed but the ticket site never displayed a confirmed receipt. Do <strong>not</strong> retry payment immediately.</p>
        <p>Cityline's FAQ recommends checking Transaction History before another purchase. If still unclear, contact the provider.</p>
        <label className="cl-drill-check"><input type="checkbox" checked={historyChecked}
          onChange={e => setHistoryChecked(e.target.checked)}/>
          I understand that I must check official Transaction History before trying another charge</label>
      </div> : <div className="cl-drill-success">
        <CheckCircle2 size={30}/><h4>Practice transaction completed</h4>
        <strong>SIMULATION RECEIPT — NO PURCHASE</strong>
        <p>{plan.quantity} simulated ticket{plan.quantity===1?"":"s"} · {totalAmount} · Fictional {tiers.find(t=>t.id===tierId)?.label} seats</p>
        <p>Real tickets are confirmed only by the official provider receipt and Transaction History. No confirmation email is sent from this rehearsal.</p>
      </div>}
      <div className="cl-drill-report">
        <h5>Training report</h5>
        <div><span>Scenario</span><b>{scenario.title}</b></div>
        <div><span>Practice errors / recovery hints</span><b>{errors}</b></div>
        <div><span>Time used</span><b>{Math.max(1, Math.round((Date.now()-startAt)/1000))} sec</b></div>
        <div><span>Outcome</span><b>{outcome==="unknown"?"Uncertain charge — history check required":"Offline receipt only"}</b></div>
      </div>
      {synced ? <p className="cl-drill-synced" role="status"><CheckCircle2 size={17}/> Rehearsal completion saved to your Booking Plan. No real tickets purchased.</p> :
        <button className="button button-primary" disabled={busy || (outcome==="unknown"&&!historyChecked)}
          onClick={() => void finish()}><CheckCircle2 size={16}/> Save rehearsal completion</button>}
      {saveError && <p role="alert" className="cl-drill-feedback">{saveError}</p>}
      <button className="button button-outline" onClick={() => reset()}>Practice again <RefreshCw size={14}/></button>
      {history.length > 0 && <p className="cl-drill-helper">This device retains up to 10 locally stored practice reports. Only the completion timestamp is synced to your Booking Plan.</p>}
    </div>}
    {history.length > 0 && stage === 0 && <div className="cl-drill-history">
      <h4>Previous Cityline practice on this device</h4>
      {history.slice(0,3).map((r,i)=><p key={i}>{new Date(r.completedAt).toLocaleString()} · {citylineScenario(r.scenarioId).title} · {r.errors} recovery hint(s) · {r.outcome==="unknown-reviewed"?"Uncertain charge response":"Simulated receipt"}</p>)}
    </div>}
    <div className="cl-drill-footer"><XCircle size={16}/> NOT CITYLINE · NOT LIVE · NO INVENTORY, PAYMENT OR QUEUE ACCESS
      <span>Reference: Cityline public purchase guide and FAQs (Dec 2025)</span></div>
  </section>;
}
