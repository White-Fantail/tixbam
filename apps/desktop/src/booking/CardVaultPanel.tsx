import { useEffect, useState, type FormEvent } from 'react';
import { tx } from '../i18n';
import type { CardInput, CardSummary } from '../../../../packages/addon-sdk';
const blank = (): CardInput => ({ label: '', name: '', number: '', expiryMonth: 1, expiryYear: new Date().getFullYear() });
export function CardVaultPanel() {
  const [available, setAvailable] = useState(false);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [input, setInput] = useState(blank);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; window.tixbam?.vaultStatus().then(v => { if (active) { setAvailable(v.available); setCards(v.cards); } }).catch(() => { if (active) setError('Could not read the local card vault.'); }); return () => { active = false; }; }, []);
  async function save(e: FormEvent) {
    e.preventDefault(); if (!window.tixbam || busy) return; setBusy(true); setError('');
    try { setCards(await window.tixbam.saveCard(input)); setAdding(false); }
    catch { setError('Could not save this card. Check its details and operating-system secure storage.'); }
    finally { setInput(blank()); setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.tixbam || !window.confirm('Remove this saved card from this device?')) return;
    setBusy(true); setError('');
    try { setCards(await window.tixbam.removeCard(id)); } catch { setError('Could not remove the card. Stop active bookings first.'); } finally { setBusy(false); }
  }
  return <div className="settings-panel booking-panel"><h3>Local payment cards</h3><p>Encrypted on this device using operating-system secure storage. Card details are excluded from TIXBAM cloud requests. CVV is entered separately for each run.</p>
    {!available && <p role="status">{window.tixbam ? 'Secure storage unavailable. Card saving is disabled.' : 'Card saving is available in the desktop app.'}</p>}
    {cards.map(card => <div className="settings-inline" key={card.id}><span>{card.label} · •••• {card.last4} · {card.expiryMonth}/{card.expiryYear}</span><button type="button" className="button button-outline" disabled={busy} onClick={() => remove(card.id)}>Remove</button></div>)}
    {!adding && <button type="button" className="button button-outline" disabled={!available || busy} onClick={() => setAdding(true)}>Add local card</button>}
    {adding && <form onSubmit={save} autoComplete="off">
      <label>Nickname<input required maxLength={60} value={input.label} onChange={e => setInput({...input,label:e.target.value})}/></label>
      <label>Name on card<input required maxLength={100} autoComplete="off" value={input.name} onChange={e => setInput({...input,name:e.target.value})}/></label>
      <label>Card number<input required type="password" inputMode="numeric" autoComplete="off" maxLength={23} value={input.number} onChange={e => setInput({...input,number:e.target.value})}/></label>
      <div className="form-row"><label>Expiry month<input required type="number" min={1} max={12} value={input.expiryMonth} onChange={e => setInput({...input,expiryMonth:Number(e.target.value)})}/></label><label>Expiry year<input required type="number" min={new Date().getFullYear()} value={input.expiryYear} onChange={e => setInput({...input,expiryYear:Number(e.target.value)})}/></label></div>
      <div className="booking-actions"><button className="button button-primary" disabled={busy}>Save encrypted card</button><button type="button" className="button button-outline" disabled={busy} onClick={() => { setAdding(false); setInput(blank()); }}>Cancel</button></div>
    </form>}
    {error && <p className="form-error" role="alert">{tx(error)}</p>}
  </div>;
}
