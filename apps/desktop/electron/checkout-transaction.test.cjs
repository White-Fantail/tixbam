'use strict';
// Synthetic contracts only: no actual Cityline network, purchase or charge.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {CheckoutTransaction}=require('./booking/checkout-transaction.cjs');
const {checkoutReadiness}=require('./booking/checkout-readiness.cjs');
const {PaymentAttemptLedger,canonicalPermit,canonicalOrder}=require('./booking/payment-attempts.cjs');
const {canonicalOrderSignature}=require('./booking/offer-policy.cjs');
const {SessionCoordinator}=require('./booking/session-coordinator.cjs');
const uuid=()=>crypto.randomUUID();
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function setup(t,extra={}){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'checkout-contract-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  let time=Date.now();const clock=()=>time;
  const prefs={quantity:2,maxTotalMinor:200000,currency:'HKD',requireTogether:true,allowFallback:false,
    checkout:'review',options:{performance:'provider-perf-7313',priceTier:['800'],section:[],floor:[]}};
  const permit={identityVersion:2,accountId:'synthetic-account',providerId:'cityline',performanceId:uuid(),
    providerPerformanceId:prefs.options.performance,providerEventId:'provider-event-7313',planId:uuid(),saleId:uuid(),
    eventKey:'synthetic-event-key',quantity:2,maxAllInMinor:200000,currency:'HKD',requireTogether:true,
    allowFallback:false,checkout:'review'};
  const order={schemaVersion:2,id:'synthetic-order-1',eventKey:permit.eventKey,providerId:'cityline',
    performance:permit.providerPerformanceId,canonicalPerformanceId:permit.performanceId,
    providerEventId:permit.providerEventId,priceTier:'800',quantity:2,currency:'HKD',totalMinor:165000,
    feesIncluded:true,available:true,adjacent:true,seats:['A1','A2'],seatMode:'assigned',fulfillment:'eticket',
    feeBreakdown:{ticketSubtotalMinor:160000,serviceFeeMinor:5000,taxMinor:0,deliveryFeeMinor:0,extrasMinor:0},
    extras:[],restrictedView:false,realNameRequired:false,ageRestricted:false,accessibilityRestricted:false,
    totalVerified:true,availabilityVerified:true,identityVerified:true};
  const state={page:{stage:'payment',eventKey:permit.eventKey,order,
    checkout:{sessionId:'synthetic-checkout-1',reservedUntilMs:time+60000}},
    claims:0,submits:0,allowed:true,onClaim:null,onSubmit:null};
  const leaseId=uuid(),coordinator=new SessionCoordinator({clock,remote:async op=>{
    if(op==='claim'){state.claims++;await state.onClaim?.();}
    return {status:op==='claim'?'claimed':'leased',leaseId,leaseToken:'a'.repeat(64),fencingToken:1,
      providerId:'cityline',performanceId:permit.performanceId,saleId:permit.saleId,
      autonomousCheckoutAvailable:false,expiresAt:new Date(time+60000).toISOString(),
      purchaseScopeVersion:2,guardStatus:'claimed',guardId:uuid(),claimId:uuid()};
  }});
  const run={id:uuid(),windowId:9,eventKey:permit.eventKey,rehearsal:false,phase:'READY_TO_COMMIT'};
  const binding=await coordinator.acquire({...permit,runId:run.id,windowId:run.windowId});
  const ledger=new PaymentAttemptLedger(folder,{clock});
  const tx=new CheckoutTransaction({ledger,coordinator,binding,permit,preferences:prefs,clock,
    read:async()=>structuredClone(state.page),authorize:async()=>state.allowed,
    submit:async args=>{assert.equal(args.signal.aborted,false);state.submits++;await state.onSubmit?.(args);},...extra});
  return {folder,prefs,permit,order,state,coordinator,ledger,tx,run,advance:ms=>time+=ms,
    prepare:(confirmed=true)=>tx.prepare({run,page:state.page,confirmed}),
    commit:approval=>tx.commit({run,approval,expected:order})};
}
function receiptPage(d){return {stage:'confirmation',eventKey:d.permit.eventKey,order:structuredClone(d.order),
  receipt:{status:'paid',transactionId:'SYNTHETIC-RECEIPT-1',orderId:d.order.id,providerId:'cityline',
    providerEventId:d.permit.providerEventId,providerPerformanceId:d.permit.providerPerformanceId,
    quantity:2,currency:'HKD',totalMinor:165000}};}
test('provider and canonical performance identity are separate and included in order digest',async t=>{
  const d=await setup(t),p=canonicalPermit(d.permit);
  assert.notEqual(d.order.performance,p.performanceId);assert.doesNotThrow(()=>canonicalOrder(d.order,p));
  for(const change of [{performance:'different'},{canonicalPerformanceId:uuid()},{providerEventId:'other'},{providerId:'other'}]){
    const o={...d.order,...change};assert.notEqual(canonicalOrderSignature(o),canonicalOrderSignature(d.order));
    assert.throws(()=>canonicalOrder(o,p),/unverified_purchase_order/);
  }
  assert.throws(()=>canonicalPermit({...p,identityVersion:1}),/invalid_provider_identity/);
  assert.throws(()=>canonicalPermit({...p,providerPerformanceId:undefined}),/invalid_provider_identity/);
  assert.equal(d.ledger.scopeDigest(p),d.ledger.scopeDigest({...p,saleId:uuid(),providerEventId:'other-sale'}));
});
test('review approval and fsynced claim/commit precede one submit; returned is not paid',async t=>{
  const d=await setup(t);assert.throws(()=>d.prepare(false),/approval_required/);
  const approval=d.prepare();await d.commit(approval);
  assert.equal(d.state.claims,1);assert.equal(d.state.submits,1);assert.equal(d.tx.outcome,'submitted');
  assert.deepEqual(d.ledger.journal.read().map(e=>e.type),[
    'RUN_CREATED','OFFER_LOCKED','CLAIM_REQUESTED','COMMIT_INTENT_RECORDED','PAYMENT_SUBMISSION_RETURNED']);
  assert.equal(d.ledger.inspection(d.tx.intent.attemptId).status,'payment_unknown');
  await assert.rejects(d.commit(approval),/stale_or_used_approval/);
  const raw=fs.readFileSync(d.ledger.journal.file,'utf8');
  for(const x of [d.permit.accountId,d.permit.performanceId,d.order.performance,d.order.id,'A1','https://','cvv'])
    assert.equal(raw.includes(x),false,x);
});
test('simultaneous confirmation results in only one claim and submission',async t=>{
  const d=await setup(t),a=d.prepare(),r=await Promise.allSettled([d.commit(a),d.commit(a)]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(d.state.claims,1);assert.equal(d.state.submits,1);
});
test('one canonical target cannot borrow another performance lease',async t=>{
  const d=await setup(t);assert.throws(()=>new CheckoutTransaction({ledger:d.ledger,coordinator:d.coordinator,
    binding:d.coordinator.assertOwner(d.run.id,9,d.run.eventKey),permit:{...d.permit,performanceId:uuid()},
    preferences:d.prefs,read:()=>{},submit:()=>{},authorize:()=>true}),/owner_or_guard_changed/);
});
test('expired approval or revoked capability stops before a claim or submit',async t=>{
  for(const revoked of [true,false]){const d=await setup(t),a=d.prepare();
    if(revoked)d.state.allowed=false;else d.advance(16000);
    await assert.rejects(d.commit(a));assert.equal(d.state.claims,0);assert.equal(d.state.submits,0);
    assert.equal(d.ledger.journal.read().length,0);
  }
});
test('changed order, cart, deadline or authorization after claim prevents submission',async t=>{
  for(const mutate of [d=>d.state.page.order.seats=['B1','B2'],
    d=>{d.state.page.order.totalMinor++;d.state.page.order.feeBreakdown.serviceFeeMinor++;},
    d=>d.state.page.checkout.sessionId='other-cart',d=>d.advance(60000),d=>d.state.allowed=false]){
    const d=await setup(t),a=d.prepare();d.state.onClaim=()=>mutate(d);
    await assert.rejects(d.commit(a),/claim_unknown/);assert.equal(d.state.submits,0);
    assert.equal(d.ledger.recovered()[0].claimOnly,true);
    assert.equal(new PaymentAttemptLedger(d.folder).hasAttempt(d.permit),true);
  }
});
test('claim response loss leaves a durable latch and no automatic retry',async t=>{
  const d=await setup(t),a=d.prepare();d.state.onClaim=()=>{throw Error('lost response');};
  await assert.rejects(d.commit(a),/claim_unknown/);assert.equal(d.state.submits,0);
  assert.equal(new PaymentAttemptLedger(d.folder).recovered()[0].claimOnly,true);
  await assert.rejects(d.commit(a),/stale_or_used_approval/);
});
test('claim timeout is bounded and a late response never submits',async t=>{
  const d=await setup(t,{timeoutMs:30}),g=deferred(),a=d.prepare();d.state.onClaim=()=>g.promise;
  await assert.rejects(d.commit(a),/claim_unknown/);g.resolve();await new Promise(r=>setImmediate(r));
  assert.equal(d.state.submits,0);assert.equal(d.ledger.recovered()[0].claimOnly,true);
});
test('Stop and stalled submit preserve different unknown outcomes and never replay',async t=>{
  const d=await setup(t),g=deferred(),started=deferred(),a=d.prepare();
  d.state.onClaim=()=>{started.resolve();return g.promise;};const work=d.commit(a);
  await started.promise;d.tx.invalidate();await assert.rejects(work,/claim_unknown/);
  g.resolve();await new Promise(r=>setImmediate(r));assert.equal(d.state.submits,0);
  const x=await setup(t,{timeoutMs:30}),h=deferred();x.state.onSubmit=()=>h.promise;
  await assert.rejects(x.commit(x.prepare()),/payment_unknown/);
  assert.equal(x.state.submits,1);assert.equal(x.ledger.recovered()[0].claimOnly,false);
  h.resolve();await new Promise(r=>setImmediate(r));assert.equal(x.tx.outcome,'payment_unknown');
});
test('production readiness reports exact restrictions and unconnected components',()=>{
  const r=checkoutReadiness('cityline','1.1.0');assert.equal(r.livePaymentEnabled,false);
  assert.equal(r.transactionProtocolAvailable,true);
  for(const c of ['provider_automation_restricted','checkout_profile_incomplete','live_executor_not_attached',
    'official_receipt_integration_missing','provider_permission_workflow_missing','runner_transaction_bridge_missing'])
    assert.ok(r.blockers.includes(c),c);
  assert.ok(r.missingCapabilities.includes('PAYMENT_EXECUTOR'));
  assert.ok(checkoutReadiness('cityline','upgrade').blockers.includes('unknown_or_upgraded_addon'));
});
test('only typed matching receipt evidence completes a committed attempt; purchase stays blocked',async t=>{
  const d=await setup(t);await d.commit(d.prepare());d.state.page=receiptPage(d);
  assert.throws(()=>d.ledger.confirmOfficial(d.tx.intent,{verified:true}),/Unverified receipt/);
  assert.equal(await d.tx.reconcile(),true);assert.equal(d.tx.outcome,'confirmed');
  assert.equal(d.ledger.inspection(d.tx.intent.attemptId).status,'completed');
  assert.equal(new PaymentAttemptLedger(d.folder).hasAttempt(d.permit),true);
  await assert.rejects(d.tx.reconcile(),/receipt_unavailable/);
  assert.equal(fs.readFileSync(d.ledger.journal.file,'utf8').includes('SYNTHETIC-RECEIPT-1'),false);
});
test('wrong receipt status, identity, amount or a bank challenge never proves paid',async t=>{
  const d=await setup(t);await d.commit(d.prepare());
  for(const mutate of [p=>p.receipt.status='pending',p=>p.receipt.totalMinor++,p=>p.receipt.orderId='other',
    p=>p.receipt.providerEventId='other',p=>p.receipt.providerPerformanceId='other',p=>p.receipt.quantity++,
    p=>p.receipt.currency='USD',p=>p.order.seats=['B1','B2'],p=>p.challenge='Bank authentication',p=>p.challengeType='3ds']){
    const p=receiptPage(d);mutate(p);d.state.page=p;await assert.rejects(d.tx.reconcile(),/receipt_not_verified/);
    assert.equal(d.ledger.inspection(d.tx.intent.attemptId).status,'payment_unknown');
  }
  assert.equal(d.state.submits,1);
});
test('receipt observation cannot race submit and replace its abort controller',async t=>{
  const d=await setup(t),g=deferred(),started=deferred();d.state.onSubmit=()=>{started.resolve();return g.promise;};
  const work=d.commit(d.prepare());await started.promise;d.state.page=receiptPage(d);
  await assert.rejects(d.tx.reconcile(),/receipt_unavailable/);g.resolve();await work;
  assert.equal(await d.tx.reconcile(),true);assert.equal(d.state.submits,1);
});
