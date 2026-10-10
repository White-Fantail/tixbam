'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {SessionCoordinator,SessionOwnershipError}=require('./booking/session-coordinator.cjs');
const {BookingRunner}=require('./booking/runner.cjs');
const user='account-uuid',providerId='cityline',saleId='sale-uuid',performanceId='performance-uuid';
const eventKey='show-123',planId='plan-uuid';
const run=()=>crypto.randomUUID();
const info=(runId=run(),windowId=5,override={})=>({
  runId,windowId,accountId:user,providerId,saleId,performanceId,eventKey,planId,...override
});
const wait=()=>{let done;return {promise:new Promise(res=>done=res),done:value=>done(value)};};
function remoteStub(clock=()=>Date.now()) {
  let row=null,seq=0;
  let calls=[];
  async function remote(op,body) {
    calls.push(op);
    if(op==='acquire'){
      if(row && row.status==='claimed')throw Error('claim persists');
      if(row && row.expiresAtMs>clock())throw Error('already owner');
      seq++;
      row={leaseId:row?.leaseId||crypto.randomUUID(),
        leaseToken:'a'.repeat(64),fencingToken:seq,status:'leased',
        expiresAtMs:clock()+45000,ownerId:body.ownerId,
        providerId:body.providerId,saleId:body.saleId,
        performanceId:body.performanceId,
        autonomousCheckoutAvailable:false};
      return {...row,expiresAt:new Date(row.expiresAtMs).toISOString()};
    }
    if(!row||body.leaseId!==row.leaseId||body.fencingToken!==row.fencingToken||
       body.leaseToken!==row.leaseToken||body.ownerId!==row.ownerId||
       row.status!=='leased'||row.expiresAtMs<=clock())throw Error('stale lease');
    if(op==='claim')row.status='claimed';
    if(op==='release')row.expiresAtMs=clock()-1;
    if(op==='renew')row.expiresAtMs=clock()+45000;
    return {...row,expiresAt:new Date(row.expiresAtMs).toISOString()};
  }
  return {remote,calls,peek:()=>row};
}
test('only one window per registered purchase target and process can acquire',async()=>{
  const fake=remoteStub(),s=new SessionCoordinator({remote:fake.remote});
  const first=info();
  const a=await s.acquire(first);
  assert.equal(a.status,'leased');
  assert.equal(a.fencingToken,1);
  await assert.rejects(()=>s.acquire(info(run(),6)),/already_owned/);
  await assert.rejects(()=>s.acquire(info(run(),first.windowId,
    {performanceId:'another-performance'})),/already_owned/);
  assert.equal(s.assertOwner(first.runId,5,eventKey).status,'leased');
  assert.throws(()=>s.assertOwner(first.runId,6,eventKey),/lost_owner/);
  assert.throws(()=>s.assertOwner(first.runId,5,'wrong-event'),/lost_owner/);
  await s.release(first.runId);
  assert.equal(s.activeCount,0);
  assert.equal(fake.calls.at(-1),'release');
});

test('different performances can proceed independently in distinct windows',async()=>{
  const fake=remoteStub();
  // Stub tracks only one server lease; use independent remote per performance.
  const other=remoteStub();
  const s=new SessionCoordinator({remote:(op,payload)=>
    (payload.performanceId==='performance-two'||payload.ownerId===lastOwner?
      other.remote:fake.remote)(op,payload)});
  const one=info();
  const two=info(run(),6,{performanceId:'performance-two'});
  const lastOwner='unused';
  await s.acquire(one);
  await s.acquire(two);
  assert.equal(s.activeCount,2);
  s.invalidateWindow(5);
  assert.equal(s.activeCount,1);
  assert.equal(s.assertOwner(two.runId,6,eventKey).status,'leased');
  s.invalidateAll();
  assert.equal(s.activeCount,0);
});

test('two simultaneously starting windows reserve local owner before network response',async()=>{
  const gate=wait(),base=remoteStub();
  const s=new SessionCoordinator({remote:(op,payload)=>
    op==='acquire'?gate.promise:base.remote(op,payload)});
  const first=info();
  const pending=s.acquire(first);
  await assert.rejects(()=>s.acquire(info(run(),6)),/already_owned/);
  gate.done({providerId,saleId,performanceId,leaseId:crypto.randomUUID(),fencingToken:1,leaseToken:'b'.repeat(64),
    status:'leased',autonomousCheckoutAvailable:false,
    expiresAt:new Date(Date.now()+45000).toISOString()});
  await pending;
  assert.equal(s.activeCount,1);
  await s.release(first.runId);
});

test('release while lease acquisition is in flight invalidates late ownership',async()=>{
  const gate=wait(),s=new SessionCoordinator({remote:(op)=>op==='acquire'?
    gate.promise:Promise.resolve({})});
  const first=info(),p=s.acquire(first);
  await s.release(first.runId);
  gate.done({providerId,saleId,performanceId,leaseId:crypto.randomUUID(),fencingToken:1,leaseToken:'c'.repeat(64),
    status:'leased',autonomousCheckoutAvailable:false,
    expiresAt:new Date(Date.now()+45000).toISOString()});
  await assert.rejects(p,/cancelled/);
  assert.equal(s.activeCount,0);
});

test('renewal uses exact token/fencing, and errors fail closed',async()=>{
  let time=Date.now();
  const fake=remoteStub(()=>time),s=new SessionCoordinator({remote:fake.remote,clock:()=>time});
  const first=info();
  await s.acquire(first);
  time+=25000;
  await s.renew(first.runId);
  assert.equal(s.assertOwner(first.runId,5,eventKey).status,'leased');
  time+=60000;
  assert.throws(()=>s.assertOwner(first.runId,5,eventKey),/lease_expired/);
  assert.equal(s.activeCount,0);
  await assert.rejects(()=>s.renew(first.runId),/lost_owner/);
});

test('server outage refuses acquire and commit; a lost claim response cannot retry',async()=>{
  const noServer=new SessionCoordinator();
  await assert.rejects(()=>noServer.acquire(info()),/server_required/);
  const s=new SessionCoordinator({remote:async(op)=>{
    if(op==='claim')throw Error('connection lost after server committed');
    if(op==='acquire')return {
      providerId,saleId,performanceId,
      leaseId:crypto.randomUUID(),fencingToken:1,leaseToken:'f'.repeat(64),
      status:'leased',autonomousCheckoutAvailable:false,
      expiresAt:new Date(Date.now()+45000).toISOString()};
    return {};
  }});
  const first=info();await s.acquire(first);
  await assert.rejects(()=>s.claimBeforeCommit(first.runId,5,eventKey),/claim_outcome_unknown/);
  assert.equal(s.activeCount,0);
  await assert.rejects(()=>s.claimBeforeCommit(first.runId,5,eventKey),/lost_owner/);
});

test('a committed claim can never be released as a pre-commit owner',async()=>{
  const fake=remoteStub(),s=new SessionCoordinator({remote:fake.remote});
  const first=info();await s.acquire(first);
  const commit=await s.claimBeforeCommit(first.runId,5,eventKey);
  assert.equal(commit.status,'claimed');
  await assert.rejects(()=>s.claimBeforeCommit(first.runId,5,eventKey),/already_claimed/);
  await s.release(first.runId);
  assert.equal(fake.calls.filter(x=>x==='release').length,0);
  assert.equal(fake.peek().status,'claimed');
  await assert.rejects(()=>s.acquire(info(run(),6)),/server_unreachable_or_denied/);
});

test('stale server fencing or invalid status cannot be accepted',async()=>{
  for(const spoof of [{fencingToken:0},{leaseToken:'invalid'},{status:'claimed'},
    {autonomousCheckoutAvailable:true},{providerId:'wrong-provider'},
    {saleId:'other-sale'},{performanceId:'other-performance'},
    {expiresAt:new Date(0).toISOString()}]){
    const s=new SessionCoordinator({remote:async()=>({
      providerId,saleId,performanceId,
      leaseId:crypto.randomUUID(),fencingToken:1,leaseToken:'e'.repeat(64),
      status:'leased',autonomousCheckoutAvailable:false,
      expiresAt:new Date(Date.now()+45000).toISOString(),...spoof})});
    await assert.rejects(()=>s.acquire(info()),SessionOwnershipError);
    assert.equal(s.activeCount,0);
  }
});

test('rehearsal remains entirely local, no network, cancellation stops ownership',async()=>{
  const s=new SessionCoordinator({remote:async()=>assert.fail('no API for rehearsal')});
  const first=info();
  const lease=await s.acquire({...first,rehearsal:true});
  assert.equal(lease.status,'leased');
  assert.equal(s.assertOwner(first.runId,5,eventKey).status,'leased');
  assert.equal((await s.claimBeforeCommit(first.runId,5,eventKey)).status,'leased');
  await s.release(first.runId);
  assert.equal(s.activeCount,0);
});

test('runner requires a shared lease claim before any real payment and never submits if claim fails',async()=>{
  let paid=0,claims=0;
  const order={id:'order-1',eventKey:'e1',quantity:1,currency:'HKD',
    totalMinor:10000,feesIncluded:true,adjacent:true,available:true,
    performance:'p1',priceTier:'100',seats:['A1']};
  const prefs={schemaVersion:1,quantity:1,maxTotalMinor:20000,currency:'HKD',
    requireTogether:true,allowFallback:false,checkout:'automatic',
    options:{performance:'p1',priceTier:['100'],section:[],floor:[],seatMode:'',fulfillment:''}};
  const runner=new BookingRunner({
    eventKey:'e1',windowId:7,rehearsal:false,preferences:prefs,
    adapter:{read:async()=>({stage:'payment',eventKey:'e1',order})},
    secret:{use:fn=>fn({}),clear(){}},
    payment:{verified:true,submit:()=>{paid++;}},
    ledger:{recordCommitIntent:()=>{throw Error('journal not ready');}},
    sessionCoordinator:{claimBeforeCommit:async()=>{claims++;return {status:'claimed'};}},
    notify:()=>{}
  });
  await runner.step();
  assert.equal(claims,1);
  assert.equal(paid,0);
  assert.equal(runner.state.status,'payment_unknown'); // cloud claim may be durable; never retry
  await runner.step();
  assert.equal(claims,1);
});



test('an ambiguous cloud claim never leaves the booking safely retryable',async()=>{
  const prefs={quantity:1,maxTotalMinor:20000,currency:'HKD',
    requireTogether:true,allowFallback:false,checkout:'automatic',
    options:{performance:'p1',priceTier:['100'],section:[],floor:[],seatMode:'',fulfillment:''}};
  const order={id:'o1',eventKey:'e1',quantity:1,currency:'HKD',
    totalMinor:10000,feesIncluded:true,adjacent:true,available:true,
    performance:'p1',priceTier:'100',seats:['A1']};
  let pay=0;
  const b=new BookingRunner({
    eventKey:'e1',windowId:7,rehearsal:false,preferences:prefs,
    adapter:{read:async()=>({stage:'payment',eventKey:'e1',order})},
    payment:{verified:true,submit:()=>{pay++;}},
    secret:{use:fn=>fn({}),clear(){}},ledger:{recordCommitIntent:()=>assert.fail('must not write')},
    sessionCoordinator:{claimBeforeCommit:async()=>{throw Error('timeout after server accepted');}},
    notify:()=>{}
  });
  await b.step();
  assert.equal(pay,0);
  assert.equal(b.state.status,'payment_unknown');
  assert.equal(b.state.phase,'PAYMENT_UNKNOWN');
  assert.match(b.state.message,/retry is disabled/);
  await b.step();
  assert.equal(pay,0);
});

test('Stop while a cloud claim is in flight remains UNKNOWN after the response arrives',async()=>{
  const {BookingStateMachine}=require('./booking/state-machine.cjs');
  const machine=new BookingStateMachine(crypto.randomUUID());
  const go=(event,evidence)=>machine.transition(machine.runId,machine.revision,event,evidence);
  go('START');go('SESSION_READY');go('OBSERVED');go('REVIEW_ORDER');go('COMMIT_READY');
  assert.throws(()=>go('CLOUD_CLAIM_UNKNOWN'),/uncertainty/);
  assert.equal(go('CLOUD_CLAIM_UNKNOWN',{claimAttempted:true}).phase,'PAYMENT_UNKNOWN');
  assert.throws(()=>go('START'),/Terminal/);
  const prefs={quantity:1,maxTotalMinor:20000,currency:'HKD',requireTogether:true,
    allowFallback:false,checkout:'automatic',
    options:{performance:'p1',priceTier:['100'],section:[],floor:[],seatMode:'',fulfillment:''}};
  const order={id:'o1',eventKey:'e1',quantity:1,currency:'HKD',
    totalMinor:10000,feesIncluded:true,adjacent:true,available:true,
    performance:'p1',priceTier:'100',seats:['A1']};
  let finish,pay=0;
  const pending=new Promise(resolve=>finish=resolve);
  const b=new BookingRunner({
    eventKey:'e1',windowId:7,rehearsal:false,preferences:prefs,
    adapter:{read:async()=>({stage:'payment',eventKey:'e1',order})},
    payment:{verified:true,submit:()=>{pay++;}},
    secret:{use:fn=>fn({}),clear(){}},
    ledger:{recordCommitIntent:()=>assert.fail('cancel must stop')},
    sessionCoordinator:{claimBeforeCommit:()=>pending},
    notify:state=>{if(state.phase==='READY_TO_COMMIT')setImmediate(()=>b.stop());}
  });
  const task=b.step();
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(b.state.status,'payment_unknown');
  finish({status:'claimed'});
  await task;
  assert.equal(pay,0);
  assert.equal(b.state.status,'payment_unknown');
});
