'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {ActionValidator,strictProposal,ACTION_TARGETS}=require('./booking/action-validator.cjs');
const {executeReviewedProposal,assertDeterministicHostAction}=require('./booking/action-registry.cjs');
const {RehearsalAdapter}=require('./booking/rehearsal.cjs');

const prefs={schemaVersion:1,quantity:2,maxTotalMinor:200000,currency:'HKD',
  requireTogether:true,allowFallback:false,checkout:'review',
  options:{performance:'demo-evening',priceTier:['800','500'],
    section:[],floor:[],seatMode:'',fulfillment:''}};
const order={id:'offer-one',eventKey:'sample-event',available:true,quantity:2,
  currency:'HKD',totalMinor:167000,feesIncluded:true,adjacent:true,
  priceTier:'800',performance:'demo-evening',seats:['A1','A2']};
const now=1781060400000;

function setup({stage='offers',challenge='none',targets=[{kind:'offer',value:order,available:true}],
  rehearsal=true,policyRevision=9,consentChange={},scopeChange={}}={}){
  let time=now;
  const validator=new ActionValidator({clock:()=>time});
  const run={id:crypto.randomUUID(),eventKey:'sample-event',windowId:27,
    revision:3,generation:1,phase:'DECIDING',status:'running',rehearsal};
  const providerId='cityline',accountId='account-123',planId='plan-123';
  const snapshot=validator.issueSnapshot({run,providerId,country:'HK',addonVersion:'1.1.0',
    accountId,planId,stage,challenge,pageGeneration:12,policyRevision,
    targets,ttlMs:5000});
  const consent={runId:run.id,eventKey:run.eventKey,windowId:run.windowId,accountId,planId,providerId,country:'HK',
    addonVersion:'1.1.0',policyRevision,permittedActions:['SELECT_OFFER','SELECT_PERFORMANCE','SELECT_PRICE_TIER'],
    expiresAtMs:now+20000,maxAllInMinor:200000,quantity:2,currency:'HKD',
    ...consentChange};
  const scope={run,providerId,country:'HK',addonVersion:'1.1.0',accountId,planId,
    windowId:run.windowId,eventKey:run.eventKey,pageGeneration:12,
    policyRevision,consent,preferences:prefs,rehearsalPermission:true,
    ...scopeChange};
  function propose(action='SELECT_APPROVED_OFFER',override={}){
    return {schemaVersion:1,requestId:crypto.randomUUID(),runId:run.id,
      snapshotId:snapshot.snapshotId,expectedPageGeneration:12,
      expectedStage:stage,action,
      targetRef:ACTION_TARGETS[action]===null?null:snapshot.handles[0]?.ref??null,
      rationaleCode:'MATCHING_OFFER',expiresAtMs:now+4500,...override};
  }
  return {validator,run,snapshot,scope,consent,propose,setTime:t=>{time=t;}};
}

test('host-issued snapshots expose only opaque handles without payment data or offer details',()=>{
  const {snapshot}=setup();
  assert.match(snapshot.snapshotId,/^[0-9a-f-]{36}$/);
  assert.equal(snapshot.stage,'offers');
  assert.equal(snapshot.handles[0].kind,'offer');
  assert.match(snapshot.handles[0].ref,/^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(snapshot).includes('A1'));
  assert.ok(!JSON.stringify(snapshot).includes('167000'));
  assert.ok(!JSON.stringify(snapshot).includes('account-123'));
  assert.ok(!JSON.stringify(snapshot).includes('sample-event'));
  const secret=setup({targets:[{kind:'offer',value:{...order,cvv:'123'},available:true}]});
  assert.ok(!JSON.stringify(secret.snapshot).includes('123'));
});

test('strict proposal rejects arbitrary code/DOM/navigation/payment and malicious object shapes',()=>{
  const {propose}=setup();
  const valid=propose();
  assert.ok(strictProposal(valid));
  for(const change of [
    {action:'PAYMENT_EXECUTOR'},{action:'SUBMIT_PAYMENT'},{action:'EVAL_JS'},
    {action:'window.open'}, {action:'__proto__'},
    {targetRef:'document.querySelector("button")'},
    {targetRef:'https://bad.test'}, {requestId:'../../etc/password'},
    {rationaleCode:'click card data'}, {schemaVersion:2},
    {expectedPageGeneration:-1}, {expiresAtMs:1.5},
    {expectedStage:'https://something'}, {runId:'x'}
  ])assert.equal(strictProposal({...valid,...change}),null,JSON.stringify(change));
  for(const field of ['selector','xpath','url','javascript','coords','cardNumber','cvv',
                      'amountOverride','force','timeoutMs','__proto__']) {
    const attack=JSON.parse(JSON.stringify(valid));
    Object.defineProperty(attack,field,{value:'evil',enumerable:true});
    assert.equal(strictProposal(attack),null,field);
  }
  const getter=Object.defineProperty({...valid},'action',{enumerable:true,get(){throw Error('executed');}});
  assert.equal(strictProposal(getter),null);
  assert.equal(strictProposal([]),null);
  assert.equal(strictProposal(new Date()),null);
});

test('a valid rehearsal offer only passes with exact binding and purchase constraints',()=>{
  const {validator,scope,propose}=setup();
  assert.deepEqual(validator.validate(propose(),scope).code,'ALLOW');
  for(const key of ['run','providerId','country','addonVersion','accountId','planId',
                    'windowId','eventKey','pageGeneration','policyRevision']) {
    let spoof={...scope};
    if(key==='run')spoof.run={...scope.run,revision:scope.run.revision+1};
    else if(key==='pageGeneration')spoof[key]=scope[key]+1;
    else if(key==='windowId')spoof[key]=scope[key]+1;
    else if(key==='policyRevision')spoof[key]=scope[key]+1;
    else spoof[key]=key==='country'?'NZ':key==='addonVersion'?'2.0.0':'wrong-provider';
    const result=validator.validate(propose(),spoof);
    assert.equal(result.allowed,false,key);
  }
  const denied=setup({consentChange:{currency:'USD'}});
  assert.equal(denied.validator.validate(denied.propose(),denied.scope).code,'UNKNOWN_PRICE');
  for(const change of [
    {maxAllInMinor:10},{quantity:1},{permittedActions:[]},{runId:crypto.randomUUID()},
    {eventKey:'wrong-event'},{windowId:77},
    {expiresAtMs:now-1},{policyRevision:8},{accountId:'some-other-user'}
  ]) {
    const x=setup({consentChange:change});
    assert.equal(x.validator.validate(x.propose(),x.scope).allowed,false,JSON.stringify(change));
  }
});

test('negative inventory, unknown fees, budget overflow, unauthorized fallback and mismatched event fail closed',()=>{
  for(const change of [
    {eventKey:'wrong-event'}, {totalMinor:200001}, {totalMinor:null},
    {feesIncluded:false},{quantity:1},{adjacent:false},
    {available:false},{priceTier:'500'},{currency:'USD'},
    {performance:'wrong-performance'},
  ]) {
    let denied=false;
    try {
      const x=setup({targets:[{kind:'offer',value:{...order,...change},available:true}]});
      denied=!x.validator.validate(x.propose(),x.scope).allowed;
    } catch (err) {denied=err instanceof TypeError;} // invalid host offer
    assert.equal(denied,true,JSON.stringify(change));
  }
  const x=setup({targets:[{kind:'offer',value:{...order,cvv:'777'},available:true}]});
  assert.equal(x.validator.validate(x.propose(),x.scope).code,'ALLOW');
  assert.equal(x.validator.validate(x.propose('PAYMENT_EXECUTOR'),x.scope).allowed,false);
});

test('a stage change, expired snapshot, revoked capability, challenge and wrong target cannot mutate',()=>{
  const initial=setup();
  assert.equal(initial.validator.validate(initial.propose(undefined,{expectedPageGeneration:11}),initial.scope).code,'STALE_OBSERVATION');
  assert.equal(initial.validator.validate(initial.propose(undefined,{expectedStage:'cart'}),initial.scope).code,'STALE_OBSERVATION');
  assert.equal(initial.validator.validate(initial.propose(undefined,{targetRef:crypto.randomUUID()}),initial.scope).code,'WRONG_OWNER');
  initial.setTime(now+5001);
  assert.equal(initial.validator.validate(initial.propose(),initial.scope).code,'STALE_OBSERVATION');
  const revoked=setup({scopeChange:{revoked:true}});
  assert.equal(revoked.validator.validate(revoked.propose(),revoked.scope).code,'POLICY_DENY');
  for(const stage of ['queue','bank_challenge','login','access_blocked']) {
    const x=setup({stage,challenge:'captcha'});
    assert.equal(x.validator.validate(x.propose(),x.scope).code,'CHALLENGE_REQUIRED');
  }
  const live=setup({rehearsal:false});
  assert.equal(live.validator.validate(live.propose(),live.scope).code,'POLICY_DENY');
  const missingLocal=setup({scopeChange:{rehearsalPermission:false}});
  assert.equal(missingLocal.validator.validate(missingLocal.propose(),missingLocal.scope).code,'CAPABILITY_MISSING');
});

test('provider-neutral PASSIVE proposals produce advice only, never stop a run',async()=>{
  const x=setup({stage:'queue',challenge:'queue',targets:[]});
  let stopped=0,observed=0;
  for(const action of ['WAIT','REOBSERVE','ASK_USER','STOP']) {
    const res=await executeReviewedProposal({
      validator:x.validator,proposal:x.propose(action),scope:x.scope,
      assertOwner:()=>{},readCurrent:()=>{observed++;},adapter:{stop:()=>{stopped++;}}
    });
    assert.equal(res.code,action==='WAIT'?'ADVISORY_ONLY':'STALE_OBSERVATION');
  }
  assert.equal(stopped,0);assert.equal(observed,0);
});

test('fake rehearsal offer can execute once, verifies postcondition, and denies replay',async()=>{
  const x=setup();
  const adapter=new RehearsalAdapter('sample-event',prefs);
  adapter.stage='offers';adapter.offers=[order];
  const proposal=x.propose();
  let reads=0;
  const args={
    validator:x.validator,proposal,scope:x.scope,adapter,
    readCurrent:async()=>{reads++;return {...await adapter.read(),pageGeneration:12}},
    assertOwner:()=>{},
  };
  const done=await executeReviewedProposal(args);
  assert.equal(done.executed,true);
  assert.equal(done.code,'EXECUTED_REHEARSAL');
  assert.equal(adapter.stage,'payment');
  assert.equal(reads,1);
  const replay=await executeReviewedProposal(args);
  assert.equal(replay.executed,false);
  assert.notEqual(replay.code,'EXECUTED_REHEARSAL');
  assert.equal(reads,1);
  const concurrent=setup();
  const otherAdapter=new RehearsalAdapter('sample-event',prefs);
  otherAdapter.stage='offers';otherAdapter.offers=[order];
  let reserves=0;
  const orig=otherAdapter.reserve.bind(otherAdapter);
  otherAdapter.reserve=async offer=>{reserves++;return orig(offer);};
  const gate={...args,validator:concurrent.validator,proposal:concurrent.propose(),
    scope:concurrent.scope,adapter:otherAdapter,readCurrent:async()=>({...await otherAdapter.read(),pageGeneration:12})};
  const results=await Promise.all([executeReviewedProposal(gate),executeReviewedProposal(gate)]);
  assert.equal(results.filter(r=>r.executed).length,1);
  assert.equal(reserves,1);
});

test('executor checks owner, source, fresh stage, generation and host-reviewed adapter',async()=>{
  for(const changed of [
    {readCurrent:async()=>({stage:'payment',eventKey:'sample-event',pageGeneration:12})},
    {readCurrent:async()=>({stage:'offers',eventKey:'other-event',pageGeneration:12})},
    {readCurrent:async()=>({stage:'offers',eventKey:'sample-event',pageGeneration:13})},
    {assertOwner:()=>{throw Error('window changed');}},
    {adapter:{reserve:async()=>{throw Error('forged addon');}}},
  ]) {
    const x=setup(),adapter=new RehearsalAdapter('sample-event',prefs);
    adapter.stage='offers';adapter.offers=[order];
    const out=await executeReviewedProposal({
      validator:x.validator,proposal:x.propose(),scope:x.scope,adapter,
      readCurrent:async()=>({...await adapter.read(),pageGeneration:12}),
      assertOwner:()=>{},...changed
    });
    assert.equal(out.executed,false);
    assert.equal(adapter.stage,'offers');
  }
});

test('re-observe await permits stop and policy change without dispatch',async()=>{
  const x=setup();const adapter=new RehearsalAdapter('sample-event',prefs);
  adapter.stage='offers';
  let release;
  const gate=new Promise(resolve=>release=resolve);
  const work=executeReviewedProposal({
    validator:x.validator,proposal:x.propose(),scope:x.scope,adapter,
    readCurrent:()=>gate,assertOwner:()=>{}
  });
  x.scope.run.revision+=1; // Host stopped/navigated while observer was pending.
  release({eventKey:'sample-event',stage:'offers',pageGeneration:12});
  const result=await work;
  assert.equal(result.executed,false);
  assert.equal(adapter.stage,'offers');
});

test('existing deterministic host options/seat actions reject mismatches and payment attempts',()=>{
  const runner={
    busy:true,cancelled:false,submitted:false,selectionMade:false,
    preferences:prefs,orchestrator:{machine:{phase:'EXECUTING_ACTION'}},
    state:{eventKey:'sample-event'}
  };
  const opts={eventKey:'sample-event',stage:'options'};
  assert.equal(assertDeterministicHostAction({action:'SELECT_OPTIONS',runner,page:opts}),true);
  assert.throws(()=>assertDeterministicHostAction({action:'SELECT_OPTIONS',runner,
    page:{...opts,eventKey:'other-event'}}));
  assert.equal(assertDeterministicHostAction({action:'RESERVE_OFFER',runner,
    page:{eventKey:'sample-event',stage:'offers'},offer:order}),true);
  assert.throws(()=>assertDeterministicHostAction({action:'RESERVE_OFFER',runner,
    page:{eventKey:'sample-event',stage:'offers'},offer:{...order,totalMinor:200001}}));
  assert.throws(()=>assertDeterministicHostAction({action:'SUBMIT_PAYMENT',runner,page:opts}));
});


test('same page generation but changed inventory or fees is not safe to reserve',async()=>{
  for(const changed of [
    {totalMinor:167001},{id:'replaced-offer'},{seats:['B1','B2']},
    {currency:'NZD'},{available:false},{feesIncluded:false},
    {priceTier:'500'}, {performance:'different'}
  ]) {
    const x=setup(),adapter=new RehearsalAdapter('sample-event',prefs);
    adapter.stage='offers';adapter.offers=[{...order,...changed}];
    const res=await executeReviewedProposal({
      validator:x.validator,proposal:x.propose(),scope:x.scope,adapter,
      readCurrent:async()=>({...await adapter.read(),pageGeneration:12}),
      assertOwner:()=>{}
    });
    assert.equal(res.executed,false,JSON.stringify(changed));
    assert.equal(res.code,'STALE_OBSERVATION');
    assert.equal(adapter.stage,'offers');
  }
});
