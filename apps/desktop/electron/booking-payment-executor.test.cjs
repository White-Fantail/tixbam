'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {RehearsalDriver}=require('./booking/rehearsal-driver.cjs');
const {GatedMockPaymentExecutor}=require('./booking/payment-executor.cjs');
const {PaymentAttemptLedger}=require('./booking/payment-attempts.cjs');
const {canonicalOrderSignature}=require('./booking/offer-policy.cjs');
const plan={id:crypto.randomUUID(),quantity:2,budgetMinor:200000,currency:'HKD',
  requireTogether:true,allowFallback:true};
function setup(t,{clock=Date.now}={}){
  const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-ab13-'));
  t.after(()=>fs.rmSync(rootDir,{force:true,recursive:true}));
  const d=new RehearsalDriver({rootDir,plan,ownerId:'fixture-only',clock});
  return {d,rootDir};
}
async function review(d,scenario='standard'){
  await d.start(scenario,72);
  await d.next();await d.next();await d.next();
  assert.equal(d.runner.state.status,'review');
  return d.runner.state;
}
test('rehearsal uses gated payment executor with locally fenced ownership',async t=>{
  const {d}=setup(t);
  await review(d);
  assert.equal(d.runner.payment.kind,'gated-mock');
  assert.equal(d.runner.payment.verified,true);
  const lease=d.coordinator.assertOwner(d.runner.state.id,0,d.runner.state.eventKey);
  assert.equal(lease.fencingToken,1);
  assert.match(lease.leaseId,/^[0-9a-f-]{36}$/);
  await d.next({confirm:true});
  assert.equal(d.adapter.payments,1);
  assert.equal(d.runner.payment.outcome,'submitted');
  await d.next();
  assert.equal(d.runner.state.status,'completed');
  assert.equal(d.coordinator.activeCount,1);
  assert.equal(d.runner.payment.outcome,'submitted');
});
test('explicit review confirmation is required; AI or renderer cannot call mock executor through proposal',async t=>{
  const {d}=setup(t);await review(d);
  await assert.rejects(d.next(),/Confirm the fake order/);
  assert.equal(d.adapter.payments,0);
  const ex=d.runner.payment,run={...d.runner.state,phase:'READY_TO_COMMIT'};
  assert.throws(()=>ex.approveReview({run,order:d.adapter.order,confirmed:false}),
    /Mock payment was blocked/);
  assert.equal(ex.outcome,'not_started');
  assert.equal(d.runner.ledger.journal.read().length,0);
});
test('expired approval and re-priced order stop before a durable intent or charge',async t=>{
  let time=Date.now();const {d}=setup(t,{clock:()=>time});
  await review(d);
  const ex=d.runner.payment,run={...d.runner.state,phase:'READY_TO_COMMIT'};
  const approval=ex.approveReview({run,order:d.adapter.order,confirmed:true});
  time+=16000;
  assert.throws(()=>ex.prepare({run,order:d.adapter.order,expected:d.adapter.order,
    preferences:d.runner.preferences,permit:d.runner.purchasePermit,approval}),/blocked/);
  assert.equal(d.adapter.payments,0);
  assert.equal(d.runner.ledger.journal.read().length,0);
  await d.next({confirm:true});
  assert.equal(d.adapter.payments,1); // fresh human review is a new approval
});
test('scope, consent, quantity, fee, order, and lease fencing are re-validated',async t=>{
  const {d}=setup(t);await review(d);
  const run={...d.runner.state,phase:'READY_TO_COMMIT'};
  const ex=d.runner.payment;
  const approve=()=>ex.approveReview({run,order:d.adapter.order,confirmed:true});
  const base={run,order:d.adapter.order,expected:d.adapter.order,
    preferences:d.runner.preferences,permit:d.runner.purchasePermit};
  for(const mutation of [
    {permit:{...base.permit,providerId:'cityline'}},
    {permit:{...base.permit,maxAllInMinor:1}},
    {permit:{...base.permit,quantity:3}},
    {order:{...base.order,totalMinor:base.order.totalMinor+1}},
    {order:{...base.order,seats:['B1','B2']}},
    {expected:{...base.expected,feeBreakdown:{...base.expected.feeBreakdown,serviceFeeMinor:1}}},
    {run:{...run,id:crypto.randomUUID()}},
    {run:{...run,rehearsal:false}},
  ]){
    const approval=approve();
    assert.throws(()=>ex.prepare({...base,...mutation,approval}),/blocked/);
  }
  assert.equal(d.runner.ledger.journal.read().length,0);
  assert.equal(d.adapter.payments,0);
});
test('missing fsynced intent / forged attempt identity / replay cannot submit',async t=>{
  const {d}=setup(t);await review(d);
  const ex=d.runner.payment,run={...d.runner.state,phase:'READY_TO_COMMIT'};
  const approval=ex.approveReview({run,order:d.adapter.order,confirmed:true});
  const prepared=ex.prepare({run,order:d.adapter.order,expected:d.adapter.order,
    preferences:d.runner.preferences,permit:d.runner.purchasePermit,approval});
  const committing={...run,phase:'PAYMENT_COMMITTING'};
  await assert.rejects(ex.submitOnce({run:committing,order:d.adapter.order,prepared,intent:{
    runId:run.id,rehearsal:true,attemptId:crypto.randomUUID(),
    scopeDigest:'f'.repeat(64),orderDigest:'e'.repeat(64),permitDigest:'d'.repeat(64)
  }}),/blocked/);
  assert.equal(d.adapter.payments,0);
  const intent=d.runner.ledger.recordCommitIntent({
    runId:run.id,permit:d.runner.purchasePermit,order:d.adapter.order,rehearsal:true});
  await assert.rejects(ex.submitOnce({run:committing,order:d.adapter.order,prepared,
    intent:{...intent,attemptId:crypto.randomUUID()}}),/blocked/);
  assert.equal(d.adapter.payments,0);
  await ex.submitOnce({run:committing,order:d.adapter.order,prepared,intent});
  assert.equal(d.adapter.payments,1);
  await assert.rejects(ex.submitOnce({run:committing,order:d.adapter.order,prepared,intent}),/blocked/);
});
test('fence released or owner switched refuses submit without a mock charge',async t=>{
  const {d}=setup(t);await review(d);
  d.coordinator.invalidateWindow(0);
  await d.next({confirm:true});
  assert.equal(d.adapter.payments,0);
  assert.equal(d.runner.state.status,'failed');
  assert.equal(d.runner.ledger.journal.read().length,0);
});
test('two simultaneous user confirmations result in exactly one mock submit',async t=>{
  const {d}=setup(t);await review(d);
  const outcomes=await Promise.allSettled([d.next({confirm:true}),d.next({confirm:true})]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  assert.equal(d.adapter.payments,1);
  assert.equal(d.runner.ledger.journal.read().filter(x=>x.type==='COMMIT_INTENT_RECORDED').length,1);
});
test('unknown or timed-out mock response is permanently blocked after restart',async t=>{
  const {d,rootDir}=setup(t);
  await review(d,'unknown_charge');
  await d.next({confirm:true});
  assert.equal(d.adapter.payments,1);
  assert.equal(d.runner.payment.outcome,'unknown');
  assert.equal(d.runner.state.status,'payment_unknown');
  const old=d.runner.paymentIntent;
  assert.equal(d.runner.ledger.recovered().length,1);
  await d.simulateRestart();
  assert.equal(d.state.status,'payment_unknown');
  assert.equal(d.state.active,false);
  assert.equal(d.coordinator,null);
  assert.equal(d.adapter,null);
  assert.equal(new PaymentAttemptLedger(path.join(d.folder,'runs',old.runId)).recovered().length,1);
  await assert.rejects(d.next({confirm:true}),/No active rehearsal step/);
  // No merchant id / PAN / CVV / guest email written to journal.
  const raw=fs.readFileSync(path.join(d.folder,'runs',old.runId,'booking-safety','journal-v1.ndjson'),'utf8');
  for(const forbidden of ['4111111111111111','cvv','token','https://','fixture-only',plan.id])
    assert.equal(raw.includes(forbidden),false,forbidden);
});
test('3DS is manual and does not ask the Executor to bypass it',async t=>{
  const {d}=setup(t);await review(d,'bank_3ds');
  await d.next({confirm:true});
  assert.equal(d.runner.payment.outcome,'submitted');
  await d.next();
  assert.equal(d.state.status,'awaiting_user');
  assert.equal(d.adapter.payments,1);
  await d.next({completeChallenge:true});
  assert.equal(d.state.status,'completed');
  assert.equal(d.adapter.payments,1);
});
test('malicious live adapter cannot instantiate or run the gated mock executor',async()=>{
  assert.throws(()=>new GatedMockPaymentExecutor({
    adapter:{pay:()=>{throw Error('real bank request')}},
    ledger:{},coordinator:{},binding:{},
  }),/blocked/);
});
test('mock timeout cannot re-submit even if provider reply arrives late',async t=>{
  const {d}=setup(t);await review(d);
  let arrive;
  const gate=new Promise(resolve=>arrive=resolve);
  const old=d.adapter.pay.bind(d.adapter);
  d.adapter.pay=async({signal}={})=>{
    await gate;
    if(signal?.aborted)throw Error('mock deadline cancelled');
    return old({signal});
  };
  const lease=d.coordinator.assertOwner(d.runner.state.id,0,d.runner.state.eventKey);
  d.runner.payment=new GatedMockPaymentExecutor({
    adapter:d.adapter,ledger:d.runner.ledger,coordinator:d.coordinator,
    binding:lease,timeoutMs:30});
  await d.next({confirm:true});
  assert.equal(d.runner.payment.outcome,'unknown');
  assert.equal(d.runner.state.status,'payment_unknown');
  arrive();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(d.adapter.payments,0);
  assert.equal(d.runner.ledger.recovered().length,1);
  await assert.rejects(d.next({confirm:true}),/No active rehearsal step/);
});
