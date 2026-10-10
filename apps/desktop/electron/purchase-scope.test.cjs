'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {PaymentAttemptLedger}=require('./booking/payment-attempts.cjs');
const {SessionCoordinator}=require('./booking/session-coordinator.cjs');
const {BookingRunner}=require('./booking/runner.cjs');
const permit={accountId:'offline-account',providerId:'cityline',planId:'plan-a',saleId:'presale',
  performanceId:'same-performance',eventKey:'same-event',quantity:1,currency:'HKD',
  maxAllInMinor:20000,requireTogether:true,allowFallback:false,checkout:'review'};
const order={id:'mock-order',eventKey:permit.eventKey,available:true,quantity:1,currency:'HKD',
  totalMinor:10000,feesIncluded:true,adjacent:true,priceTier:'100',performance:permit.performanceId,seats:['A1']};
function ledger(t,options){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-scope-v2-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new PaymentAttemptLedger(dir,options);}
const input=(p=permit)=>({runId:crypto.randomUUID(),permit:p,order,rehearsal:false});
test('same performance cannot be repurchased through another sale, seller, plan or event key after restart',t=>{
  const l=ledger(t),first=input();l.recordCommitIntent(first);
  const again=new PaymentAttemptLedger(path.dirname(path.dirname(l.journal.file)));
  for(const p of [{...permit,saleId:'general-sale'},{...permit,providerId:'other-seller'},
    {...permit,planId:'other-plan'},{...permit,eventKey:'alternate-event'},
    {...permit,quantity:2,maxAllInMinor:30000}]){
    assert.equal(again.hasAttempt(p),true);
    assert.throws(()=>again.recordCommitIntent(input(p)),{code:'duplicate_purchase_intent'});
  }
  const another={...permit,performanceId:'different-performance'};
  assert.doesNotThrow(()=>again.recordCommitIntent({...input(another),order:{...order,performance:another.performanceId}}));
  const otherAccount={...permit,accountId:'different-user'};
  assert.doesNotThrow(()=>again.recordCommitIntent(input(otherAccount)));
});
test('claim-only latch is durable, cannot prove a payment, and upgrades once with exact run/order/permit',t=>{
  const l=ledger(t),i=input(),claim=l.recordClaimRequested(i);
  assert.equal(l.inspection(claim.attemptId).claimOnly,true);
  assert.throws(()=>l.submissionReturned(claim),{code:'invalid_payment_transition'});
  const recovered=new PaymentAttemptLedger(path.dirname(path.dirname(l.journal.file)));
  assert.equal(recovered.recovered()[0].safetyRecoveryRequired,true);
  assert.match(recovered.recovered()[0].message,/submission is not established/);
  assert.throws(()=>recovered.recordClaimRequested(input()),{code:'duplicate_purchase_intent'});
  assert.throws(()=>recovered.recordCommitIntent({...i,permit:{...permit,saleId:'general-sale'}}),{code:'duplicate_purchase_intent'});
  const commit=recovered.recordCommitIntent(i);
  assert.equal(commit.attemptId,claim.attemptId);
  assert.equal(recovered.inspection(commit.attemptId).claimOnly,false);
  assert.equal(recovered.journal.read().length,4);
  assert.throws(()=>recovered.recordCommitIntent(i),{code:'duplicate_purchase_intent'});
});
test('v1 real history stays byte-preserved and quarantines all new automatic purchase scopes',t=>{
  const l=ledger(t);l.recordCommitIntent(input());
  // Reconstruct an isolated legacy fixture; no real journal is migrated by rewriting.
  let previous='0'.repeat(64);
  const oldScope=l.journal.digest(['purchase-scope-v1',permit.accountId,permit.providerId,
    permit.saleId,permit.eventKey,permit.performanceId]);
  const legacy=l.journal.read().map(({hash,purchaseScopeVersion,...e})=>{
    const unsigned={...e,version:1,scopeDigest:oldScope,prevHash:previous};
    previous=crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    return {...unsigned,hash:previous};
  });
  fs.writeFileSync(l.journal.file,legacy.map(x=>JSON.stringify(x)+'\n').join(''));
  const bytes=fs.readFileSync(l.journal.file);
  const recovered=new PaymentAttemptLedger(path.dirname(path.dirname(l.journal.file)));
  assert.equal(recovered.recovered()[0].legacyScopeUnresolved,true);
  assert.throws(()=>recovered.recordCommitIntent(input({...permit,saleId:'general-sale'})),{code:'legacy_scope_unresolved'});
  assert.deepEqual(fs.readFileSync(l.journal.file),bytes);
  // Even an old completed real attempt cannot be forgotten when its broader
  // performance identity is unknowable. Keep a visible safety warning.
  const e=legacy.at(-1),unsigned={version:1,seq:4,prevHash:e.hash,
    type:'PURCHASE_CONFIRMED',atMs:e.atMs,scopeDigest:e.scopeDigest,
    runId:e.runId,attemptId:e.attemptId,rehearsal:false,receiptDigest:'f'.repeat(64)};
  const confirmation={...unsigned,hash:crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')};
  fs.appendFileSync(l.journal.file,JSON.stringify(confirmation)+'\n');
  const completed=new PaymentAttemptLedger(path.dirname(path.dirname(l.journal.file)));
  assert.equal(completed.recovered()[0].legacyScopeUnresolved,true);
  assert.throws(()=>completed.recordCommitIntent(input()),{code:'legacy_scope_unresolved'});
});
test('existing synthetic v1 records remain readable without quarantining real scopes',t=>{
  const l=ledger(t);l.recordCommitIntent({...input(),rehearsal:true});
  let previous='0'.repeat(64);
  const records=l.journal.read().map(({hash,purchaseScopeVersion,...e})=>{
    const unsigned={...e,version:1,scopeDigest:l.journal.digest(['purchase-scope-v1',permit.accountId,permit.providerId,permit.saleId,permit.eventKey,permit.performanceId]),prevHash:previous};
    previous=crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    return {...unsigned,hash:previous};
  });
  fs.writeFileSync(l.journal.file,records.map(x=>JSON.stringify(x)+'\n').join(''));
  const recovered=new PaymentAttemptLedger(path.dirname(path.dirname(l.journal.file)));
  assert.doesNotThrow(()=>recovered.recordCommitIntent(input()));
  assert.equal(recovered.journal.read()[0].version,1);
  assert.equal(recovered.journal.read().at(-1).version,2);
});
test('memory ownership ignores seller/sale identity and blocks competing windows before network',async()=>{
  let calls=0;
  const c=new SessionCoordinator({remote:async()=>{calls++;assert.fail('synthetic only');}});
  const base={runId:crypto.randomUUID(),windowId:1,...permit,rehearsal:true};
  await c.acquire(base);
  await assert.rejects(()=>c.acquire({...base,runId:crypto.randomUUID(),windowId:2,
    saleId:'general',providerId:'other-seller'}),{code:'already_owned'});
  assert.equal(calls,0);
});
test('fsync failure before claim prevents network and payment; lost claim response recovers durable latch',async t=>{
  for(const broken of [true,false]){
    const l=ledger(t,broken?{fault:name=>{if(name==='before_fsync')throw Error('disk failure');}}:undefined);
    let claims=0,submits=0;
    const r=new BookingRunner({eventKey:permit.eventKey,windowId:1,rehearsal:false,
      preferences:{schemaVersion:1,quantity:1,maxTotalMinor:20000,currency:'HKD',
        requireTogether:true,allowFallback:false,checkout:'automatic',
        options:{performance:permit.performanceId,priceTier:['100'],section:[],floor:[],seatMode:'',fulfillment:''}},
      purchasePermit:permit,ledger:l,secret:{use:fn=>fn(null),clear(){}},notify:()=>{},
      adapter:{read:async()=>({eventKey:permit.eventKey,stage:'payment',order})},
      sessionCoordinator:{claimBeforeCommit:async()=>{claims++;throw Error('response lost');}},
      payment:{verified:true,submit:()=>{submits++;}}
    });
    await r.step();assert.equal(submits,0);assert.equal(claims,broken?0:1);
    if(!broken){
      assert.equal(r.state.status,'payment_unknown');
      assert.equal(new PaymentAttemptLedger(path.dirname(path.dirname(l.journal.file))).recovered()[0].claimOnly,true);
    }
  }
});
