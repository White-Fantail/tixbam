'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {localProfile,urlScope,verifyOfflineFixture,assessRuntime,SUITES}=require('./booking/provider-runtime.cjs');
const {localReview,evaluateEffectiveCapability}=require('./booking/capability-policy.cjs');
const id='7313',url='https://www.cityline.com.hk/en_US/eventDetail?event='+id;
function fixture(capability='OBSERVE',urlOverride=url){
  return {schemaVersion:1,sandbox:true,url:urlOverride,eventId:id,
    observedEventId:id,providerId:'cityline',capability,
    stage:'options',challenge:'none',
    fixtureSuite:capability==='OBSERVE'?'observe-v1':'options-v1'};
}
const profile=localProfile('cityline','1.1.0');
test('only reviewed bundled addon version and matching profile are trusted',()=>{
  assert.ok(profile);
  assert.equal(profile.profileId,'cityline-event-detail-v1');
  assert.match(profile.profileSha256,/^[0-9a-f]{64}$/);
  assert.equal(profile.capabilities.PAYMENT_EXECUTOR,'disabled');
  assert.equal(profile.capabilities.SELECT_OFFER,'pending');
  assert.equal(localProfile('cityline','1.1.1'),null);
  assert.equal(localProfile('cityline','0.0.0'),null);
  assert.equal(localProfile('nol','1.0.1'),null);
  assert.equal(localProfile('ticketmaster','1.0.1'),null);
  assert.equal(localProfile('livenation','1.0.0'),null);
  assert.equal(localProfile('__proto__','1.0.0'),null);
  assert.equal(localReview('cityline','1.1.0').profileId,profile.profileId);
});
test('offline fixture passes without touching any live provider or payment',()=>{
  const result=verifyOfflineFixture({profile,addonVersion:'1.1.0',
    capability:'OBSERVE',fixture:fixture()});
  assert.equal(result.eligible,true);
  assert.equal(result.liveAllowed,false);
  assert.match(result.fixtureSha256,/^[0-9a-f]{64}$/);
  for(const action of ['SELECT_PERFORMANCE','SELECT_PRICE_TIER']){
    const f=fixture(action);
    const tested=verifyOfflineFixture({profile,addonVersion:'1.1.0',capability:action,fixture:f});
    assert.equal(tested.eligible,true,action);
    assert.equal(tested.liveAllowed,false);
  }
  assert.equal(SUITES['payment-mock-v1'].includes('PAYMENT_EXECUTOR'),true);
  const denied=verifyOfflineFixture({profile,addonVersion:'1.1.0',
    capability:'PAYMENT_EXECUTOR',fixture:fixture('PAYMENT_EXECUTOR')});
  assert.equal(denied.eligible,false);
  assert.equal(denied.reason,'capability_unverified');
});
test('fixture is data-only: ignore prompt injection, raw HTML, arbitrary command and fake challenges',()=>{
  for(const patch of [
    {sandbox:false},{schemaVersion:2},{command:'window.location="https://evil.example"'},
    {runJavascript:'alert(1)'},{challenge:'captcha'},{observedEventId:'other'},
    {eventId:'other'},{fixtureSuite:'payment-mock-v1'},
    {stage:'checkout'},{providerId:'other'},{capability:'SELECT_OFFER'},
  ]){
    const attempt=verifyOfflineFixture({profile,addonVersion:'1.1.0',
      capability:'OBSERVE',fixture:{...fixture(),...patch}});
    assert.equal(attempt.eligible,false,JSON.stringify(patch));
  }
  assert.equal(verifyOfflineFixture({profile,addonVersion:'9.9.9',
    capability:'OBSERVE',fixture:fixture()}).eligible,false);
});
test('HTTPS host/route/event binding refuses phishing, promoter links, duplicate ids and redirects',()=>{
  assert.equal(urlScope(profile,url,id),true);
  const bad=[
    'http://www.cityline.com.hk/en_US/eventDetail?event=7313',
    'https://cityline.com.hk.evil.example/en_US/eventDetail?event=7313',
    'https://evil-cityline.com.hk.attacker.org/en_US/eventDetail?event=7313',
    'https://user:pass@www.cityline.com.hk/en_US/eventDetail?event=7313',
    'https://www.livenation.hk/en_US/eventDetail?event=7313',
    'https://www.cityline.com.hk/en_US/login?event=7313',
    'https://www.cityline.com.hk/en_US/eventDetail?event=7313&event=7313',
    'https://www.cityline.com.hk/en_US/eventDetail?event=7313&redirect=https://evil.test',
    'https://www.cityline.com.hk/en_US/eventDetail?event=42',
    'https://www.cityline.com.hk/en_US/eventDetail?event=7313#checkout',
    'javascript:alert(1)',
  ];
  for(const v of bad)assert.equal(urlScope(profile,v,id),false,v);
  assert.equal(urlScope(profile,url,'7313<script>'),false);
  assert.equal(urlScope(profile,url,'42'),false);
});
test('server permission updates do not grant live actions; revocation and version drift deny',()=>{
  const claim={state:'fixture_verified',capability:'OBSERVE',
    country:'HK',profileId:profile.profileId,addonVersion:'1.1.0',
    fixtureSha256:'f'.repeat(64),hostPermission:false,liveExecution:false};
  const policy={capability:'OBSERVE',country:'HK',permissionState:'permitted',permitted:true};
  const scope={providerId:'cityline',addonVersion:'1.1.0',
    country:'HK',capability:'OBSERVE',url,eventId:id,
    verification:claim,policy,killSwitch:false};
  assert.deepEqual(assessRuntime(scope),{
    eligible:false,liveAllowed:false,reason:'live_release_unavailable'});
  for(const [patch,reason] of [
    [{country:'TW'},'wrong_country'],
    [{addonVersion:'1.2.0'},'unknown_or_upgraded_addon'],
    [{verification:{...claim,state:'revoked'}},'missing_verified_fixture'],
    [{verification:{...claim,hostPermission:true}},'missing_verified_fixture'],
    [{verification:{...claim,addonVersion:'0.9.0'}},'missing_verified_fixture'],
    [{policy:{...policy,permissionState:'revoked',permitted:false}},'provider_permission_missing'],
    [{killSwitch:true},'global_kill_switch'],
    [{url:'https://www.livenation.hk/en_US/eventDetail?event=7313'},'origin_or_event_mismatch'],
  ]){
    assert.equal(assessRuntime({...scope,...patch}).reason,reason);
  }
  assert.equal(assessRuntime({...scope,capability:'PAYMENT_EXECUTOR'}).reason,'implementation_pending');
  assert.equal(assessRuntime({...scope,capability:'SELECT_OFFER'}).reason,'implementation_pending');
  assert.equal(assessRuntime({...scope,capability:'EVAL_JS'}).reason,'implementation_pending');
  assert.equal(evaluateEffectiveCapability({
    providerId:'cityline',addonVersion:'1.1.0',country:'HK',
    capability:'OBSERVE',released:true,
    server:{schemaVersion:1,globalKillSwitch:false,items:[{
      providerId:'cityline',country:'HK',published:true,
      ticketAgentRequired:false,autonomousCheckoutAvailable:true,
      policies:[policy]}]},
    consent:{providerId:'cityline',addonVersion:'1.1.0',country:'HK',
      capability:'OBSERVE',expiresAtMs:Date.now()+100000}
  }).allowed,false);
});
test('tampered caller profile cannot make a pending seat or disabled payment capability appear reviewed',()=>{
  const fake={...profile,capabilities:{...profile.capabilities,
    SELECT_OFFER:'verified',PAYMENT_EXECUTOR:'verified'}};
  const result=verifyOfflineFixture({profile:fake,addonVersion:'1.1.0',
    capability:'SELECT_OFFER',fixture:fixture('SELECT_OFFER')});
  assert.equal(result.eligible,false);
  assert.equal(result.reason,'unreviewed_profile');
});
test('unknown fixture suite never registers its action even when data looks valid',()=>{
  assert.equal(SUITES['magic-payment-v1'],undefined);
  for(const cap of ['SELECT_OFFER','PAYMENT_EXECUTOR','VERIFY_ORDER']){
    const test=verifyOfflineFixture({profile,addonVersion:'1.1.0',
      capability:cap,fixture:{...fixture(),capability:cap,
        fixtureSuite:cap==='PAYMENT_EXECUTOR'?'payment-mock-v1':'seats-v1'}});
    assert.equal(test.eligible,false,cap);
  }
});
