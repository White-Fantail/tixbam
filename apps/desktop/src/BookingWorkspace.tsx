import { useEffect, useState } from "react";
import { tx, localDate } from "./i18n";
import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, Circle, ExternalLink,
  FlaskConical, ListChecks, Plus, Settings2, ShieldAlert, TicketCheck, Trash2 } from "lucide-react";
import type { TicketAddon, RehearsalTarget } from "./types";
import { TicketSaleStatus } from "./TicketSaleStatus";
import { formatSaleLocalTime, saleTimestamp } from "./ticket-sales";
import { type BookingPlan, EMPTY_SEAT_SELECTIONS, currencyFactor, currencyForProvider, officialLinkKind, planChecks } from "./booking-plans";
import { SeatRulesEditor } from "./booking/SeatRulesEditor";


type Change = (next: BookingPlan) => Promise<void>;
type Props = {
  plans: BookingPlan[];
  addons: TicketAddon[];
  now: number;
  onCreate: () => void;
  onSelect: (id: string | null) => void;
  onSave: Change;
  onRemove: (id: string) => Promise<void>;
  onOpen: (plan: BookingPlan) => void;
  onConfigure: (plan: BookingPlan) => void;
  selectedId: string | null;
  onPractice: (plan: BookingPlan) => Promise<void>;
};

function addonFor(addons: TicketAddon[], id: string) {
  return addons.find(addon => addon.id === id);
}

export function SaleCountdown({ saleAt }: { saleAt: string }) {
  const [clock, setClock] = useState(Date.now);
  const opens = saleTimestamp(saleAt);
  const fast = opens !== null && opens > clock && opens - clock <= 24 * 60 * 60 * 1000;
  useEffect(() => {
    setClock(Date.now());
    if (opens === null) return;
    // High-frequency updates are isolated to this small component.
    const frequency = fast ? 1000 : 60000;
    const timer = window.setInterval(() => setClock(Date.now()), frequency);
    return () => window.clearInterval(timer);
  }, [opens, fast]);
  if (opens === null) return <span className="plan-countdown">Sale time TBA</span>;
  const remaining = Math.max(0, Math.ceil((opens - clock) / 1000));
  if (!remaining) return <span className="plan-countdown plan-countdown-open">Scheduled opening reached · check the official site</span>;
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  const label = days > 0 ? days + "d " + hours + "h " + minutes + "m" :
    pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
  return <span className={"plan-countdown" + (remaining <= 300 ? " plan-countdown-soon" : "")}>
    <CalendarClock size={16}/> Tickets open in <strong>{label}</strong>
  </span>;
}

function readiness(plan: BookingPlan, addons: TicketAddon[]) {
  return planChecks(plan, addonFor(addons, plan.providerId)?.allowedHosts || []);
}

function planSort(a: BookingPlan, b: BookingPlan, now: number) {
  const pa = saleTimestamp(a.saleAt), pb = saleTimestamp(b.saleAt);
  // Upcoming first, then recently opened, unannounced, and older sales.
  const group = (time: number | null) => time === null ? 2 :
    time > now ? 0 : time >= now - 86400000 ? 1 : 3;
  const priority = group(pa) - group(pb);
  if (priority) return priority;
  if (pa !== null && pb !== null && pa !== pb) {
    return group(pa) === 0 ? pa - pb : pb - pa;
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

function PlanCard({ plan, addons, now, onSelect, onPractice, onBook }: {
  plan: BookingPlan; addons: TicketAddon[]; now: number;
  onSelect: () => void; onPractice: () => void; onBook: () => void;
}) {
  const addon = addonFor(addons, plan.providerId);
  const checks = readiness(plan, addons);
  const finished = checks.filter(check => check.done).length;
  return <article className="plan-card">
    <div className="plan-card-top"><div>
      <span className="eyebrow">{addon?.name || (plan.providerId === "tba" ? "Provider TBA" : plan.providerId)} · BOOKING PLAN</span>
      <h3>{plan.artist}</h3><p>{plan.title}{plan.city ? " · " + plan.city : ""}</p>
      {plan.performanceAt && <small>Performance: {localDate(plan.performanceAt)}</small>}
    </div><TicketCheck size={25} /></div>
    <TicketSaleStatus saleAt={plan.saleAt} timezone={plan.timezone} now={now} showDate />
    <SaleCountdown saleAt={plan.saleAt}/>
    <div className="plan-progress"><span>{finished}/{checks.length} preparation checks</span>
      <progress max={checks.length} value={finished} aria-label="Preparation checks complete" /></div>
    <div className="plan-actions">
      <button className="button button-outline" onClick={onSelect}><Settings2 size={15}/> Prepare</button>
      <button className="button button-outline" onClick={onPractice}><FlaskConical size={15}/> Rehearse</button>
      <button className="button button-primary" onClick={onBook} disabled={!plan.bookingUrl || !addon?.installed}><ExternalLink size={15}/> Open tickets</button>
    </div>
  </article>;
}

/** This is an explicitly generic, offline interaction drill; never access a ticketing site. */
export function RehearsalSimulator({ plan, onComplete, onClose }: {
  plan: RehearsalTarget; onComplete: () => Promise<void>; onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const max = plan.budgetMinor;
  const good = max > 0 ? Math.round(max * 0.8) : 0;
  const amount = (minor: number) => plan.currency + " " +
    (minor / currencyFactor(plan.currency)).toLocaleString(undefined, {
      minimumFractionDigits: currencyFactor(plan.currency) === 1 ? 0 : 2,
      maximumFractionDigits: currencyFactor(plan.currency) === 1 ? 0 : 2,
    });
  async function finish() {
    setBusy(true); setError("");
    try { await onComplete(); setStep(5); }
    catch (err) {
      setError("Practice finished, but your rehearsal result could not be saved. Reconnect and try again.");
      setStep(5);
    }
    finally { setBusy(false); }
  }
  return <section className="practice-panel" aria-label="Offline rehearsal">
    <div className="practice-header"><div><span className="eyebrow">GENERIC OFFLINE SIMULATION</span>
      <h3>Rehearse your booking</h3></div><button className="button button-outline" onClick={onClose}>Close</button></div>
    <p>This is a generic practice scenario, not the actual {plan.providerId} booking page. It does not verify inventory, enter a queue, reserve seats or charge a card.</p>
    <div className="practice-steps">Practice step {Math.min(step + 1, 5)} of 5</div>
    {step === 0 && <div className="practice-stage">
      <h4>1. Know your booking conditions</h4>
      <p>{plan.quantity} ticket(s) · {max ? amount(max) : "No budget set"} maximum total · {plan.requireTogether ? "Adjacent seats required" : "Separate seats allowed"}</p>
      <p>Make sure your real provider account and payment authentication device are ready before the actual sale.</p>
      <button className="button button-primary" onClick={() => setStep(1)} disabled={!max || !plan.preferencesReady}>
        Start queue walkthrough <ArrowRight size={16}/></button>
      {(!max || !plan.preferencesReady) && <small>Set a total budget and save your preferences first.</small>}
    </div>}
    {step === 1 && <div className="practice-stage"><h4>2. Waiting room</h4>
      <p>The official waiting room may put you in a queue. Do not refresh or open extra sessions unless the ticket provider instructs you to.</p>
      <button className="button button-primary" onClick={() => setStep(2)}>Simulate admission <ArrowRight size={16}/></button>
    </div>}
    {step === 2 && <div className="practice-stage"><h4>3. Check the offer</h4>
      <p>Practice rejecting seats that do not satisfy the quantity, adjacency and maximum total price you chose.</p>
      <div className="practice-choices">
        <label><input type="radio" name="practice-offer" checked={picked === "over"} onChange={() => setPicked("over")}/>
          {plan.quantity} seats · {amount(max + 10000)} including fees</label>
        <label><input type="radio" name="practice-offer" checked={picked === "good"} onChange={() => setPicked("good")}/>
          {plan.quantity} {plan.requireTogether ? "adjacent " : ""}seats · {amount(good)} including fees</label>
      </div>
      <button className="button button-primary" disabled={!picked} onClick={() => picked === "good" ? (setError(""), setStep(3)) : setError("This total exceeds your limit. Do not accept it.")}>Check selection</button>
      {error && <p className="form-error" role="alert">{tx(error)}</p>}
    </div>}
    {step === 3 && <div className="practice-stage"><h4>4. Review before payment</h4>
      <p>Confirm the artist, performance, ticket quantity and final total including fees. The real payment page might still require bank verification.</p>
      <button className="button button-primary" onClick={() => setStep(4)}>Proceed to simulated verification</button>
    </div>}
    {step === 4 && <div className="practice-stage"><h4>5. Bank challenge and confirmation</h4>
      <p>Imagine completing 3-D Secure on your phone. Confirm the ticket provider's final order receipt before treating a real booking as successful. No real payment occurs here.</p>
      <button className="button button-primary" disabled={busy} onClick={() => void finish()}>Finish offline rehearsal</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>}
    {step === 5 && <div className="practice-stage"><CheckCircle2 size={26}/>
      <h4>Offline rehearsal finished</h4>
      <p>This confirms only that you completed the practice walkthrough. Real seat selection, queue placement, card processing and checkout remain unverified.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-outline" onClick={() => { setStep(0); setPicked(""); }}>Practice again</button>
    </div>}
  </section>;
}

export function BookingDashboard({ plans, addons, now, onCreate, onDiscover, onSelect, onPractice, onBook }: {
  plans: BookingPlan[]; addons: TicketAddon[]; now: number;
  onCreate: () => void; onDiscover: () => void; onSelect: (id: string) => void;
  onPractice: (id: string) => void; onBook: (plan: BookingPlan) => void;
}) {
  const upcoming = [...plans].filter(plan => {
    const sale = saleTimestamp(plan.saleAt);
    return sale === null || sale >= now - 86400000;
  }).sort((a,b) => planSort(a,b,now));
  const featured = upcoming[0] || [...plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return <section className="booking-dashboard">
    <div className="booking-hero"><span className="eyebrow">TIXBAM · TICKETING FIRST</span>
      <h1>Prepare. Practice. Book.</h1>
      <p>Build your booking plan, rehearse the flow and keep your next ticket drop under control.</p>
      <button className="button button-primary" onClick={onCreate}><Plus size={18}/> Create Booking Plan</button>
    </div>
    <div className="booking-key-actions">
      <div><ListChecks size={22}/><strong>Prepare</strong><span>Set requirements before tickets open.</span></div>
      <div><FlaskConical size={22}/><strong>Practice</strong><span>Rehearse without risking a purchase.</span></div>
      <div><TicketCheck size={22}/><strong>Book</strong><span>Launch the official site with your plan ready.</span></div>
    </div>
    <div className="section-heading"><div><div className="eyebrow">NEXT ACTION</div>
      <h2>{featured ? "Your next booking" : "Start with a booking plan"}</h2>
      <p>{featured ? "Prepare and rehearse before the official sale opens." : "Choose a concert in Discover or add a ticket link to create a plan."}</p></div></div>
    {featured ? <PlanCard plan={featured} addons={addons} now={now}
      onSelect={() => onSelect(featured.id)} onPractice={() => onPractice(featured.id)}
      onBook={() => onBook(featured)} /> : <button className="button button-outline" onClick={onDiscover}>Browse concert directory <ArrowRight size={15}/></button>}
    {plans.length > 1 && <p className="booking-more-note">{plans.length - 1} other booking plan(s) in My Bookings.</p>}
  </section>;
}

export function BookingPlansWorkspace({ plans, addons, now, onCreate, onSelect, onSave, onRemove,
  onOpen, onConfigure, selectedId, onPractice }: Props) {
  const selected = plans.find(plan => plan.id === selectedId);
  const [draft, setDraft] = useState<BookingPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(selected || null); setError(""); }, [selected?.id, selected?.updatedAt]);
  if (!selected || !draft) {
    return <section className="booking-plans-page">
      <div className="section-heading"><div><div className="eyebrow">YOUR TICKET PURCHASE GOALS</div>
        <h2>My Bookings</h2><p>Every ticket drop has one place for preparation, rehearsal and live booking.</p>
      </div><button className="button button-primary" onClick={onCreate}><Plus size={16}/> New plan</button></div>
      {plans.length ? <div className="booking-plans-grid">{[...plans].sort((a,b) => planSort(a,b,now)).map(plan =>
        <PlanCard key={plan.id} plan={plan} addons={addons} now={now}
          onSelect={() => onSelect(plan.id)}
          onPractice={() => { void onPractice(plan); }}
          onBook={() => onOpen(plan)}/>)}</div> :
        <div className="empty-state"><h3>No booking plans yet</h3><p>Start with an official ticket sale in Discover. You can also add your own event and URL.</p>
          <button className="button button-primary" onClick={onCreate}>Create your first booking plan</button></div>}
    </section>;
  }
  const addon = addonFor(addons, draft.providerId);
  const kind = officialLinkKind(draft, addon?.allowedHosts || []);
  const checks = readiness(draft, addons);
  const change = (patch: Partial<BookingPlan>) => {
    setDraft(current => current && ({ ...current, ...patch,
      preferencesReady: ("quantity" in patch || "budgetMinor" in patch || "currency" in patch || "requireTogether" in patch || "allowFallback" in patch || "seatPreferences" in patch || "terms" in patch) ? false : current.preferencesReady }));
  };
  const persist = async () => {
    setError("");
    if (draft.bookingUrl) {
      try {
        const url = new URL(draft.bookingUrl);
        if (url.protocol !== "https:" || url.username || url.password) throw Error("Invalid booking URL");
      } catch {
        setError("Use a valid official HTTPS ticket link, or leave the field blank until announced.");
        return;
      }
    }
    setSaving(true);
    try { await onSave({ ...draft, updatedAt: new Date().toISOString() }); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save your plan."); }
    finally { setSaving(false); }
  };
  return <section className="booking-plan-detail">
    <button className="subtle-link" onClick={() => onSelect(null)}><ArrowLeft size={16}/> All booking plans</button>
    <div className="section-heading"><div><span className="eyebrow">{addon?.name || (draft.providerId === "tba" ? "Provider TBA" : draft.providerId)} · BOOKING PLAN</span>
      <h2>{draft.artist}</h2><p>{draft.title}{draft.city ? " · " + draft.city : ""}</p>
    </div></div>
    <div className="booking-detail-columns"><div className="booking-detail-main">
      <div className="settings-panel">
        <h3><ListChecks size={19}/> Preparation</h3>
        <TicketSaleStatus saleAt={draft.saleAt} timezone={draft.timezone} now={now} showDate />
        <SaleCountdown saleAt={draft.saleAt}/>
        <p className="settings-note">Ticket sale: {formatSaleLocalTime(draft.saleAt, draft.timezone || undefined)}{draft.performanceAt ? " · " + tx("Performance:") + " " + localDate(draft.performanceAt) : ""}</p>
        <div className="plan-checklist">{checks.map(check => <div key={check.label}>
          {check.done ? <CheckCircle2 size={16} className="plan-check-yes"/> : <Circle size={16}/>}
          <span>{check.label}</span></div>)}</div>
        {kind !== "direct" && <div className="rehearsal-note"><ShieldAlert size={16}/> {kind === "promoter" ?
          "This link may lead to an event or promoter page, not the actual ticket checkout. Verify the official ticket agent before live booking." :
          "A verified direct ticket link is needed before live booking."}</div>}
      </div>
      <div className="settings-panel">
        <h3><Settings2 size={19}/> Booking preferences</h3>
        <div className="plan-provider-fields">
          <label>Official ticketing provider
            <select value={draft.providerId}
              onChange={e => change({providerId:e.target.value, currency:currencyForProvider(e.target.value),
                budgetMinor:0, preferencesReady:false})}>
              <option value="tba">Not announced yet</option>
              {addons.map(addon => <option key={addon.id} value={addon.id}>{addon.name}</option>)}
            </select>
          </label>
          <label>Official booking URL (when announced)
            <input type="url" value={draft.bookingUrl} placeholder="https://official-ticket-provider.example/"
              onChange={e => change({bookingUrl:e.target.value})}/>
          </label>
        </div>
        <p className="settings-note">Set the non-negotiable limits now. Provider-specific seat tiers and checkout options are configured separately when verified options are available.</p>
        <div className="form-row"><label>Tickets<input type="number" min={1} max={20} value={draft.quantity}
          onChange={e => change({ quantity: Number(e.target.value) })}/></label>
          <label>Maximum total incl. fees
            <div className="plan-currency-row"><select aria-label="Currency" value={draft.currency}
              onChange={e => change({ currency: e.target.value, budgetMinor: 0 })}>
              {["HKD", "KRW", "TWD", "USD", "NZD", "JPY", "SGD", "AUD", "GBP", "EUR"].map(code =>
                <option key={code} value={code}>{code}</option>)}
            </select>
            <input type="number" min={0} step={currencyFactor(draft.currency) === 1 ? "1" : "0.01"}
              value={draft.budgetMinor ? (draft.budgetMinor / currencyFactor(draft.currency)).toString() : ""}
              placeholder="Set a maximum total"
              onChange={e => change({ budgetMinor: Math.round(Number(e.target.value) * currencyFactor(draft.currency)) })}/></div>
          </label></div>
        <div className="plan-options"><label><input type="checkbox" checked={draft.requireTogether}
          onChange={e => change({ requireTogether: e.target.checked })}/> Require adjacent seats</label>
          <label><input type="checkbox" checked={draft.allowFallback}
            onChange={e => change({ allowFallback: e.target.checked })}/> Allow only explicitly ranked alternatives</label></div>
        <SeatRulesEditor key={draft.id} selections={draft.seatPreferences || EMPTY_SEAT_SELECTIONS}
          terms={draft.terms}
          onSelections={seatPreferences=>change({seatPreferences})}
          onTerms={terms=>change({terms})}/>
                <label className="plan-notes">Notes / preferred sections<textarea rows={3} maxLength={1000} value={draft.notes}
          onChange={e => change({ notes: e.target.value })} placeholder="e.g. Front section preferred; no restricted-view seats"/></label>
        <div className="plan-options"><label><input type="checkbox" checked={draft.accountReady}
          onChange={e => change({ accountReady: e.target.checked })}/> I've checked my ticketing account</label>
          <label><input type="checkbox" checked={draft.paymentReady}
            onChange={e => change({ paymentReady: e.target.checked })}/> My payment method and 3-D Secure device are ready</label></div>
        <div className="booking-actions">
          <button className="button button-primary" disabled={saving || !draft.quantity || draft.quantity < 1 || draft.quantity > 20 || draft.budgetMinor < 0} onClick={() => void persist()}>Save plan</button>
          <button className="button button-outline" disabled={saving || !draft.budgetMinor}
            onClick={() => { const next = { ...draft, preferencesReady: true }; setDraft(next); setSaving(true);
              void onSave(next).catch(e => setError(String(e))).finally(() => setSaving(false)); }}>Mark preferences ready</button>
        </div>
        {error && <p role="alert" className="form-error">{error}</p>}
      </div>
    </div><div className="booking-detail-side">
      <div className="settings-panel">
        <h3><FlaskConical size={19}/> Rehearsal</h3>
        <p>Practice ticketing steps using your saved conditions. Cityline includes a scenario-based checkout simulation; other providers use a generic walkthrough. No real purchase occurs.</p>
        {draft.lastRehearsalAt && <p className="settings-note">Offline drill completed: {localDate(draft.lastRehearsalAt)}</p>}
        <button className="button button-primary" disabled={saving} onClick={() => {
          void (async () => {
            setSaving(true);
            setError("");
            try {
              // Practice the latest visible conditions, never an older saved version.
              if (JSON.stringify(draft) !== JSON.stringify(selected)) await onSave(draft);
              await onPractice(draft);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not open the rehearsal.");
            } finally { setSaving(false); }
          })();
        }}><ExternalLink size={16}/> Open rehearsal window</button>
      </div>
      <div className="settings-panel"><h3><TicketCheck size={19}/> Live booking</h3>
        <p>Open the official ticketing site. Login, queue entry and human verification remain under your control.</p>
        <button className="button button-primary" onClick={() => onOpen(draft)} disabled={kind === "missing" || !addon?.installed}>
          <ExternalLink size={16}/> Open official ticket link</button>
        {addon?.booking && <button className="button button-outline" onClick={() => onConfigure(draft)}
          disabled={!addon.installed || kind !== "direct"}>Provider options & automation</button>}
        <p className="settings-note">{addon?.booking ?
          "Real seat selection and payment are not yet verified. Unsupported steps pause for manual completion." :
          "This provider currently supports guided/manual ticketing. Booking automation is not enabled."}</p>
      </div>
      <div className="settings-panel">
        <h3><ShieldAlert size={19}/> Verify purchase</h3>
        <p>After checkout, verify the ticket provider's confirmation page, receipt or order history. If payment status is unclear, do not attempt another charge until you confirm the result.</p>
        <p className="settings-note">Provider receipt verification and durable booking history are not available in this release. An offline rehearsal is never proof of purchase.</p>
      </div>
      <button className="button button-outline plan-delete" disabled={saving} onClick={() => {
        if (window.confirm("Delete this booking plan? Existing watchlist records are not deleted.")) {
          void onRemove(selected.id).then(() => { onSelect(null); }).catch(e => setError(String(e)));
        }
      }}><Trash2 size={15}/> Delete booking plan</button>
    </div></div>
  </section>;
}
