import React, {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {LiveBookingWorkspace} from "../LiveBookingWorkspace";
import {type BookingPlan} from "../booking-plans";
import {type LivePhase, type TicketWindow, type TicketAddon} from "../types";
import addonCatalog from "../../addons/catalog.json";
import appCss from "../styles.css?inline";
import "../i18n";

// Load the same production stylesheet, but strip the third-party Google Fonts
// import: offline DOM tests must not even try to make an external request.
const style=document.createElement("style");
style.textContent=appCss.replace(/@import\s+url\(['"]https?:\/\/[^'"]+['"]\)\s*;/g,"");
document.head.appendChild(style);

// Actual production LiveBookingWorkspace and LiveCopilotPanel, never a
// counterfeit copy of their JSX. Browser, IPC and provider are *offline* mocks.
const plan:BookingPlan = {
  id:"nol-offline-ui-plan",artist:"Fixture Artist",title:"NOL TEST — NO TICKETS",
  city:"Seoul",providerId:"nol",
  bookingUrl:"https://nol.yanolja.com/product/offline-fixture",
  eventId:"offline-event",performanceId:"offline-performance",
  saleId:null,saleAt:"",performanceAt:"",timezone:"Asia/Seoul",
  quantity:1,budgetMinor:150000,currency:"KRW",
  requireTogether:false,allowFallback:true,
  seatPreferences:{priceTier:["R","S"],section:["Main","Balcony"],
    floor:["1F","2F"],seatMode:"assigned",fulfillment:""},
  preferencesReady:true,accountReady:true,paymentReady:false,
  terms:{},lastRehearsalAt:null,notes:"Only synthetic state",
  createdAt:"2026-10-01T00:00:00Z",updatedAt:"2026-10-01T00:00:00Z"
};
const addon = {...(addonCatalog.find(x=>x.id==="nol")||{}),
  installed:true} as TicketAddon;

function OfflineNolFixture(){
  const [phase,setPhase]=useState<LivePhase>("selecting");
  const [url,setUrl]=useState("https://nol.yanolja.com/product/offline-fixture");
  // Synthetic route changes, never a provider browser or real network call.
  useEffect(()=>{
    const change=(event:Event)=>{
      const next=(event as CustomEvent<string>).detail;
      if(typeof next==="string" &&
        ["nol.yanolja.com","accounts.yanolja.com"].includes(new URL(next).hostname))
        setUrl(next);
    };
    window.addEventListener("nol-ui-test:navigate",change);
    return()=>window.removeEventListener("nol-ui-test:navigate",change);
  },[]);
  const win:TicketWindow={
    id:42,providerId:"nol",planId:plan.id,
    phase,site:new URL(url).hostname,title:"NOL offline fixture",
    url,
    loading:false,popup:false,parentId:null,loadError:null,openedAt:Date.now(),
  };
  return <main data-testid="nol-ui-fixture">
    <LiveBookingWorkspace
      plans={[plan]} windows={[win]} addons={[addon]}
      history={[]} selectedPlanId={plan.id}
      onSelectPlan={()=>{}} onBackToPlan={()=>{}}
      onStart={async()=>{throw Error("Offline fixture must never start a provider browser");}}
      onFocus={async()=>{}} onClose={async()=>{}}
      onPhase={async(_id,next)=>{setPhase(next);}}
      onDismissHistory={async()=>{}} onTicketAgent={async()=>{}}
    />
  </main>;
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode><OfflineNolFixture/></React.StrictMode>
);
