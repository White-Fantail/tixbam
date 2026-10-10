import { useEffect, useRef, useState } from 'react';
import type { BookingContext, BookingPreferences, BookingRun, CardSummary } from '../../../../packages/addon-sdk';
import type { TicketAddon, TicketWindow, WatchEvent } from '../types';
import type { BookingPlan } from '../booking-plans';
import { currencyFactor } from '../booking-plans';
import { SeatRulesEditor } from './SeatRulesEditor';
import { tx, useLanguage } from '../i18n';
import { RunAIAdvisor } from './RunAIAdvisor';
import { ReservationNotice } from './ReservationNotice';
import { ManualBookingAssist } from './ManualBookingAssist';
const terminal = new Set(['completed', 'stopped', 'failed', 'payment_unknown']);
function defaults(ctx: BookingContext): BookingPreferences {
  return ctx.preferences || { schemaVersion: 1, quantity: 2, maxTotalMinor: 200000, currency: ctx.schema.currency, requireTogether: true, allowFallback: true, checkout: 'review', options: Object.fromEntries(ctx.schema.fields.map(f => [f.id, f.type === 'ranked' ? [] : ''])) };
}
type BookingPanelProps = {
  event: WatchEvent; addon: TicketAddon; windows: TicketWindow[]; onClose: () => void;
  plan?: BookingPlan; onPlanPreferencesSaved?: (prefs: BookingPreferences) => Promise<void>;
  onRehearse?: () => void;
};
export function BookingPanel(props: BookingPanelProps) {
  return props.addon.bookingAssistance?.mode === "manual"
    ? <ManualBookingAssist key={props.event.id} {...props}/>
    : <AutomationBookingPanel {...props}/>;
}
function AutomationBookingPanel({ event, addon, windows, onClose, plan, onPlanPreferencesSaved, onRehearse }: BookingPanelProps) {
  useLanguage(); // Re-render both Korean and English text after language switch.
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') { setCvv(''); close.current(); }
      if (e.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || []);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) return;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  const [windowId, setWindowId] = useState<number | undefined>(windows[0]?.id);
  const [context, setContext] = useState<BookingContext | null>(null);
  const [prefs, setPrefs] = useState<BookingPreferences | null>(null);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [cardId, setCardId] = useState('');
  const [cvv, setCvv] = useState('');
  const [textOptions, setTextOptions] = useState<Record<string,string>>({});
  const [consent, setConsent] = useState(false);
  const [finalApproval, setFinalApproval] = useState<{runId:string;signature:string;approvedAt:number}|null>(null);
  const [run, setRun] = useState<BookingRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    window.tixbam?.vaultStatus().then(v => { if (active) setCards(v.cards); }).catch(() => {});
    const off = window.tixbam?.onBookingChanged(r => { if (active && context && r.eventKey === context.eventKey) setRun(r); });
    return () => { active = false; off?.(); };
  }, [context]);
  useEffect(() => { if (!context) return; let active = true; window.tixbam?.listBookings().then(rs => { if (active) setRun([...rs].reverse().find(r=>r.eventKey===context.eventKey) || null); }); return () => { active=false; }; }, [context]);
  async function perform(fn: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError('');
    try { await fn(); } catch(e) { setError(e instanceof Error ? e.message : 'Booking action failed.'); } finally { setBusy(false); }
  }
  async function read(rehearsal = false) {
    await perform(async () => {
      if (!window.tixbam) throw new Error('Open the desktop app to configure booking.');
      const ctx = await window.tixbam.bookingContext({
        providerId:event.providerId, eventUrl:event.url || addon.url,
        windowId, planId:plan?.id, rehearsal
      });
      // Never reinterpret a KRW budget as HKD, or silently lower ticket quantity.
      if (plan && plan.currency !== ctx.schema.currency) {
        throw new Error('Plan currency ' + plan.currency + ' differs from the provider currency ' +
          ctx.schema.currency + '. Change your Booking Plan currency and re-enter its budget.');
      }
      if (plan && plan.quantity > ctx.schema.maxTickets) {
        throw new Error('This provider allows up to ' + ctx.schema.maxTickets +
          ' tickets. Update your Booking Plan quantity before continuing.');
      }
      setContext(ctx);
      const previous = defaults(ctx);
      // The payment mapping is not verified for live Cityline. Never let
      // a persisted demo setting imply that real automatic checkout is ready.
      const safe = !rehearsal ? { ...previous, checkout: 'review' as const } : previous;
      // The plan's hard limits override saved dynamic options; no implicit budget defaults.
      const planOptions = {...safe.options};
      if(plan?.seatPreferences) for(const field of ctx.schema.fields){
        const selected=plan.seatPreferences[field.id as keyof typeof plan.seatPreferences];
        if(selected===undefined)continue;
        if(field.type==='ranked'&&Array.isArray(selected)){
          planOptions[field.id]=selected.filter(item=>!field.choices||
            field.choices.some(c=>c.id===item));
        }else if(field.type==='select'&&typeof selected==='string'&&
          (!selected||!field.choices||field.choices.some(c=>c.id===selected))){
          planOptions[field.id]=selected;
        }
      }
      const initial = plan ? { ...safe, options:planOptions, quantity: plan.quantity,
        maxTotalMinor: plan.budgetMinor, requireTogether: plan.requireTogether,
        allowFallback: plan.allowFallback,
        terms: plan.terms || {} } : safe;
      setPrefs(initial);
      setTextOptions(Object.fromEntries(ctx.schema.fields.filter(f=>f.type==='ranked'&&!f.choices).map(f=>[f.id,(initial.options[f.id] as string[]).join('\n')])));
      setConsent(false); setFinalApproval(null); setCvv('');
    });
  }
  function option(id: string, value: string | string[]) { if (prefs) { setPrefs({...prefs,options:{...prefs.options,[id]:value}}); setConsent(false); } }
  function rank(id: string, value: string, delta: number) {
    if (!prefs) return;
    const list = [...(prefs.options[id] as string[])], from = list.indexOf(value), to = from + delta;
    if (to >= 0 && to < list.length) { [list[from],list[to]]=[list[to],list[from]]; option(id,list); }
  }
  const active = Boolean(run && !terminal.has(run.status));
  const reviewSignature = run?.status==='review' && run.order?
    JSON.stringify({id:run.id,order:run.order}):null;
  const reviewApproved = reviewSignature!==null &&
    finalApproval?.runId===run?.id && finalApproval?.signature===reviewSignature && Date.now()-finalApproval.approvedAt<60_000;
  // A promoter's event page can describe a Cityline sale without being
  // Cityline's own event booking form. The demo is independent of either site.
  const directProviderUrl = (() => {
    try {
      const parsed = new URL(event.url);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
        addon.allowedHosts.some(host => parsed.hostname.toLowerCase() === host ||
          parsed.hostname.toLowerCase().endsWith('.' + host));
    } catch {
      return false;
    }
  })();
  return <div className="modal-backdrop"><div className="modal booking-modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="booking-title">
    <div className="modal-top"><span className="eyebrow">{addon.name} · BOOKING PREFERENCES</span><button className="icon-button" aria-label="Close booking settings" onClick={() => { setCvv(''); onClose(); }}>×</button></div>
    <h2 id="booking-title">{event.title}</h2><p>Quantity, adjacency and total budget are required conditions. Ranked alternatives are used only when you allow them.</p>
    {addon.id === "cityline" && <p className="settings-note">{tx('Cityline terms prohibit automated interaction and purchases. A separately authorized integration and verified checkout are required. Purchase tickets manually in the official window.')}</p>}
    {!directProviderUrl && <p className="rehearsal-note" role="note">The saved link is an event/promoter page, not a Cityline booking URL. Live options are unavailable until the direct official Cityline event link is saved. You can still try the offline demo below.</p>}
    <p className="settings-note">{onRehearse ?
    "For full Cityline training, open the Booking Plan rehearsal: eight scenarios with ticket limits, seat choices, cart, simulated payment and safe recovery." :
    "Basic sample adapter demo; for full Cityline rehearsal, create a Booking Plan. No real tickets or payments are involved."}</p>
    <div className="booking-actions"><label>Cityline provider window<select value={windowId ?? ''} disabled={busy || active || !directProviderUrl} onChange={e=> { setWindowId(Number(e.target.value)||undefined); setContext(null); setPrefs(null); }}><option value="">Choose a window</option>{windows.map(w=><option key={w.id} value={w.id}>#{w.id} · {w.title || addon.name}</option>)}</select></label><button className="button button-outline" disabled={busy || active || !windowId || !directProviderUrl} title={!directProviderUrl ? 'A direct Cityline ticket URL is required to read real options.' : undefined} onClick={()=>read()}>Read live options</button>{onRehearse ? <button className="button button-outline" disabled={busy || active}
  onClick={onRehearse}>Open Cityline rehearsal scenarios</button> :
  <button className="button button-outline" disabled={busy || active}
    onClick={()=>read(true)} title="Legacy sample adapter test; for full training, create a Booking Plan.">Basic sample demo</button>}</div>
    {context && prefs && <>
      {context.providerTitle && <p className="settings-note">Read from provider: {context.providerTitle} · Event #{context.providerEventId}. Check that this is your intended event before starting.</p>}
      {context.rehearsal && <p className="rehearsal-note">OFFLINE DEMO · These are sample Cityline-like options, not this concert's real tickets. No website requests, saved card access or charges.</p>}
      <fieldset disabled={busy || active}><legend>Booking conditions</legend>
        <div className="form-row"><label>Tickets<input type="number" min={1} max={context.schema.maxTickets} value={prefs.quantity} onChange={e=> { setPrefs({...prefs,quantity:Number(e.target.value)}); setConsent(false); }}/></label><label>Total budget including fees ({prefs.currency})<input type="number" min={currencyFactor(prefs.currency) === 1 ? "1" : "0.01"} step={currencyFactor(prefs.currency) === 1 ? "1" : "0.01"} value={prefs.maxTotalMinor/currencyFactor(prefs.currency)} onChange={e=> { setPrefs({...prefs,maxTotalMinor:Math.round(Number(e.target.value)*currencyFactor(prefs.currency))}); setConsent(false); }}/></label></div>
        <label className="booking-check"><input type="checkbox" checked={prefs.requireTogether} onChange={e=>{ setPrefs({...prefs,requireTogether:e.target.checked}); setConsent(false); }}/>Adjacent seats required (when buying multiple seats)</label>
        <label className="booking-check"><input type="checkbox" checked={prefs.allowFallback} onChange={e=>{ setPrefs({...prefs,allowFallback:e.target.checked}); setConsent(false); }}/>Allow the ranked alternatives below</label>
        {context.schema.fields.filter(field=>!['seatMode','fulfillment'].includes(field.id)).map(field => <div className="booking-field" key={field.id}>
          <label>{tx(field.label)}{field.required ? ' *' : ''}
            {field.type === 'select' ? <select value={prefs.options[field.id] as string} onChange={e=>option(field.id,e.target.value)}><option value="">{field.required ? 'Select an option' : 'No requirement'}</option>{field.choices?.map(c=><option key={c.id} value={c.id} disabled={c.available===false}>{tx(c.label)}{c.available===false?' · Unavailable':''}</option>)}</select> : !field.choices ? <textarea rows={2} maxLength={4000} value={textOptions[field.id] || ''} onChange={e=> { setTextOptions({...textOptions,[field.id]:e.target.value}); option(field.id,e.target.value.split('\n').map(s=>s.trim()).filter(Boolean)); }}/> : <div className="rank-options">{field.choices.map(c=> {
              const selected=prefs.options[field.id] as string[], i=selected.indexOf(c.id);
              return <div className="rank-choice" key={c.id}><button type="button" className={'button button-outline'+(i>=0?' selected':'')} disabled={c.available===false} onClick={()=>option(field.id,i<0?[...selected,c.id]:selected.filter(v=>v!==c.id))}>{i>=0?`${i+1}. `:''}{c.label}</button>{i>=0&&<><button type="button" aria-label={'Move '+c.label+' up'} disabled={i===0} onClick={()=>rank(field.id,c.id,-1)}>↑</button><button type="button" aria-label={'Move '+c.label+' down'} disabled={i===selected.length-1} onClick={()=>rank(field.id,c.id,1)}>↓</button></>}</div>;
            })}</div>}
          </label>{field.hint && <p className="input-hint">{field.hint}</p>}
        </div>)}
        <SeatRulesEditor key={context.contextId} showRanking={false} selections={{
          priceTier:Array.isArray(prefs.options.priceTier)?prefs.options.priceTier:[],
          section:Array.isArray(prefs.options.section)?prefs.options.section:[],
          floor:Array.isArray(prefs.options.floor)?prefs.options.floor:[],
          seatMode:(typeof prefs.options.seatMode==='string'?prefs.options.seatMode:'') as
            ''|'assigned'|'standing'|'automatic',
          fulfillment:typeof prefs.options.fulfillment==='string'?prefs.options.fulfillment:''
        }} terms={prefs.terms} disabled={busy||active}
        onSelections={selections=>{
          if(!prefs)return;
          const options={...prefs.options};
          for(const field of context.schema.fields){
            const value=selections[field.id as keyof typeof selections];
            if(value===undefined)continue;
            if(field.type==='ranked'&&Array.isArray(value))
              options[field.id]=value.filter(item=>!field.choices||field.choices.some(choice=>choice.id===item));
            if(field.type==='select'&&typeof value==='string'&&
              (!value||!field.choices||field.choices.some(choice=>choice.id===value)))
              options[field.id]=value;
          }
          setPrefs({...prefs,options});setConsent(false);setFinalApproval(null);
        }}
        onTerms={terms=>{setPrefs({...prefs,terms});setConsent(false);setFinalApproval(null);}}/>
        <label>{tx("Checkout mode")}<select value={prefs.checkout} onChange={e=> { setPrefs({...prefs,checkout:e.target.value as 'review'|'automatic'}); setConsent(false); }}><option value="review">{tx(context.rehearsal ? "Review every final order manually" : "User payment in the provider window")}</option><option value="automatic" disabled={!context.rehearsal}>{tx("Automatic checkout (offline rehearsal only)")}</option></select></label>
        {!context.rehearsal && context.checkoutReadiness?.livePaymentEnabled && <><label>Local payment card<select value={cardId} onChange={e=>setCardId(e.target.value)}><option value="">No card prepared</option>{cards.map(c=><option key={c.id} value={c.id}>{c.label} · •••• {c.last4}</option>)}</select></label>{cardId&&<label>CVV for this run<input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={cvv} onChange={e=>setCvv(e.target.value)}/><small>Kept in memory for up to 30 minutes. Cleared at completion, stop or failure.</small></label>}</>}
        {prefs.checkout==='automatic' && <label className="booking-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I authorize payment for this event, up to {prefs.currency} {(prefs.maxTotalMinor/currencyFactor(prefs.currency)).toFixed(currencyFactor(prefs.currency) === 1 ? 0 : 2)}, when all required conditions match.</label>}
      </fieldset>
      <div className="booking-actions"><button className="button button-outline" disabled={busy || active} onClick={()=>perform(async()=> { await window.tixbam!.saveBookingPreferences(context.contextId,prefs); await onPlanPreferencesSaved?.(prefs); setError('Preferences saved on this device and booking plan updated.'); })}>Save preferences</button><button className="button button-primary" disabled={busy || active || (!context.rehearsal && context.checkoutReadiness?.selectionStatus==='restricted') || run?.status==='payment_unknown' || prefs.maxTotalMinor <= 0 || (prefs.checkout==='automatic'&&!consent)} onClick={()=>perform(async()=> { const code=cvv; setCvv(''); setRun(await window.tixbam!.startBooking({contextId:context.contextId,preferences:prefs,cardId:cardId||undefined,cvv:code,paymentConsent:consent})); })}>Start {context.rehearsal?'rehearsal':'booking'}</button></div>
    </>}
    {run?.status==='payment_unknown'&&<p className="rehearsal-note" role="alert">
      {tx(run.safetyRecoveryRequired ? "Payment submission is not established. Review purchase safety records before any new attempt." : "Payment outcome unknown. Check the official order history before any new attempt.")}
    </p>}
    {run&&<div className="booking-run" role="status"><strong>{run.rehearsal?'REHEARSAL · ':''}{tx(run.safetyRecoveryRequired ? 'Purchase safety review required' : run.status.replaceAll('_',' ').toUpperCase())}</strong><p>{tx(run.message)}</p>{run.order&&run.status==='review'&&<p>{run.order.quantity} ticket(s) · {run.order.currency} {(run.order.totalMinor/currencyFactor(run.order.currency)).toFixed(currencyFactor(run.order.currency) === 1 ? 0 : 2)} including fees · {run.order.seats.join(', ')}</p>}{run.receipt&&<p>{run.receipt}</p>}
      {run.status==='review'&&run.order&&<div className="booking-review-panel" role="group" aria-label={tx("Final order approval")}>
        <h3>{tx("Final order approval")}</h3>
        <p>{tx("Review the verified order and total before approving this single checkout step. Do not approve if fees, restrictions, or seats are unknown.")}</p>
        <dl>
          <dt>{tx("Performance")}</dt><dd>{run.order.performance||tx("Not verified")}</dd>
          <dt>{tx("Restricted view")}</dt><dd>{run.order.restrictedView===undefined?tx("Not verified"):run.order.restrictedView?tx("Yes"):tx("No")}</dd>
          <dt>{tx("Real-name requirement")}</dt><dd>{run.order.realNameRequired===undefined?tx("Not verified"):run.order.realNameRequired?tx("Yes"):tx("No")}</dd>
          <dt>{tx("Age restriction")}</dt><dd>{run.order.ageRestricted===undefined?tx("Not verified"):run.order.ageRestricted?tx("Yes"):tx("No")}</dd>
          <dt>{tx("Optional extra products")}</dt><dd>{run.order.extras?.length?
            run.order.extras.map(extra=>extra.id).join(", "):tx("None included")}</dd>
          <dt>{tx("Tickets")}</dt><dd>{run.order.quantity}</dd>
          <dt>{tx("Total including fees")}</dt><dd>{run.order.currency} {(run.order.totalMinor/currencyFactor(run.order.currency)).toFixed(currencyFactor(run.order.currency)===1?0:2)}</dd>
          <dt>{tx("Seats")}</dt><dd>{run.order.seats?.length?run.order.seats.join(', '):tx("Standing / allocation details require confirmation")}</dd>
          <dt>{tx("Price tier")}</dt><dd>{run.order.priceTier||tx("Not verified")}</dd>
          <dt>{tx("Seat allocation type")}</dt><dd>{tx(run.order.seatMode||"Not verified")}</dd>
          <dt>{tx("Fulfillment")}</dt><dd>{tx(run.order.fulfillment||"Not verified")}</dd>
        </dl>
        {run.order.feeBreakdown&&<dl>
          <dt>{tx("Ticket subtotal")}</dt><dd>{run.order.feeBreakdown.ticketSubtotalMinor/currencyFactor(run.order.currency)}</dd>
          <dt>{tx("Service fees")}</dt><dd>{run.order.feeBreakdown.serviceFeeMinor/currencyFactor(run.order.currency)}</dd>
          <dt>{tx("Taxes")}</dt><dd>{run.order.feeBreakdown.taxMinor/currencyFactor(run.order.currency)}</dd>
          <dt>{tx("Delivery fee")}</dt><dd>{run.order.feeBreakdown.deliveryFeeMinor/currencyFactor(run.order.currency)}</dd>
          <dt>{tx("Extra products")}</dt><dd>{run.order.feeBreakdown.extrasMinor/currencyFactor(run.order.currency)}</dd>
        </dl>}
        <label className="booking-review-check">
          <input type="checkbox" checked={!!reviewApproved} onChange={e=>
            setFinalApproval(e.target.checked&&reviewSignature?
              {runId:run.id,signature:reviewSignature,approvedAt:Date.now()}:null)}/>
          {tx("I checked this exact order, all-in price, seats and extra conditions. I authorize only this reviewed step.")}
        </label>
        <p>{run.rehearsal?tx("Offline simulation: no real card will be charged."):
          tx("Actual provider payment automation is disabled. Finish payment in the official site.")}</p>
      </div>}
      <RunAIAdvisor run={run}/>
      <ReservationNotice {...run}/>
      <div className="booking-actions">{!['MANUAL_PAYMENT','RESERVATION_UNKNOWN'].includes(run.phase||'')&&['awaiting_user','review'].includes(run.status)&&<button className="button button-primary" disabled={busy || (run.status==='review'&&!reviewApproved)} onClick={()=>perform(async()=> {const approved=run.status==='review'&&!!finalApproval&&
            finalApproval.runId===run.id&&finalApproval.signature===reviewSignature&&
            Date.now()-finalApproval.approvedAt<60_000;
            if(run.status==='review'&&!approved)throw Error('Final order approval expired. Review the order again.');
            setFinalApproval(null);setRun(await window.tixbam!.resumeBooking(run.id,approved));})}>{run.status==='review'?(run.rehearsal?tx("Confirm MOCK checkout"):tx("Confirm reviewed order")):run.rehearsal?'Complete simulated verification & resume':'I completed the required step · Resume'}</button>}{active&&<button className="button button-outline" disabled={busy} onClick={()=>perform(async()=>setRun(await window.tixbam!.stopBooking(run.id)))}>Stop and clear payment preparation</button>}</div>
    </div>}
    {active && <p className="input-hint">Closing this panel keeps the run active. Manage it in Live windows, or stop it here.</p>}
    {error&&<p className="form-error" role="alert">{tx(error)}</p>}
  </div></div>;
}
