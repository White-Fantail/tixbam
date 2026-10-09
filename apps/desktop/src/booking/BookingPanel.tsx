import { useEffect, useRef, useState } from 'react';
import type { BookingContext, BookingPreferences, BookingRun, CardSummary } from '../../../../packages/addon-sdk';
import type { TicketAddon, TicketWindow, WatchEvent } from '../types';
import type { BookingPlan } from '../booking-plans';
const terminal = new Set(['completed', 'stopped', 'failed', 'payment_unknown']);
function defaults(ctx: BookingContext): BookingPreferences {
  return ctx.preferences || { schemaVersion: 1, quantity: 2, maxTotalMinor: 200000, currency: ctx.schema.currency, requireTogether: true, allowFallback: true, checkout: 'review', options: Object.fromEntries(ctx.schema.fields.map(f => [f.id, f.type === 'ranked' ? [] : ''])) };
}
export function BookingPanel({ event, addon, windows, onClose, plan, onPlanPreferencesSaved }: {
  event: WatchEvent; addon: TicketAddon; windows: TicketWindow[]; onClose: () => void;
  plan?: BookingPlan; onPlanPreferencesSaved?: (prefs: BookingPreferences) => Promise<void>;
}) {
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
      const ctx = await window.tixbam.bookingContext({providerId:event.providerId,eventUrl:event.url || addon.url,windowId,rehearsal});
      setContext(ctx);
      const previous = defaults(ctx);
      // The purchase goal owns the shared hard conditions. Provider-specific
      // dynamic choices remain in local preferences (never in the cloud plan).
      const initial = plan ? { ...previous, quantity: Math.min(plan.quantity, ctx.schema.maxTickets),
        maxTotalMinor: plan.budgetMinor || previous.maxTotalMinor,
        requireTogether: plan.requireTogether, allowFallback: plan.allowFallback } : previous;
      setPrefs(initial);
      setTextOptions(Object.fromEntries(ctx.schema.fields.filter(f=>f.type==='ranked'&&!f.choices).map(f=>[f.id,(initial.options[f.id] as string[]).join('\n')])));
      setConsent(false); setCvv('');
    });
  }
  function option(id: string, value: string | string[]) { if (prefs) { setPrefs({...prefs,options:{...prefs.options,[id]:value}}); setConsent(false); } }
  function rank(id: string, value: string, delta: number) {
    if (!prefs) return;
    const list = [...(prefs.options[id] as string[])], from = list.indexOf(value), to = from + delta;
    if (to >= 0 && to < list.length) { [list[from],list[to]]=[list[to],list[from]]; option(id,list); }
  }
  const active = Boolean(run && !terminal.has(run.status));
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
    <p className="settings-note">Cityline live options require its actual event booking form. Seat selection and payment pages are not yet verified and require manual attention.</p>
    {!directProviderUrl && <p className="rehearsal-note" role="note">The saved link is an event/promoter page, not a Cityline booking URL. Live options are unavailable until the direct official Cityline event link is saved. You can still try the offline demo below.</p>}
    <p className="settings-note">Offline demo uses fixed sample performances, prices, seats and simulated payment. It does not check availability or rehearse this actual concert.</p>
    <div className="booking-actions"><label>Cityline provider window<select value={windowId ?? ''} disabled={busy || active || !directProviderUrl} onChange={e=> { setWindowId(Number(e.target.value)||undefined); setContext(null); setPrefs(null); }}><option value="">Choose a window</option>{windows.map(w=><option key={w.id} value={w.id}>#{w.id} · {w.title || addon.name}</option>)}</select></label><button className="button button-outline" disabled={busy || active || !windowId || !directProviderUrl} title={!directProviderUrl ? 'A direct Cityline ticket URL is required to read real options.' : undefined} onClick={()=>read()}>Read live options</button><button className="button button-outline" disabled={busy || active} onClick={()=>read(true)}>Run offline demo</button></div>
    {context && prefs && <>
      {context.providerTitle && <p className="settings-note">Read from provider: {context.providerTitle} · Event #{context.providerEventId}. Check that this is your intended event before starting.</p>}
      {context.rehearsal && <p className="rehearsal-note">OFFLINE DEMO · These are sample Cityline-like options, not this concert's real tickets. No website requests, saved card access or charges.</p>}
      <fieldset disabled={busy || active}><legend>Booking conditions</legend>
        <div className="form-row"><label>Tickets<input type="number" min={1} max={context.schema.maxTickets} value={prefs.quantity} onChange={e=> { setPrefs({...prefs,quantity:Number(e.target.value)}); setConsent(false); }}/></label><label>Total budget including fees ({prefs.currency})<input type="number" min="0.01" step="0.01" value={prefs.maxTotalMinor/100} onChange={e=> { setPrefs({...prefs,maxTotalMinor:Math.round(Number(e.target.value)*100)}); setConsent(false); }}/></label></div>
        <label className="booking-check"><input type="checkbox" checked={prefs.requireTogether} onChange={e=>{ setPrefs({...prefs,requireTogether:e.target.checked}); setConsent(false); }}/>Adjacent seats required (when buying multiple seats)</label>
        <label className="booking-check"><input type="checkbox" checked={prefs.allowFallback} onChange={e=>{ setPrefs({...prefs,allowFallback:e.target.checked}); setConsent(false); }}/>Allow the ranked alternatives below</label>
        {context.schema.fields.map(field => <div className="booking-field" key={field.id}>
          <label>{field.label}{field.required ? ' *' : ''}
            {field.type === 'select' ? <select value={prefs.options[field.id] as string} onChange={e=>option(field.id,e.target.value)}><option value="">{field.required ? 'Select an option' : 'No requirement'}</option>{field.choices?.map(c=><option key={c.id} value={c.id} disabled={c.available===false}>{c.label}{c.available===false?' · Unavailable':''}</option>)}</select> : !field.choices ? <textarea rows={2} maxLength={4000} value={textOptions[field.id] || ''} onChange={e=> { setTextOptions({...textOptions,[field.id]:e.target.value}); option(field.id,e.target.value.split('\n').map(s=>s.trim()).filter(Boolean)); }}/> : <div className="rank-options">{field.choices.map(c=> {
              const selected=prefs.options[field.id] as string[], i=selected.indexOf(c.id);
              return <div className="rank-choice" key={c.id}><button type="button" className={'button button-outline'+(i>=0?' selected':'')} disabled={c.available===false} onClick={()=>option(field.id,i<0?[...selected,c.id]:selected.filter(v=>v!==c.id))}>{i>=0?`${i+1}. `:''}{c.label}</button>{i>=0&&<><button type="button" aria-label={'Move '+c.label+' up'} disabled={i===0} onClick={()=>rank(field.id,c.id,-1)}>↑</button><button type="button" aria-label={'Move '+c.label+' down'} disabled={i===selected.length-1} onClick={()=>rank(field.id,c.id,1)}>↓</button></>}</div>;
            })}</div>}
          </label>{field.hint && <p className="input-hint">{field.hint}</p>}
        </div>)}
        <label>Checkout<select value={prefs.checkout} onChange={e=> { setPrefs({...prefs,checkout:e.target.value as 'review'|'automatic'}); setConsent(false); }}><option value="review">Confirm final order before payment</option><option value="automatic">Automatically pay within my conditions</option></select></label>
        {!context.rehearsal && <><label>Local payment card<select value={cardId} onChange={e=>setCardId(e.target.value)}><option value="">No card prepared</option>{cards.map(c=><option key={c.id} value={c.id}>{c.label} · •••• {c.last4}</option>)}</select></label>{cardId&&<label>CVV for this run<input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={cvv} onChange={e=>setCvv(e.target.value)}/><small>Kept in memory for up to 30 minutes. Cleared at completion, stop or failure.</small></label>}</>}
        {prefs.checkout==='automatic' && <label className="booking-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I authorize payment for this event, up to {prefs.currency} {(prefs.maxTotalMinor/100).toFixed(2)}, when all required conditions match.</label>}
      </fieldset>
      <div className="booking-actions"><button className="button button-outline" disabled={busy || active} onClick={()=>perform(async()=> { await window.tixbam!.saveBookingPreferences(context.contextId,prefs); await onPlanPreferencesSaved?.(prefs); setError('Preferences saved on this device and booking plan updated.'); })}>Save preferences</button><button className="button button-primary" disabled={busy || active || (prefs.checkout==='automatic'&&!consent)} onClick={()=>perform(async()=> { const code=cvv; setCvv(''); setRun(await window.tixbam!.startBooking({contextId:context.contextId,preferences:prefs,cardId:cardId||undefined,cvv:code,paymentConsent:consent})); })}>Start {context.rehearsal?'rehearsal':'booking'}</button></div>
    </>}
    {run&&<div className="booking-run" role="status"><strong>{run.rehearsal?'REHEARSAL · ':''}{run.status.replaceAll('_',' ').toUpperCase()}</strong><p>{run.message}</p>{run.order&&run.status==='review'&&<p>{run.order.quantity} ticket(s) · {run.order.currency} {(run.order.totalMinor/100).toFixed(2)} including fees · {run.order.seats.join(', ')}</p>}{run.receipt&&<p>{run.receipt}</p>}
      <div className="booking-actions">{['awaiting_user','review'].includes(run.status)&&<button className="button button-primary" disabled={busy} onClick={()=>perform(async()=>setRun(await window.tixbam!.resumeBooking(run.id,run.status==='review')))}>{run.status==='review'?'Confirm this order and pay':run.rehearsal?'Complete simulated verification & resume':'I completed the required step · Resume'}</button>}{active&&<button className="button button-outline" disabled={busy} onClick={()=>perform(async()=>setRun(await window.tixbam!.stopBooking(run.id)))}>Stop and clear payment preparation</button>}</div>
    </div>}
    {active && <p className="input-hint">Closing this panel keeps the run active. Manage it in Live windows, or stop it here.</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
  </div></div>;
}
