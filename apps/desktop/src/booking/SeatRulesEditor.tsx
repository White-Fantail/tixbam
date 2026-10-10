import { useState } from "react";
import type { SeatRestrictionConsentV2 } from "../../../../packages/addon-sdk";
import { EMPTY_SEAT_SELECTIONS, type SeatPreferenceSelections } from "../booking-plans";
import { tx } from "../i18n";

/** Local draft preserves the newline/caret while emitting valid IDs. */
function RankedLines({ids,onChange,label,max=30}:{ids:string[];onChange:(ids:string[])=>void;label:string;max?:number}){
  const [raw,setRaw]=useState(ids.join("\n"));
  return <textarea aria-label={tx(label)} rows={3} maxLength={3000}
    value={raw} onChange={e=>{
      const next=e.target.value;setRaw(next);
      onChange([...new Set(next.split("\n").map(s=>s.trim()).filter(Boolean))].slice(0,max));
    }}/>;
}
/** Data-only controlled inputs, no provider or payment-side effects. */
export function SeatRulesEditor({
  selections, terms, onSelections, onTerms, disabled=false, showRanking=true
}:{
  selections?: SeatPreferenceSelections;
  terms?: SeatRestrictionConsentV2;
  onSelections:(next:SeatPreferenceSelections)=>void;
  onTerms:(next:SeatRestrictionConsentV2)=>void;
  disabled?:boolean;showRanking?:boolean;
}){
  const current=selections||EMPTY_SEAT_SELECTIONS;
  const t=terms||{};
  const ranked=["priceTier","section","floor"] as const;
  const labels={
    priceTier:"Price tier priority (one per line)",
    section:"Section priority (one per line)",
    floor:"Floor priority (one per line)"
  };

  return <fieldset className="seat-rules-editor" disabled={disabled} aria-label={tx("Seat and purchase restrictions")}>
    <legend>{tx("Seat and purchase restrictions")}</legend>
    <p className="seat-rules-hint">{tx("These are hard limits, not AI suggestions. Unspecified permissions are denied.")}</p>
    {showRanking&&<div className="seat-priority-grid">{ranked.map(key=>
      <label key={key}>{tx(labels[key])}
        <RankedLines ids={current[key]||[]} label={labels[key]}
          onChange={ids=>onSelections({...current,[key]:ids})}/>
      </label>)}</div>}
    <div className="form-row">
      <label>{tx("Seat allocation type")}
        <select value={current.seatMode||""} onChange={e=>onSelections({...current,
          seatMode:e.target.value as SeatPreferenceSelections["seatMode"]})}>
          <option value="">{tx("No seat mode preference")}</option>
          <option value="assigned">{tx("Assigned numbered seats")}</option>
          <option value="standing">{tx("Standing / GA zone")}</option>
          <option value="automatic">{tx("Provider-allocated seats")}</option>
        </select>
      </label>
      <label>{tx("Ticket delivery preference")}
        <select value={["","eticket","pickup","delivery"].includes(current.fulfillment||"")?
          (current.fulfillment||""):""} onChange={e=>onSelections({...current,fulfillment:e.target.value})}>
          <option value="">{tx("Any verified delivery method")}</option>
          <option value="eticket">{tx("E-ticket")}</option>
          <option value="pickup">{tx("Box office pickup")}</option>
          <option value="delivery">{tx("Physical delivery")}</option>
        </select>
      </label>
    </div>
    <p className="seat-rules-hint">{tx("Standing is grouped by GA area, not seat numbers. Automatic allocation requires verified seats before checkout.")}</p>
    <strong className="seat-rules-label">{tx("Separate explicit permissions")}</strong>
    <div className="seat-rules-consents">
      {([
        ["allowRestrictedView","Allow restricted or obstructed view seats"],
        ["allowRealName","Accept real-name ticketing requirements"],
        ["allowAgeRestricted","Accept age-restricted ticket conditions"],
        ["allowAccessibilityRestricted","Accept accessibility-restricted ticket conditions"]
      ] as const).map(([key,label])=>
        <label key={key} className="seat-rule-check">
          <input type="checkbox" checked={t[key]===true}
            onChange={e=>onTerms({...t,[key]:e.target.checked})}/>
          {tx(label)}
        </label>)}
    </div>
    <label className="seat-rules-extras">{tx("Approved optional extra IDs (one per line)")}
      <RankedLines ids={t.allowedExtraIds||[]}
        label="Approved optional extra IDs (one per line)" max={20}
        onChange={allowedExtraIds=>onTerms({...t,allowedExtraIds})}/>
    </label>
    <p className="seat-rules-hint">{tx("Leave extra IDs empty to reject insurance, subscriptions and unrequested products. A permission is never checked automatically.")}</p>
  </fieldset>;
}
