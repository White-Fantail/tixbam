'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {NolSandboxProvider,NolSandboxJournal,NolSandboxExecutor,verifySandboxHold}=
  require('./copilot/nol-execution.cjs');

let now=1791740000000; // deterministic offline fixture clock
const clock=()=>now;
const scope=Object.freeze({providerId:'nol',accountId:'offline-account',
  planId:'offline-plan',eventId:'event-A',performanceId:'show-1',
  sessionId:'offline-window-session',windowId:13,generation:1});
const plan=Object.freeze({version:1,quantity:1,currency:'KRW',budgetMinor:150000,
  performanceId:'show-1',allowFallback:true,seatPreferences:{
    priceTier:['R','S'],section:['Main','Balcony'],floor:['1F'],
    seatMode:'assigned'}});
const seat=(id='R-01',patch={})=>({
  id,providerId:'nol',eventId:'event-A',performanceId:'show-1',
  label:'Seat '+id,quantity:1,currency:'KRW',priceTier:'R',section:'Main',
  floor:'1F',seatMode:'assigned',totalMinor:130000,feesIncluded:true,
  available:true,...patch});
function make({scenario={},offers=[seat()],journal=new NolSandboxJournal(),
  binding=scope,prefs=plan,check=()=>true}={}){
  const provider=new NolSandboxProvider({offers,scenario,clock});
  const runner=new NolSandboxExecutor({provider,plan:prefs,scope:binding,
    journal,assertOwner:check,clock});
  return {runner,provider,journal};
}
test('NOL-04 complete mocked one-ticket action requires separately observed provider hold',async()=>{
  now=1791740000000;
  const {runner,provider,journal}=make();
  const r=await runner.execute({offerId:'R-01'});
  assert.equal(r.status,'sandbox_hold_verified');
  assert.equal(r.mockHoldVerified,true);
  assert.equal(r.liveHoldVerified,false);
  assert.equal(r.paymentSubmitted,false);
  assert.equal(r.quantity,1);
  assert.equal(r.currency,'KRW');
  assert.equal(r.totalMinor,130000);
  assert.ok(r.holdExpiresAtMs>now);
  assert.equal(provider.submissions,1);
  assert.equal(journal.view(scope).status,'sandbox_hold_verified');
});

test('NOL-04 duplicate click or restarted executor does not re-submit a held seat',async()=>{
  now=1791740000000;
  const {runner,provider,journal}=make();
  assert.equal((await runner.execute({offerId:'R-01'})).status,'sandbox_hold_verified');
  assert.equal((await runner.execute({offerId:'R-01'})).retryBlocked,true);
  const next=new NolSandboxExecutor({provider,scope,plan,journal,clock});
  assert.equal((await next.execute({offerId:'R-01'})).retryBlocked,true);
  assert.equal(provider.submissions,1);
});

test('NOL-04 explicit conflict and second candidate can be reviewed once with fallback',async()=>{
  now=1791740000000;
  const {runner,provider,journal}=make({offers:[seat('R-01'),seat('S-02',{
    priceTier:'S',section:'Balcony',floor:'2F',totalMinor:115000
  })],scenario:{outcome:'seat_conflict'}});
  const conflict=await runner.execute({offerId:'R-01'});
  assert.equal(conflict.status,'seat_conflict');
  assert.equal(conflict.manualFallbackPossible,true);
  assert.equal(provider.submissions,1);
  // A second candidate still requires explicit confirmation and has no
  // automatic retry loop. Scenario deliberately returns another conflict.
  const noConsent=await runner.execute({offerId:'S-02'});
  assert.equal(noConsent.retryBlocked,true);
  assert.equal(provider.submissions,1);
  const confirmed=await runner.execute({offerId:'S-02',confirmedFallback:true});
  assert.equal(confirmed.status,'seat_conflict');
  assert.equal(provider.submissions,2);
  assert.equal(journal.view(scope).attempts,2);
  assert.equal((await runner.execute({offerId:'R-01',confirmedFallback:true})).retryBlocked,true);
  assert.equal(provider.submissions,2);
});

test('NOL-04 fallback is not allowed when user disallows alternative sections',async()=>{
  now=1791740000000;
  const strict={...plan,allowFallback:false};
  const {runner,provider}=make({prefs:strict,scenario:{outcome:'seat_conflict'},
    offers:[seat('R-01'),seat('S-02',{section:'Unapproved',floor:'3F'})]});
  assert.equal((await runner.execute({offerId:'R-01'})).status,'seat_conflict');
  assert.equal((await runner.execute({offerId:'S-02',confirmedFallback:true})).retryBlocked,true);
  assert.equal(provider.submissions,1);
});

test('NOL-04 response lost after mutation stays unknown; never silently retries',async()=>{
  now=1791740000000;
  const {runner,provider,journal}=make({scenario:{throwAfterSubmit:true}});
  const first=await runner.execute({offerId:'R-01'});
  assert.equal(first.status,'reservation_unknown');
  assert.equal(first.liveHoldVerified,false);
  assert.equal(journal.view(scope).status,'submitted_unknown');
  assert.equal((await runner.execute({offerId:'R-01'})).retryBlocked,true);
  assert.equal(provider.submissions,1);
});

test('NOL-04 clicked without provider hold evidence cannot mark success',async()=>{
  now=1791740000000;
  const {runner,provider}=make({scenario:{outcome:'no_hold'}});
  assert.equal((await runner.execute({offerId:'R-01'})).status,'reservation_unknown');
  assert.equal(provider.submissions,1);
});

test('NOL-04 wrong quantity, performance, fees, and price block BEFORE mutation',async()=>{
  now=1791740000000;
  for(const patch of [
    {quantity:2},{currency:'USD'},{performanceId:'show-2'},
    {feesIncluded:false},{totalMinor:155000},{eventId:'event-B'},
    {available:false},{section:'Nonpreferred',floor:'3F'}
  ]){
    const prefs=patch.section?{...plan,allowFallback:false}:plan;
    const {runner,provider}=make({offers:[seat('R-01',patch)],prefs});
    const result=await runner.execute({offerId:'R-01'});
    assert.equal(result.status,'blocked',JSON.stringify(patch));
    assert.equal(provider.submissions,0,JSON.stringify(patch));
  }
});

test('NOL-04 fabricated or mismatched hold metadata fails closed',async()=>{
  now=1791740000000;
  const mismatches=[
    {quantity:2},{currency:'USD'},{totalMinor:160000},
    {feesIncluded:false},{performanceId:'other-performance'},
    {sessionId:'other-session'},{generation:2},
    {offerId:'other-seat'},{status:'paid'},{source:'ai-screenshot'}
  ];
  for(const observationOverride of mismatches){
    const {runner,provider}=make({scenario:{observationOverride}});
    const result=await runner.execute({offerId:'R-01'});
    assert.equal(result.status,'reservation_unknown',JSON.stringify(observationOverride));
    assert.equal(result.liveHoldVerified,false);
    assert.equal(provider.submissions,1);
  }
});

test('NOL-04 expired hold or stale observation can never be verified',async()=>{
  now=1791740000000;
  for(const scenario of [
    {holdDurationMs:-1},
    {observationOverride:{observedAtMs:now-10000}}
  ]){
    const {runner,provider}=make({scenario});
    const result=await runner.execute({offerId:'R-01'});
    assert.equal(result.liveHoldVerified,false);
    assert.notEqual(result.status,'sandbox_hold_verified');
    assert.equal(provider.submissions,1);
    if(scenario.holdDurationMs===-1)
      assert.equal(result.status,'hold_expired');
  }
});

test('NOL-04 caller-supplied forged evidence is not accepted as provider proof',()=>{
  now=1791740000000;
  const provider=new NolSandboxProvider({offers:[seat()],clock});
  const forged={status:'held',source:'nol-offline-provider',
    reference:'OFFLINE-1',orderId:'TEST-1',...scope,
    offerId:'R-01',quantity:1,currency:'KRW',totalMinor:130000,
    feesIncluded:true,priceTier:'R',section:'Main',floor:'1F',
    seatMode:'assigned',observedAtMs:now,expiresAtMs:now+60000};
  assert.throws(()=>verifySandboxHold({provider,scope,plan,
    offer:seat(),evidence:forged,clock}),/not verified/);
  assert.throws(()=>new NolSandboxExecutor({provider:{},plan,scope,
    journal:new NolSandboxJournal()}),/offline provider capability/);
});

test('NOL-04 owner change and cancellation stop mutation and block replay',async()=>{
  now=1791740000000;
  let owned=true;
  const {runner,provider,journal}=make({check:()=>owned});
  owned=false;
  assert.equal((await runner.execute({offerId:'R-01'})).status,'blocked');
  assert.equal(provider.submissions,0);
  assert.equal(journal.view(scope),null);
  owned=true;
  const r=await runner.execute({offerId:'R-01'});
  assert.equal(r.status,'sandbox_hold_verified');
  runner.stop();
  assert.equal((await runner.execute({offerId:'R-01'})).retryBlocked,true);
  assert.equal(provider.submissions,1);
});

test('NOL-04 concurrent executor contenders share one journal fence',async()=>{
  now=1791740000000;
  const journal=new NolSandboxJournal(),provider=new NolSandboxProvider({offers:[seat()],clock});
  const one=new NolSandboxExecutor({provider,plan,scope,journal,clock});
  const two=new NolSandboxExecutor({provider,plan,scope,journal,clock});
  const results=await Promise.all([
    one.execute({offerId:'R-01'}),two.execute({offerId:'R-01'})
  ]);
  assert.equal(provider.submissions,1);
  assert.equal(results.filter(x=>x.status==='sandbox_hold_verified').length,1);
  assert.equal(results.filter(x=>x.status==='blocked').length,1);
  assert.equal(journal.view(scope).status,'sandbox_hold_verified');
});

test('NOL-04 tampering with previously issued mock evidence fails fingerprint check',async()=>{
  now=1791740000000;
  const provider=new NolSandboxProvider({offers:[seat()],clock});
  await provider.submitOnce('R-01',scope);
  const proof=await provider.observeHold(scope);
  assert.equal(provider.verifies(proof,scope),true);
  proof.totalMinor=1;
  assert.equal(provider.verifies(proof,scope),false);
  assert.throws(()=>verifySandboxHold({provider,scope,plan,offer:seat(),
    evidence:proof,clock}),/not verified/);
});


test('NOL-04 stop during delayed offer read prevents any provider mutation',async()=>{
  now=1791740000000;
  const {runner,provider,journal}=make();
  const read=provider.readOffer.bind(provider);
  let releaseRead;
  provider.readOffer=async id=>{
    await new Promise(resolve=>{releaseRead=resolve;});
    return read(id);
  };
  const attempt=runner.execute({offerId:'R-01'});
  // The await is inside the mock provider, before journal intent or mutation.
  runner.stop();
  releaseRead();
  const outcome=await attempt;
  assert.equal(outcome.status,'blocked');
  assert.equal(provider.submissions,0);
  assert.equal(journal.view(scope),null);
});

test('NOL-04 owner lost after provider mutation produces unknown and no replay',async()=>{
  now=1791740000000;
  let owned=true;
  const {runner,provider,journal}=make({check:()=>owned});
  const submit=provider.submitOnce.bind(provider);
  provider.submitOnce=async (...args)=>{await submit(...args);owned=false;};
  const result=await runner.execute({offerId:'R-01'});
  assert.equal(result.status,'reservation_unknown');
  assert.equal(result.liveHoldVerified,false);
  assert.equal(provider.submissions,1);
  assert.equal(journal.view(scope).status,'submitted_unknown');
  owned=true;
  const retry=await runner.execute({offerId:'R-01'});
  assert.equal(retry.retryBlocked,true);
  assert.equal(provider.submissions,1);
});
