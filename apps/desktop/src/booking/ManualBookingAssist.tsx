import { useEffect, useRef, useState } from 'react';
import type { BookingPreferences } from '../../../../packages/addon-sdk';
import type { TicketAddon, TicketWindow, WatchEvent } from '../types';
import type { BookingPlan } from '../booking-plans';
import { tx, useLanguage } from '../i18n';
import { EMPTY_MANUAL_DRAFT, hkdMinor, parseManualDraft, rankedLines, remainingSeconds, userDeadline } from './manual-assist';
import type { ManualDraft } from './manual-assist';

type Props = {
  event: WatchEvent; addon: TicketAddon; windows: TicketWindow[]; plan?: BookingPlan;
  onClose: () => void; onRehearse?: () => void;
  onPlanPreferencesSaved?: (prefs: BookingPreferences) => Promise<void>;
};
const stages = ['Preparation', 'Queue', 'Choose seats', 'Shopping cart', 'User payment'] as const;
export function ManualBookingAssist({ event, addon, windows, plan, onClose, onRehearse, onPlanPreferencesSaved }: Props) {
  useLanguage();
  const storageKey = 'tixbam.manual-assist.v1.' + addon.id + '.' + event.id;
  const [draft, setDraft] = useState<ManualDraft>(() => {
    let stored = {...EMPTY_MANUAL_DRAFT};
    try { stored = parseManualDraft(JSON.parse(localStorage.getItem(storageKey) || 'null')); } catch { /* Fresh local preparation. */ }
    if (!plan) return stored;
    return { ...stored, quantity: plan.quantity, budget: plan.currency === 'HKD' && plan.budgetMinor > 0 ? String(plan.budgetMinor / 100) : '',
      requireTogether: plan.requireTogether, allowFallback: plan.allowFallback,
      priceTier: plan.seatPreferences ? plan.seatPreferences.priceTier.join('\n') : stored.priceTier,
      section: plan.seatPreferences ? plan.seatPreferences.section.join('\n') : stored.section,
      floor: plan.seatPreferences ? plan.seatPreferences.floor.join('\n') : stored.floor,
      seatMode: plan.seatPreferences ? plan.seatPreferences.seatMode : stored.seatMode,
      fulfillment: plan.seatPreferences ? plan.seatPreferences.fulfillment : stored.fulfillment };
  });
  const [stage, setStage] = useState(0);
  const [route, setRoute] = useState<'express' | 'normal'>('express');
  const [windowId, setWindowId] = useState<number | undefined>(windows[0]?.id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Cart assertions and timers deliberately stay in memory; a reopened panel cannot imply a held seat.
  const [cartReported, setCartReported] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [cartTotal, setCartTotal] = useState('');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') close.current();
      if (e.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') || []);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) return;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    if (deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const time = Date.now(); setNow(time);
      if (time >= deadline) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const budget = hkdMinor(draft.budget);
  const total = hkdMinor(cartTotal);
  const quantityValid = Number.isSafeInteger(draft.quantity) && draft.quantity > 0 && draft.quantity <= 20;
  const currencyValid = !plan || plan.currency === 'HKD';
  const remaining = remainingSeconds(deadline, now);
  const checkLabels = ['Correct performance and date', 'Ticket quantity matches', 'Seat location and adjacency checked', 'Fees and ticket restrictions checked'];
  const reviewed = cartReported && checkLabels.every(label => checks[label]) && budget !== null && total !== null && total <= budget && currencyValid && quantityValid;
  function edit<K extends keyof ManualDraft>(key: K, value: ManualDraft[K]) {
    setDraft(current => ({...current, [key]: value})); setChecks({}); setMessage('');
  }
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : tx('Could not complete this action.')); }
    finally { setBusy(false); }
  }
  async function openOfficial() {
    if (!window.tixbam) throw Error(tx('Live booking requires the desktop app.'));
    const list = await window.tixbam.listWindows();
    const existing = list.find(item => item.id === windowId) || list.find(item =>
      plan ? item.planId === plan.id && !item.popup : item.providerId === addon.id && !item.planId && !item.popup);
    if (existing) {
      if (!await window.tixbam.focusWindow(existing.id)) throw Error(tx('The ticket window closed. Check Live windows before opening another one.'));
      setWindowId(existing.id); return;
    }
    if (plan) {
      const opened = await window.tixbam.openPlanWindow({planId: plan.id, providerId: addon.id, url: plan.bookingUrl || addon.url});
      setWindowId(opened.id);
    } else {
      // Recheck the host list to avoid opening a duplicate after a dashboard update.
      const matching = list.find(item => item.providerId === addon.id && !item.popup && !item.planId);
      if (matching) { await window.tixbam.focusWindow(matching.id); setWindowId(matching.id); }
      else { const opened = await window.tixbam.openSaleWindow({providerId: addon.id, url: event.url || addon.url}); setWindowId(opened.id); }
    }
  }
  async function save() {
    if (!currencyValid) throw Error(tx('Change the Booking Plan currency to HKD and re-enter its budget.'));
    if (!quantityValid || budget === null) throw Error(tx('Enter a valid ticket quantity and total HKD budget.'));
    const preferences: BookingPreferences = {
      schemaVersion: 1, quantity: draft.quantity, currency: 'HKD', maxTotalMinor: budget,
      requireTogether: draft.requireTogether, allowFallback: draft.allowFallback, checkout: 'review',
      options: { priceTier: rankedLines(draft.priceTier), section: rankedLines(draft.section), floor: rankedLines(draft.floor), seatMode: draft.seatMode, fulfillment: draft.fulfillment }, terms: plan?.terms || {}
    };
    await onPlanPreferencesSaved?.(preferences);
    localStorage.setItem(storageKey, JSON.stringify(draft));
    setMessage(tx('Local preparation saved. Confirm event-specific ticket limits on the official site.'));
  }
  function clearCart() { setCartReported(false); setChecks({}); setCartTotal(''); setDeadline(null); setMinutes(''); setSeconds(''); }
  return <div className="modal-backdrop"><div className="modal booking-modal manual-assist" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="manual-assist-title">
    <div className="modal-top"><span className="eyebrow">{addon.name} · {tx('Manual booking assistance')}</span><button className="icon-button" aria-label={tx('Close')} onClick={onClose}>×</button></div>
    <h2 id="manual-assist-title">{event.title}</h2>
    <p>{tx('Keep your seat priorities ready while you book in the official window. You select seats and pay there yourself.')}</p>
    <div className="booking-actions"><button className="button button-primary" disabled={busy || !window.tixbam} onClick={() => action(openOfficial)}>{tx(windowId ? 'Return to official ticket window' : 'Open official ticket window')}</button>
      {windows.length > 1 && <label>{tx('Official ticket window')}<select value={windowId ?? ''} onChange={e => setWindowId(Number(e.target.value))}>{windows.map(item => <option key={item.id} value={item.id}>{item.title || addon.name} · #{item.id}</option>)}</select></label>}
      {onRehearse && <button className="button button-outline" onClick={onRehearse}>{tx('Offline rehearsal')}</button>}
    </div>
    <p className="settings-note">{tx('Use one booking window. Returning to it does not reload the page or restart the queue.')}</p>
    <nav className="assist-stages" aria-label={tx('Manual booking stage')}>{stages.map((label, index) => <button key={label} type="button" className={'button button-outline' + (stage === index ? ' selected' : '')} aria-current={stage === index ? 'step' : undefined} onClick={() => setStage(index)}>{index + 1}. {tx(label)}</button>)}</nav>
    {stage === 0 && <fieldset disabled={busy}><legend>{tx('Local booking preparation')}</legend>
      {!currencyValid && <p className="form-error" role="alert">{tx('Change the Booking Plan currency to HKD and re-enter its budget.')}</p>}
      <div className="form-row"><label>{tx('Tickets')}<input type="number" min="1" max="20" value={draft.quantity} onChange={e => edit('quantity', Number(e.target.value))}/></label><label>{tx('Total budget including fees')} (HKD)<input type="text" inputMode="decimal" maxLength={20} value={draft.budget} onChange={e => edit('budget', e.target.value)}/></label></div>
      <p className="input-hint">{tx('The event sets the actual ticket limit. This local quantity does not establish eligibility.')}</p>
      <label>{tx('Performance / date to select')}<input maxLength={1000} value={draft.performance} onChange={e => edit('performance', e.target.value)}/></label>
      {(['priceTier', 'section', 'floor'] as const).map(key => <label key={key}>{tx({priceTier:'Price preference order', section:'Section preference order', floor:'Floor preference order'}[key])}<textarea rows={2} maxLength={1000} value={draft[key]} onChange={e => edit(key, e.target.value)}/></label>)}
      <p className="input-hint">{tx('Write your own labels, one per line, in priority order. These are reminders, not live availability.')}</p>
      <label className="booking-check"><input type="checkbox" checked={draft.requireTogether} onChange={e => edit('requireTogether', e.target.checked)}/>{tx('Adjacent seats required (when buying multiple seats)')}</label>
      <label className="booking-check"><input type="checkbox" checked={draft.allowFallback} onChange={e => edit('allowFallback', e.target.checked)}/>{tx('Allow the ranked alternatives below')}</label>
      <button className="button button-outline" disabled={!quantityValid || budget === null || !currencyValid} onClick={() => action(save)}>{tx('Save preferences')}</button>
    </fieldset>}
    <div className="assist-priorities" role="note"><strong>{tx('Your seat priorities')}</strong><p>{draft.quantity} {tx('Tickets')} · {tx('Total budget including fees')}: HKD {draft.budget || tx('Not set')} · {tx(draft.requireTogether ? 'Together required' : 'Separate seats allowed')}</p>
      <p>{draft.performance || plan?.performanceAt || tx('Performance not set')} · {rankedLines(draft.priceTier).join(' → ') || tx('Price tier not set')}{draft.section && ' · ' + rankedLines(draft.section).join(' → ')}{draft.floor && ' · ' + rankedLines(draft.floor).join(' → ')}</p>
      <p>{tx(draft.allowFallback ? 'Use your ranked alternatives only if needed.' : 'Keep the first preference; do not accept alternatives.')}</p></div>
    {stage === 1 && <div className="booking-panel"><h3>{tx('Wait in the official queue')}</h3><p>{tx('Sign in yourself and follow the official waiting room. Let the queue retry itself. Avoid refreshing, rapid retries or duplicate tabs.')}</p></div>}
    {stage === 2 && <div className="booking-panel"><h3>{tx('Choose seats in Cityline')}</h3><label>{tx('Purchase method')}<select value={route} onChange={e => setRoute(e.target.value as 'express' | 'normal')}><option value="express">Express Purchase</option><option value="normal">Normal Purchase</option></select></label>
      <p>{tx(route === 'express' ? 'Express: choose the performance, price zone, ticket type and quantity yourself. Cityline allocates the best available seats; inspect the resulting cart.' : 'Normal: choose the performance and available seats yourself on the seat map, then add them to the cart.')}</p>
      <p>{tx('Some events offer Express only. Standing tickets and event-specific rules can differ. If seats together matter, check the row and seat details in the cart; do not infer adjacency from ticket count.')}</p></div>}
    {stage >= 3 && <div className="booking-panel"><h3>{tx('Check the official cart')}</h3><p>{tx('Seats placed in the official cart may be held temporarily. Only the official page establishes the hold and its deadline.')}</p>
      <label className="booking-check"><input type="checkbox" checked={cartReported} onChange={e => { if (!e.target.checked) clearCart(); else setCartReported(true); }}/>{tx('I can see these tickets in the official cart (user report)')}</label>
      {checkLabels.map(label => <label className="booking-check" key={label}><input type="checkbox" checked={!!checks[label]} disabled={!cartReported} onChange={e => setChecks(current => ({...current, [label]: e.target.checked}))}/>{tx(label)}</label>)}
      <label>{tx('Cart total including all fees, entered by you')} (HKD)<input type="text" inputMode="decimal" maxLength={20} value={cartTotal} disabled={!cartReported} onChange={e => setCartTotal(e.target.value)}/></label>
      {total !== null && budget !== null && total > budget && <p className="form-error" role="alert">{tx('The entered total exceeds your budget. Check the official cart before paying.')}</p>}
      <p>{tx(reviewed ? 'Your local checks are complete. Finish payment in the same official window and check its receipt.' : 'Confirm the cart, seats, restrictions and all-in total in the official window before payment.')}</p>
      <fieldset disabled={!cartReported}><legend>{tx('Optional reminder from the time you see')}</legend><div className="form-row"><label>{tx('Minutes')}<input type="text" inputMode="numeric" maxLength={3} value={minutes} onChange={e => setMinutes(e.target.value)}/></label><label>{tx('Seconds')}<input type="text" inputMode="numeric" maxLength={2} value={seconds} onChange={e => setSeconds(e.target.value)}/></label></div>
        <button className="button button-outline" disabled={userDeadline(minutes, seconds, now) === null} onClick={() => { const time = Date.now(); setDeadline(userDeadline(minutes, seconds, time)); setNow(time); }}>{tx('Start local reminder')}</button>
        {remaining !== null && <p role={remaining === 0 ? 'alert' : undefined}><strong>{tx('User-entered time remaining')}: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</strong></p>}
        <p>{tx(remaining === 0 ? 'Your reminder expired. Check the official page; this does not establish that seats were released.' : 'This reminder is based only on your input. It does not verify or extend a seat hold. Follow the official timer.')}</p>
      </fieldset><button className="button button-outline" onClick={clearCart}>{tx('Clear local cart notes')}</button>
    </div>}
    {stage === 4 && <p className="rehearsal-note">{tx('Complete login, payment and any verification yourself. Confirm success through the official receipt or order history. This helper does not record a purchase as verified.')}</p>}
    <p className="settings-note">{tx('Closing this helper clears cart checks and the reminder. Save preparation before closing; your official browser stays open.')}</p>
    <div className="booking-actions"><span>{tx('Cityline guide and FAQ')}</span><button className="button button-outline" disabled={busy || !window.tixbam} onClick={() => action(async () => { await window.tixbam!.openAssistanceGuide(addon.id, 'guide'); })}>{tx('Purchase guide')}</button><button className="button button-outline" disabled={busy || !window.tixbam} onClick={() => action(async () => { await window.tixbam!.openAssistanceGuide(addon.id, 'faq'); })}>FAQ</button></div>
    {message && <p role="status">{message}</p>}
  </div></div>;
}
