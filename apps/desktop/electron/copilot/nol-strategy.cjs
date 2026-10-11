'use strict';
/**
 * NOL-03: deterministic, conservative *decision support* for one ticket.
 * Screenshots / model-supplied attributes are untrusted observations, not
 * official availability, provider authorization, or seat-hold evidence.
 * NOL-04 must separately verify an actual provider offer before auto-selection.
 */
const KINDS=new Set(['seat','price_tier','quantity','performance','continue']);
const TIERS=new Set(['assigned','standing','automatic','']);
const SAFE_TEXT=/^[^<>\r\n]{1,90}$/;
function safeName(v){return typeof v==='string' && SAFE_TEXT.test(v) ? v.trim() : '';}
function names(value){
  if(!Array.isArray(value))return [];
  return value.slice(0,12).map(safeName).filter(Boolean);
}
function normalizePlan(input){
  if(!input || input.version!==1)return null;
  const s=input.seatPreferences||{};
  return Object.freeze({
    version:1,quantity:input.quantity,currency:input.currency,
    budgetMinor:input.budgetMinor,
    performanceId:safeName(input.performanceId)||null,
    allowFallback:input.allowFallback===true,
    seatPreferences:Object.freeze({
      priceTier:Object.freeze(names(s.priceTier)),
      section:Object.freeze(names(s.section)),
      floor:Object.freeze(names(s.floor)),
      seatMode:TIERS.has(s.seatMode)?s.seatMode:'',
    }),
  });
}
function key(s){return s.trim().toLocaleLowerCase().replace(/\s+/g,' ');}
function matchPreference(value,preferences){
  if(!preferences.length)return {matched:true,rank:0,known:true};
  if(!value)return {matched:false,rank:preferences.length,known:false};
  const i=preferences.findIndex(x=>key(x)===key(value));
  return {matched:i>=0,rank:i>=0?i:preferences.length,known:true};
}
function rateCandidate(plan,candidate){
  if(!plan)return {status:'not_configured',reason:'NOL strategy not configured.',rank:9999};
  if(plan.quantity!==1 || plan.currency!=='KRW' ||
     !Number.isSafeInteger(plan.budgetMinor) || plan.budgetMinor<=0)
    return {status:'needs_user',reason:'One KRW ticket and a positive total budget are required.',rank:9999};
  if(!candidate || !KINDS.has(candidate.kind) ||
     typeof candidate.label!=='string' || !safeName(candidate.label))
    return {status:'reject',reason:'Unrecognized visual candidate.',rank:9999};
  if(typeof candidate.confidence!=='number' || candidate.confidence<.95 ||
     candidate.confidence>1)return {status:'reject',reason:'Insufficient visual confidence.',rank:9999};
  const offer=candidate.offer&&typeof candidate.offer==='object'&&!Array.isArray(candidate.offer)?
    candidate.offer:{};
  const availability=offer.availability;
  if(availability==='unavailable')
    return {status:'reject',reason:'The displayed option is unavailable.',rank:9999};
  if(offer.quantity!==undefined && offer.quantity!==1)
    return {status:'reject',reason:'Displayed quantity differs from one.',rank:9999};
  if(offer.currency && offer.currency!=='KRW')
    return {status:'reject',reason:'Displayed currency is not KRW.',rank:9999};
  if(plan.performanceId && candidate.kind==='performance' &&
     (!safeName(offer.performanceId) || offer.performanceId!==plan.performanceId))
    return {status:'needs_user',reason:'The selected performance identity is not verified.',rank:9999};
  if(plan.performanceId && safeName(offer.performanceId) &&
     offer.performanceId!==plan.performanceId)
    return {status:'reject',reason:'Candidate belongs to a different performance.',rank:9999};
  let rank=0,usedFallback=false,unverified=[];
  for(const [field,weight] of [['priceTier',100],['section',20],['floor',4]]){
    const prefs=plan.seatPreferences[field];
    const found=matchPreference(safeName(offer[field]),prefs);
    if(prefs.length){
      if(!found.known){
        unverified.push(field);
        rank+=weight*(prefs.length+2);
      }else if(!found.matched){
        if(!plan.allowFallback)
          return {status:'reject',reason:'The '+field+' is outside approved selections.',rank:9999};
        usedFallback=true;rank+=weight*(prefs.length+1);
      }else rank+=weight*found.rank;
    }
  }
  const seatMode=plan.seatPreferences.seatMode;
  if(seatMode && offer.seatMode && offer.seatMode!==seatMode){
    if(!plan.allowFallback)
      return {status:'reject',reason:'The seat mode is outside approved selections.',rank:9999};
    usedFallback=true;rank+=1000;
  }else if(seatMode && !offer.seatMode)unverified.push('seatMode');
  const price=offer.allInTotalMinor;
  const feeComplete=offer.feesIncluded===true;
  if(price!==undefined){
    if(!Number.isSafeInteger(price) || price<0)
      return {status:'reject',reason:'Invalid displayed price.',rank:9999};
    // Even the displayed base amount being above budget rules out a safe offer.
    if(price>plan.budgetMinor)
      return {status:'reject',reason:'Displayed all-in price is above the budget.',rank:9999};
  }
  // A model's numeric price/fee claim is not evidence from an authorized
  // provider adapter. No autonomous NOL-03 offer selection on this basis.
  if(price===undefined || !feeComplete)unverified.push('allInPrice');
  if(offer.quantity===undefined)unverified.push('quantity');
  if(plan.performanceId && !safeName(offer.performanceId))
    unverified.push('performanceId');
  const status=unverified.length || candidate.kind!=='continue'?
    'needs_user':'advisory';
  return {status,reason:unverified.length
      ? 'Verify '+[...new Set(unverified)].join(', ')+' on the official page.'
      : 'Visible candidate only; a provider offer/hold is not verified.',
    rank,usedFallback,unverified:[...new Set(unverified)],
    holdVerified:false,actionAuthorized:false};
}
function planChoices(plan,candidates){
  if(!plan)return {status:'not_configured',reason:'NOL strategy not enabled.',
    recommended:[],rejected:0,holdVerified:false,actionAuthorized:false};
  if(plan.quantity!==1 || plan.currency!=='KRW' ||
     !Number.isSafeInteger(plan.budgetMinor) || plan.budgetMinor<=0)
    return {status:'needs_user',reason:'Set exactly one KRW ticket and a positive total budget before selection.',
      recommended:[],rejected:0,holdVerified:false,actionAuthorized:false};
  const proposed=(Array.isArray(candidates)?candidates:[]).slice(0,5);
  const rated=proposed.map((candidate,i)=>({candidate,index:i,assessment:rateCandidate(plan,candidate)}));
  const possible=rated.filter(x=>!['reject','not_configured'].includes(x.assessment.status))
    .sort((a,b)=>a.assessment.rank-b.assessment.rank || b.candidate.confidence-a.candidate.confidence ||
      a.index-b.index);
  const ready=possible.filter(x=>x.assessment.status!=='needs_user');
  return {status:possible.length?'review':'no_eligible_offer',
    reason:possible.length
      ? 'Ranked visible candidates. Verify price, performance and availability on the official page.'
      : 'No approved visual candidate. Keep the provider window open for manual inspection.',
    recommended:possible.map(x=>({
      kind:x.candidate.kind,label:x.candidate.label,rank:x.assessment.rank,
      reason:x.assessment.reason,usedFallback:x.assessment.usedFallback||false,
      requiresUser:x.assessment.status==='needs_user',
      apparentTotalMinor:Number.isSafeInteger(x.candidate.offer?.allInTotalMinor)
        ? x.candidate.offer.allInTotalMinor:null,
      feesShownIncluded:x.candidate.offer?.feesIncluded===true,
    })),
    rejected:rated.length-possible.length,readyCount:ready.length,
    holdVerified:false,actionAuthorized:false};
}
function recoveryAdvice({plan,stage,previousAction,attempts=0}={}){
  if(!plan || plan.version!==1)return {action:'ASK_USER',reason:'No NOL strategy.'};
  if(!['seat_conflict','sold_out'].includes(stage))
    return {action:'WAIT',reason:'No confirmed recoverable seat error.'};
  if(attempts>=2)return {action:'ASK_USER',reason:'Seat conflict limit reached.'};
  if(previousAction==='continue')
    return {action:'ASK_USER',reason:'Never retry a possible cart/hold operation.'};
  if(!plan.allowFallback)
    return {action:'ASK_USER',reason:'User has not approved alternative seats or sections.'};
  return {action:'REOBSERVE_WITH_USER',reason:
    'Conflict/sold-out visible. Review another permitted candidate after user confirmation; do not repeat the same seat.',
    autoRetry:false,holdVerified:false};
}
module.exports={normalizePlan,rateCandidate,planChoices,recoveryAdvice};
