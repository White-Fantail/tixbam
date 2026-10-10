import { useEffect, useState } from 'react';
import { tx } from '../i18n';

type Props = {
  phase?: string; rehearsal?: boolean; reservationVerified?: boolean;
  holdExpiresAtMs?: number | null;
};
export function ReservationNotice({phase,rehearsal,reservationVerified,holdExpiresAtMs}:Props) {
  const [now,setNow]=useState(Date.now);
  const visible=phase==='MANUAL_PAYMENT'||phase==='RESERVATION_UNKNOWN';
  useEffect(()=>{
    if(!visible||!reservationVerified||typeof holdExpiresAtMs!=='number')return;
    setNow(Date.now());
    if(holdExpiresAtMs<=Date.now())return;
    const timer=window.setInterval(()=>{
      const time=Date.now();setNow(time);
      if(time>=holdExpiresAtMs)window.clearInterval(timer);
    },1000);
    return ()=>window.clearInterval(timer);
  },[visible,reservationVerified,holdExpiresAtMs]);
  if(!visible)return null;
  const remaining=typeof holdExpiresAtMs==='number'?Math.max(0,Math.ceil((holdExpiresAtMs-now)/1000)):null;
  return <div className="rehearsal-note" role="note">
    {rehearsal ? <p>{tx('Synthetic seat hold only. No actual ticket is reserved.')}</p> : null}
    <p>{tx(!reservationVerified ? 'Seat hold is not verified. Check the same provider window before another attempt.' :
      remaining===0 ? 'The observed seat hold deadline has passed. Check the provider window; do not reserve again automatically.' :
      remaining===null ? 'Seat hold was verified, but its expiry time is unknown. Complete payment in the same provider window.' :
      'Seat hold was verified. Complete payment in the same provider window before the deadline.')}</p>
    {reservationVerified&&remaining!==null ? <p>{tx('Observed hold time remaining')}: {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</p> : null}
  </div>;
}
