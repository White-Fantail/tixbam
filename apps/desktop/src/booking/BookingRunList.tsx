import { useEffect, useState } from 'react';
import { tx } from '../i18n';
import type { BookingRun } from '../../../../packages/addon-sdk';
import { RunAIAdvisor } from './RunAIAdvisor';
export function BookingRunList() {
  const [runs,setRuns]=useState<BookingRun[]>([]), [error,setError]=useState(''), [busy,setBusy]=useState('');
  useEffect(()=> { let mounted=true; window.tixbam?.listBookings().then(rs=> {if(mounted)setRuns(rs);}).catch(()=>setError('Could not load booking runs.'));
    const off=window.tixbam?.onBookingChanged(run=> {if(mounted)setRuns(rs=>[...rs.filter(r=>r.id!==run.id),run]);}); return ()=> {mounted=false;off?.();}; },[]);
  async function control(run: BookingRun, stop=false) {
    if(!window.tixbam)return; setBusy(run.id);setError('');
    try {const next=stop?await window.tixbam.stopBooking(run.id):await window.tixbam.resumeBooking(run.id,run.status==='review');setRuns(rs=>rs.map(r=>r.id===next.id?next:r));}catch {setError('Could not update this run.');}finally{setBusy('');}
  }
  if(!runs.length)return null;
  return <div className="settings-panel booking-panel"><h3>Booking runs</h3>{runs.map(run=><div className="booking-run" key={run.id}><strong>{run.rehearsal?'REHEARSAL · ':''}{tx(run.status.replaceAll('_',' ').toUpperCase())}</strong><p>{tx(run.message)}</p>{run.status==='review'&&run.order&&<p>{run.order.quantity} ticket(s) · {run.order.currency} {(run.order.totalMinor / (["KRW","JPY","VND"].includes(run.order.currency) ? 1 : 100)).toFixed(["KRW","JPY","VND"].includes(run.order.currency) ? 0 : 2)} including fees · {run.order.seats.join(', ')}</p>}<RunAIAdvisor run={run}/><div className="booking-actions">{['awaiting_user','review'].includes(run.status)&&<button className="button button-primary" disabled={busy===run.id} onClick={()=>control(run)}>{run.status==='review'?'Confirm order and pay':'Resume'}</button>}{!['completed','stopped','failed','payment_unknown'].includes(run.status)&&<button className="button button-outline" disabled={busy===run.id} onClick={()=>control(run,true)}>Stop</button>}{run.windowId&&<button className="button button-outline" onClick={()=>window.tixbam?.focusWindow(run.windowId!)}>Open provider window</button>}</div></div>)}{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
