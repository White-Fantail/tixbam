'use strict';
/** AB-12. Host-reviewed, data-only profile and offline contract verifier.
 * Do not import/run JS from downloaded provider packages. This file
 * NEVER grants live mutations or payment authority.
 */
const crypto=require('node:crypto');
const catalog=require('../../addons/catalog.json');
const {profiles}=require('./provider-profiles.json');
const ACTIONS=new Set(['OBSERVE','SELECT_PERFORMANCE','SELECT_PRICE_TIER',
  'LIST_OFFERS','SELECT_OFFER','READ_ORDER','PREPARE_CHECKOUT','VERIFY_ORDER',
  'PAYMENT_EXECUTOR']);
const SUITES=Object.freeze({'observe-v1':['OBSERVE','LIST_OFFERS','READ_ORDER'],
  'options-v1':['SELECT_PERFORMANCE','SELECT_PRICE_TIER'],
  'seats-v1':['SELECT_OFFER'],'checkout-v1':['PREPARE_CHECKOUT','VERIFY_ORDER'],
  'payment-mock-v1':['PAYMENT_EXECUTOR']});
const deny=(reason)=>Object.freeze({eligible:false,liveAllowed:false,reason});
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null);
const safeId=x=>typeof x==='string'&&x.length>0&&x.length<=160&&
  !/[<>"'\r\n?#/&\\]/.test(x);
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function hostMatches(host,roots){
  return roots.some(root=>host===root||host.endsWith('.'+root));
}
function urlScope(profile,url,eventId){
  try{
    const u=new URL(url);
    if(u.protocol!=='https:'||u.username||u.password||u.port&&!['443'].includes(u.port)||
       !hostMatches(u.hostname.toLowerCase(),profile.hosts)||u.hash||
       !u.pathname.endsWith(profile.routeSuffix)||!safeId(eventId)||
       u.searchParams.getAll(profile.eventQueryParam).length!==1||
       u.searchParams.get(profile.eventQueryParam)!==eventId)
      return false;
    // Reject extra tracking/redirect params: a booking form identity is exact.
    return [...u.searchParams.keys()].every(k=>k===profile.eventQueryParam);
  }catch{return false;}
}
/** Bundled manifest is cross-checked with independently bundled catalog. */
function localProfile(providerId,addonVersion){
  const entry=catalog.find(x=>x.id===providerId);
  const p=profiles.find(x=>x.providerId===providerId);
  if(!entry||!p||entry.kind!=='ticketing'||entry.version!==addonVersion||
     p.addonVersion!==addonVersion||p.schemaVersion!==1||p.kind!=='ticketing'||
     entry.country!==p.country||entry.booking?.adapter!==p.profileId||
     !Array.isArray(p.hosts)||p.hosts.length===0||
     p.hosts.some(x=>!entry.allowedHosts.includes(x))||
     !p.routeSuffix.startsWith('/')||!safeId(p.eventQueryParam)||
     !plain(p.capabilities)||!plain(p.fixtureSuites)||!safeId(p.profileId))return null;
  for(const [cap,status] of Object.entries(p.capabilities)){
    if(!ACTIONS.has(cap)||!['verified','pending','disabled'].includes(status))
      return null;
    if(status==='verified'&&(!p.fixtureSuites[cap]||
       !SUITES[p.fixtureSuites[cap]]?.includes(cap)))return null;
  }
  // The profile is a bundled REVIEWED data description; a network-supplied
  // copy of identical fields does not count as trusted host code.
  return Object.freeze({...p,profileSha256:digest(p)});
}
/** Equivalent of an offline conformance fixture. No browser, remote HTTP,
 * HTML eval, payment, or add-on JS execution is available in this harness.
 */
function verifyOfflineFixture({profile,addonVersion,capability,fixture}={}){
  const trusted=plain(profile)?localProfile(profile.providerId,addonVersion):null;
  // Never trust a caller-supplied hash paired with edited capability data:
  // the profile must be byte-for-byte equivalent to the bundled host copy.
  if(!trusted||JSON.stringify(profile)!==JSON.stringify(trusted))
    return deny('unreviewed_profile');
  if(!ACTIONS.has(capability)||profile.capabilities[capability]!=='verified')
    return deny('capability_unverified');
  if(!plain(fixture)||Object.keys(fixture).some(k=>![
    'schemaVersion','sandbox','url','eventId','stage','providerId',
    'capability','fixtureSuite','observedEventId','challenge'
  ].includes(k))||fixture.schemaVersion!==1||fixture.sandbox!==true||
     fixture.capability!==capability||fixture.providerId!==profile.providerId||
     fixture.fixtureSuite!==profile.fixtureSuites[capability]||
     !urlScope(profile,fixture.url,fixture.eventId)||
     fixture.observedEventId!==fixture.eventId||
     !['options','offers','payment'].includes(fixture.stage)||
     fixture.challenge!=='none')
    return deny('fixture_failed');
  if(capability==='OBSERVE'&&fixture.stage!=='options'||
     ['SELECT_PRICE_TIER','SELECT_PERFORMANCE'].includes(capability)&&
     fixture.stage!=='options')
    return deny('wrong_stage');
  return Object.freeze({eligible:true,liveAllowed:false,
    reason:'offline_fixture_passed',fixtureSha256:digest({
      profileSha256:profile.profileSha256,capability,fixture
    }),profileSha256:profile.profileSha256});
}
/** Separate verifications are required per capability+country+version. Neither
 * a passing fixture nor a server 'permitted' flag can enable live automation.
 */
function assessRuntime({providerId,addonVersion,country,capability,url,eventId,
  verification,policy,killSwitch=true}={}){
  const p=localProfile(providerId,addonVersion);
  if(!p)return deny('unknown_or_upgraded_addon');
  if(p.country!==country)return deny('wrong_country');
  if(!ACTIONS.has(capability)||p.capabilities[capability]!=='verified')
    return deny('implementation_pending');
  if(!urlScope(p,url,eventId))return deny('origin_or_event_mismatch');
  if(killSwitch)return deny('global_kill_switch');
  if(!plain(verification)||verification.state!=='fixture_verified'||
     verification.capability!==capability||verification.country!==country||
     verification.profileId!==p.profileId||verification.addonVersion!==p.addonVersion||
     !hex(verification.fixtureSha256)||verification.hostPermission!==false||
     verification.liveExecution!==false)
    return deny('missing_verified_fixture');
  if(!plain(policy)||policy.capability!==capability||
     policy.country!==country||policy.permissionState!=='permitted'||
     policy.permitted!==true)
    return deny('provider_permission_missing');
  // Fail closed until separate AB-13/15 release and real provider integrations.
  return deny('live_release_unavailable');
}
module.exports={SUITES,localProfile,urlScope,verifyOfflineFixture,assessRuntime,digest};
