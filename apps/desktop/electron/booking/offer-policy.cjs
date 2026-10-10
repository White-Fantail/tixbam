'use strict';
/**
 * AB-10: provider-neutral, host-only seat/offer policy. All prices are in the
 * provider currency's ISO minor units. No FX conversion, external pricing,
 * suggested fees or model-origin overrides. Legacy v1 offers are supported
 * without weakening the stricter, opt-in v2 evidence.
 */
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const own=(o,k)=>Object.hasOwn(o,k);
const minor=x=>Number.isSafeInteger(x)&&x>=0;
const name=x=>typeof x==='string'&&x.length>0&&x.length<=160&&!/[<>]/.test(x);
const MODES=new Set(['assigned','standing','automatic']);
const BREAKDOWN=['ticketSubtotalMinor','serviceFeeMinor','taxMinor','deliveryFeeMinor','extrasMinor'];
const PRICES=['priceTier','section','floor'];
const TERMS=['restrictedView','realNameRequired','ageRestricted','accessibilityRestricted'];

function normalizeMode(x){
  if(x==='auto_allocated')return 'automatic';
  if(x==='reserved')return 'assigned';
  return x||'assigned';
}
function normalizedOffer(o){
  if(!isRecord(o)||!name(o.id)||!name(o.eventKey)||
     !Number.isSafeInteger(o.quantity)||o.quantity<1||o.quantity>20||
     !/^[A-Z]{3}$/.test(o.currency||'')||
     !Number.isSafeInteger(o.totalMinor)||o.totalMinor<=0||
     o.feesIncluded!==true||o.available!==true)return null;
  if(o.performance!==undefined&&!name(o.performance))return null;
  if(o.priceTier!==undefined&&!name(o.priceTier))return null;
  for(const key of ['providerId','section','floor','fulfillment','areaId']){
    if(o[key]!==undefined&&!name(o[key]))return null;
  }
  const mode=normalizeMode(o.seatMode??o.ticketMode);
  if(!MODES.has(mode))return null;
  if(o.seatMode!==undefined&&o.ticketMode!==undefined &&
     normalizeMode(o.seatMode)!==normalizeMode(o.ticketMode))return null;
  const seats=o.seats;
  if(!Array.isArray(seats)||seats.length>20||
     seats.some(x=>!name(x))||new Set(seats).size!==seats.length)return null;
  if(mode==='assigned'&&(seats.length!==o.quantity||o.adjacent!==true&&
     o.adjacent!==false&&o.adjacent!==undefined))return null;
  if(mode==='standing'&&(!name(o.areaId||o.section)||seats.length!==0&&seats.length!==o.quantity))
    return null;
  if(mode==='automatic'&&seats.length!==0&&seats.length!==o.quantity)return null;
  // A v2 schema cannot hide uncertain fees, restrictions or allocation in
  // omitted fields. Legacy v1 only means the all-in amount was observed.
  const strict=o.schemaVersion===2;
  if(o.schemaVersion!==undefined&&o.schemaVersion!==1&&o.schemaVersion!==2)return null;
  let feeBreakdown=null;
  if(o.feeBreakdown!==undefined||strict){
    if(!isRecord(o.feeBreakdown)||Reflect.ownKeys(o.feeBreakdown).length!==BREAKDOWN.length||
       BREAKDOWN.some(k=>!own(o.feeBreakdown,k)||!minor(o.feeBreakdown[k])))
      return null;
    const amounts=BREAKDOWN.map(k=>o.feeBreakdown[k]);
    const sum=amounts.reduce((a,b)=>a+b,0);
    if(!Number.isSafeInteger(sum)||sum!==o.totalMinor||
       o.feeBreakdown.ticketSubtotalMinor<=0)return null;
    feeBreakdown=Object.freeze(Object.fromEntries(BREAKDOWN.map(k=>[k,o.feeBreakdown[k]])));
  }
  const flags={};
  for(const term of TERMS){
    if(strict&&!own(o,term))return null;
    if(own(o,term)&&typeof o[term]!=='boolean')return null;
    flags[term]=o[term]??false;
  }
  if(o.maxPerOrder!==undefined&&(!Number.isInteger(o.maxPerOrder)||
     o.maxPerOrder<1||o.maxPerOrder>100))return null;
  if(o.verifiedAllocation!==undefined&&typeof o.verifiedAllocation!=='boolean')return null;
  if(strict&&mode==='automatic'&&o.verifiedAllocation===undefined)return null;
  const extras=o.extras??[];
  if(!Array.isArray(extras)||extras.length>20)return null;
  const extraIds=new Set(); let extraSum=0;
  for(const e of extras){
    if(!isRecord(e)||!name(e.id)||!minor(e.priceMinor)||e.selected!==true||
       extraIds.has(e.id))return null;
    extraIds.add(e.id);extraSum+=e.priceMinor;
  }
  if(!Number.isSafeInteger(extraSum))return null;
  if((strict||feeBreakdown)&&extraSum!==(feeBreakdown?.extrasMinor??0))return null;
  // Never accept a seller-controlled flag that declares price unknown.
  if(o.totalVerified===false||o.availabilityVerified===false||
     o.identityVerified===false)return null;
  if(strict&&(o.totalVerified!==true||o.availabilityVerified!==true||
     o.identityVerified!==true))return null;
  return Object.freeze({
    raw:o,id:o.id,eventKey:o.eventKey,providerId:o.providerId??null,
    performance:o.performance??null,priceTier:o.priceTier??null,
    section:o.section??null,floor:o.floor??null,
    seatMode:mode,areaId:o.areaId??o.section??null,
    fulfillment:o.fulfillment??null,seats:Object.freeze([...seats]),
    quantity:o.quantity,currency:o.currency,totalMinor:o.totalMinor,
    adjacent:o.adjacent===true,verifiedAllocation:o.verifiedAllocation===true,
    maxPerOrder:o.maxPerOrder??null,feeBreakdown,
    extras:Object.freeze(extras.map(e=>Object.freeze({id:e.id,priceMinor:e.priceMinor}))),
    strict,flags:Object.freeze(flags),
  });
}
function termsAllow(prefs){
  const t=prefs?.terms;
  if(t===undefined)return {allowRestrictedView:false,allowRealName:false,
    allowAgeRestricted:false,allowAccessibilityRestricted:false,allowedExtraIds:[]};
  if(!isRecord(t)||Object.keys(t).some(k=>!['allowRestrictedView','allowRealName',
    'allowAgeRestricted','allowAccessibilityRestricted','allowedExtraIds'].includes(k)))
    return null;
  for(const k of ['allowRestrictedView','allowRealName','allowAgeRestricted',
    'allowAccessibilityRestricted'])if(t[k]!==undefined&&typeof t[k]!=='boolean')return null;
  if(t.allowedExtraIds!==undefined&&(!Array.isArray(t.allowedExtraIds)||
     t.allowedExtraIds.length>20||new Set(t.allowedExtraIds).size!==t.allowedExtraIds.length||
     t.allowedExtraIds.some(x=>!name(x))))return null;
  return {allowRestrictedView:t.allowRestrictedView===true,
    allowRealName:t.allowRealName===true,allowAgeRestricted:t.allowAgeRestricted===true,
    allowAccessibilityRestricted:t.allowAccessibilityRestricted===true,
    allowedExtraIds:t.allowedExtraIds||[]};
}
function checkHard(candidate,prefs,{final=false,scope=null}={}){
  const c=normalizedOffer(candidate);
  if(!c||!isRecord(prefs)||!isRecord(prefs.options)||!Number.isSafeInteger(prefs.maxTotalMinor)||
     !Number.isInteger(prefs.quantity)||!/^[A-Z]{3}$/.test(prefs.currency||''))
    return {ok:false,code:'INVALID_OFFER'};
  if(c.quantity!==prefs.quantity||c.currency!==prefs.currency||
     c.totalMinor>prefs.maxTotalMinor)return {ok:false,code:'HARD_CONSTRAINT'};
  if(c.maxPerOrder!==null&&c.quantity>c.maxPerOrder)return {ok:false,code:'SALE_LIMIT'};
  if(scope){
    if(!isRecord(scope)||
       scope.eventKey&&c.eventKey!==scope.eventKey||
       scope.providerId&&c.providerId!==scope.providerId||
       scope.performance&&c.performance!==scope.performance)
      return {ok:false,code:'WRONG_EVENT'};
  }
  if(prefs.options.performance&&c.performance!==prefs.options.performance)
    return {ok:false,code:'WRONG_PERFORMANCE'};
  for(const k of PRICES){
    const ranked=prefs.options[k]||[];
    if(!Array.isArray(ranked)||new Set(ranked).size!==ranked.length||
       ranked.some(x=>!name(x)))return {ok:false,code:'INVALID_PREFERENCES'};
    if(ranked.length&&(!ranked.includes(c[k])||
       (prefs.allowFallback!==true&&c[k]!==ranked[0])))
      return {ok:false,code:'NOT_APPROVED'};
  }
  if(prefs.options.seatMode &&
     normalizeMode(prefs.options.seatMode)!==c.seatMode)
    return {ok:false,code:'SEAT_MODE'};
  if(prefs.options.fulfillment&&prefs.options.fulfillment!==c.fulfillment)
    return {ok:false,code:'DELIVERY'};
  // Assigned seats must be concrete and unique; one seat needs no adjacent
  // proof. Standing is same GA area, not numbered-seat adjacency. Automatic
  // allocation may have zero labels at offer time but never at final payment.
  if(c.seatMode==='assigned'&&prefs.requireTogether===true&&c.quantity>1&&
     !c.adjacent)return {ok:false,code:'NON_ADJACENT'};
  if(c.seatMode==='automatic'){
    if(prefs.requireTogether===true&&c.quantity>1&&
       (!c.verifiedAllocation||!c.adjacent))
      return {ok:false,code:'AUTO_ADJACENCY_UNKNOWN'};
    if(final&&(!c.verifiedAllocation||c.seats.length!==c.quantity))
      return {ok:false,code:'ALLOCATION_UNKNOWN'};
  }
  const terms=termsAllow(prefs);
  if(!terms)return {ok:false,code:'INVALID_PREFERENCES'};
  for(const [flag,key] of [
    ['restrictedView','allowRestrictedView'],['realNameRequired','allowRealName'],
    ['ageRestricted','allowAgeRestricted'],
    ['accessibilityRestricted','allowAccessibilityRestricted']
  ])if(c.flags[flag]&&!terms[key])return {ok:false,code:'CONSENT_REQUIRED'};
  if(c.extras.some(e=>!terms.allowedExtraIds.includes(e.id)))
    return {ok:false,code:'UNAPPROVED_EXTRA'};
  return {ok:true,code:'OK',offer:c};
}
function preferenceRank(offer,prefs){
  const ranks=PRICES.map(k=>{
    const arr=prefs.options[k]||[];
    return arr.length?arr.indexOf(offer[k]):-1;
  });
  const safe=x=>x===-1?0:x;
  return [...ranks.map(safe),offer.totalMinor,offer.id];
}
function compareRank(a,b,prefs){
  const x=preferenceRank(a,prefs),y=preferenceRank(b,prefs);
  for(let i=0;i<x.length;i++){
    const diff=typeof x[i]==='number'?x[i]-y[i]:x[i].localeCompare(y[i]);
    if(diff)return diff;
  }
  return 0;
}
function rankOffers(offers,prefs,scope){
  if(!Array.isArray(offers)||offers.length>100)return [];
  return offers.map(x=>({raw:x,check:checkHard(x,prefs,{scope})})).filter(x=>x.check.ok)
    .sort((x,y)=>compareRank(x.check.offer,y.check.offer,prefs)).map(x=>x.raw);
}
function canonicalOrderSignature(offer){
  const c=normalizedOffer({...offer,available:true});
  if(!c)return null;
  return JSON.stringify({
    id:c.id,eventKey:c.eventKey,providerId:c.providerId,
    performance:c.performance,priceTier:c.priceTier,
    section:c.section,floor:c.floor,seatMode:c.seatMode,
    areaId:c.areaId,fulfillment:c.fulfillment,
    seats:c.seats,adjacent:c.adjacent,verifiedAllocation:c.verifiedAllocation,
    quantity:c.quantity,currency:c.currency,totalMinor:c.totalMinor,
    maxPerOrder:c.maxPerOrder,feeBreakdown:c.feeBreakdown,
    extras:c.extras,flags:c.flags,strict:c.strict
  });
}
function verifyFinalOrder(order,prefs,expected,scope){
  const ok=checkHard({...order,available:true},prefs,{final:true,scope});
  if(!ok.ok)return {ok:false,code:ok.code};
  const original=checkHard({...expected,available:true},prefs,{scope});
  if(!original.ok)return {ok:false,code:'EXPECTED_OFFER_INVALID'};
  const current=canonicalOrderSignature(order);
  const previous=canonicalOrderSignature(expected);
  if(!current||!previous||current!==previous)return {ok:false,code:'FINAL_ORDER_CHANGED'};
  return {ok:true,code:'OK',order:ok.offer};
}
module.exports={normalizedOffer,checkHard,rankOffers,verifyFinalOrder,
  canonicalOrderSignature,normalizeMode,termsAllow};
