'use strict';
/**
 * Live Copilot advance authorization: local, short-lived and plan-scoped.
 * A fan's permission to click is NOT a ticket vendor's automation permission.
 */
const MODES=Object.freeze(['manual','observe','authorized']);
const KINDS=Object.freeze(['performance','price_tier','quantity','seat','continue']);
const MAX_AGE_MS=15*60*1000;
const MAX_ANALYSES=8;
const MIN_ANALYSIS_GAP_MS=2500;
const DEV_CLICK_KINDS=Object.freeze(['seat','price_tier','quantity','performance']);
const DEV_MIN_CONFIDENCE=0.95;
function normalizeConsent(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     !MODES.includes(input.mode))throw new Error('Invalid Copilot automation mode.');
  if(input.mode==='manual')return Object.freeze({mode:'manual',shareScreenshots:false,actions:Object.freeze([])});
  if(input.confirmed!==true || input.shareScreenshots!==true)
    throw new Error('Pre-session screen sharing consent is required for automatic analysis.');
  if(!Array.isArray(input.actions) || input.actions.length>5 ||
     !input.actions.every(x=>KINDS.includes(x)) || new Set(input.actions).size!==input.actions.length)
    throw new Error('Invalid advance-approved Copilot actions.');
  return Object.freeze({mode:input.mode,confirmed:true,shareScreenshots:true,
    actions:Object.freeze([...input.actions]),
    // A renderer-provided flag alone grants NOTHING; Electron's main process
    // must separately verify the unbundled, opt-in developer runtime.
    developmentOverride:input.developmentOverride===true});
}
/** The add-on catalog is static bundled code, NOT editable server metadata. */
function providerAutomationStatus(addon,kind){
  if(!addon || addon.kind!=='ticketing')return {allowed:false,reason:'Not a direct ticketing provider.'};
  if(addon.automation?.level2?.status!=='available')
    return {allowed:false,reason:'Provider has not authorized unattended booking interaction.'};
  if(addon.booking?.implementation?.seats!=='verified')
    return {allowed:false,reason:'Seat selection has no verified provider integration.'};
  if(addon.bookingAssistance?.mode==='manual')
    return {allowed:false,reason:'This add-on is manual-only.'};
  // The verified native action profile must be built and audited per provider.
  // A remote catalog switch or an AI-proposed x/y is not sufficient.
  if(addon.automation?.verifiedNativeExecutor!=='host-reviewed-v1' ||
     !Array.isArray(addon.automation?.verifiedActionKinds) ||
     !addon.automation.verifiedActionKinds.includes(kind))
    return {allowed:false,reason:'No verified host action executor for this step.'};
  return {allowed:true,reason:'verified'};
}
/**
 * Single native click test, never a general policy override. The explicit
 * developer runtime and per-session confirmation MUST both be present.
 * This is restricted to selection-stage, high-confidence non-checkout targets.
 */
function developerClickAllowed(runtimeEnabled,session,entry,target,now=Date.now()){
  if(runtimeEnabled!==true || !session || !entry || !target ||
     session.consent?.developmentOverride!==true ||
     session.consent?.confirmed!==true || session.consent?.shareScreenshots!==true ||
     session.mode!=='dev_single_click' ||
     session.stopped || session.automaticClicks!==0 || now>=session.expiresAt ||
     entry.phase!=='selecting' || entry.planId!==session.planId ||
     entry.providerId!==session.providerId || entry.win?.id!==session.windowId ||
     !DEV_CLICK_KINDS.includes(target.kind) ||
     !session.consent.actions.includes(target.kind) ||
     !Number.isFinite(target.confidence) || target.confidence<DEV_MIN_CONFIDENCE)
    return {allowed:false,reason:'Developer single-click test is not authorized for this target.'};
  return {allowed:true};
}
function canRun(session,entry,now=Date.now()){
  if(!session || !entry || entry.planId!==session.planId ||
     entry.providerId!==session.providerId ||
     entry.win?.id!==session.windowId || session.stopped ||
     now>=session.expiresAt)
    return {allowed:false,reason:'Session expired, stopped or window/plan changed.'};
  if(!['preparing','selecting'].includes(entry.phase))
    return {allowed:false,reason:'Waiting, queue, checkout and verification require user control.'};
  if(session.count>=MAX_ANALYSES)
    return {allowed:false,reason:'Automatic AI image-analysis limit reached.'};
  if(now-session.lastAttemptAt<MIN_ANALYSIS_GAP_MS)
    return {allowed:false,reason:'Automatic AI cooldown.'};
  return {allowed:true};
}
module.exports={MODES,KINDS,MAX_AGE_MS,MAX_ANALYSES,MIN_ANALYSIS_GAP_MS,
 DEV_CLICK_KINDS,DEV_MIN_CONFIDENCE,normalizeConsent,providerAutomationStatus,
 developerClickAllowed,canRun};
