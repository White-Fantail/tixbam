'use strict';
/**
 * Bounded, consent-scoped step executor. Provider automation permission and
 * user permission are INDEPENDENT. This module never loads remote scripts.
 * Successful input != a verified reservation.
 */
const {providerAutomationStatus,DEV_CLICK_KINDS} = require('./advance-authorization.cjs');
const MAX_AUTO_STEPS=6;
const MIN_CONFIDENCE=0.95;
const ENTRY_CONFIDENCE=0.97;
const DANGEROUS_TEXT=/(?:captcha|log.?in|sign.?in|queue|wait(?:ing)? room|password|otp|3ds|payment|pay now|checkout|complete purchase|confirm order|submit order|결제|인증|로그인|비밀번호|대기열|구매확정|주문확정)/i;

function actionPermission({session,entry,addon,target,developerEnabled,now=Date.now()}){
  if(!session || !entry || !target || !addon || session.stopped ||
     now>=session.expiresAt ||
     entry.planId!==session.planId || entry.providerId!==session.providerId ||
     entry.win?.id!==session.windowId ||
     !session.consent?.confirmed || !session.consent?.actions?.includes(target.kind) ||
     session.automaticClicks>=MAX_AUTO_STEPS ||
     typeof target.label!=='string' || DANGEROUS_TEXT.test(target.label) ||
     typeof target.reason!=='string' || DANGEROUS_TEXT.test(target.reason))
    return {allowed:false,reason:'Action not covered by advance consent or session limits.'};
  if(!Number.isFinite(target.confidence) || target.confidence<MIN_CONFIDENCE)
    return {allowed:false,reason:'Vision confidence is too low.'};
  if(entry.phase==='preparing'){
    if(target.kind!=='continue' || target.confidence<ENTRY_CONFIDENCE)
      return {allowed:false,reason:'Only a clearly identified booking-entry control is eligible during preparation.'};
  }else if(entry.phase!=='selecting' || !DEV_CLICK_KINDS.includes(target.kind)){
    return {allowed:false,reason:'User must handle this step; checkout and payment are never automatic.'};
  }
  if(session.mode==='dev_single_click' || session.mode==='dev_flow'){
    if(developerEnabled!==true || session.consent.developmentOverride!==true)
      return {allowed:false,reason:'Developer CLI and per-plan approval required.'};
    return {allowed:true,reason:'dev-diagnostic'};
  }
  if(session.mode!=='authorized')return {allowed:false,reason:'Visual guidance only.'};
  // A host-reviewed integration is required; no generic pixel executor is
  // granted normal commercial-site permissions by the model or UI.
  const permission=providerAutomationStatus(addon,target.kind);
  return permission.allowed?{allowed:true,reason:'authorized-provider'}:
    {allowed:false,reason:permission.reason};
}
function candidateKey(target,phase){
  return [phase,target.kind,
    Math.round(target.x*100),Math.round(target.y*100),
    target.label.trim().toLocaleLowerCase()].join(':');
}
function chooseStep(options,targets){
  if(!Array.isArray(targets))return {target:null,reason:'No candidate actions.'};
  for(const target of targets){
    const permission=actionPermission({...options,target});
    if(!permission.allowed)continue;
    const key=candidateKey(target,options.entry.phase);
    if(key===options.session.lastActionKey)
      return {target:null,reason:'The same button is still displayed. Verify progress manually; no repeat click.'};
    return {target,key,reason:permission.reason};
  }
  return {target:null,reason:'No sufficiently confident, approved non-payment action is visible.'};
}
module.exports={MAX_AUTO_STEPS,MIN_CONFIDENCE,ENTRY_CONFIDENCE,
  actionPermission,candidateKey,chooseStep};
