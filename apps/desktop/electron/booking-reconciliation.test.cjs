'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {PaymentAttemptLedger}=require('./booking/payment-attempts.cjs');
const {PaymentReconciler}=require('./booking/reconciliation.cjs');
const {RehearsalDriver}=require('./booking/rehearsal-driver.cjs');
const {SessionCoordinator}=require('./booking/session-coordinator.cjs');
const plan={id:crypto.randomUUID(),quantity:2,budgetMinor:200000,
  currency:'HKD',requireTogether:true,allowFallback:true};
function lab(t){
  const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-ab14-'));
  t.after(()=>fs.rmSync(rootDir,{recursive:true,force:true}));
  return new RehearsalDriver({rootDir,plan,ownerId:'synthetic-account'});
}
async function toReview(d,scenario='unknown_charge'){
  await d.start(scenario,2027);
  await d.next();await d.next();await d.next();
  assert.equal(d.state.status,'review');
}
async function toUnknown(d,scenario='unknown_charge'){
  await toReview(d,scenario);
  await d.next({confirm:true});
  assert.equal(d.state.status,'payment_unknown');
  assert.equal(d.state.paymentAttempts,1);
  return d.runner.paymentIntent;
}
test('HTTP 500 / response unknown is not merchant proof; recovery stays blocked',async t=>{
  const d=lab(t),intent=await toUnknown(d);
  const rec=new PaymentReconciler({ledger:d.runner.ledger});
  const state=rec.inspect(intent.attemptId);
  assert.equal(state.status,'payment_unknown');
  assert.equal(state.purchaseBlocked,true);
  assert.equal(state.automaticCheckoutAllowed,false);
  assert.equal(state.merchantConfirmed,false);
  await assert.rejects(rec.lookupOfficialReceipt(),{code:'official_receipt_provider_unavailable'});
  await assert.rejects(d.next({confirm:true}),/No active rehearsal step/);
});
test('human checked unpaid or paid NEVER clears a durable scope tombstone',async t=>{
  for(const outcome of ['reported_paid','reported_not_paid','inconclusive']){
    const d=lab(t),intent=await toUnknown(d);
    const rec=new PaymentReconciler({ledger:d.runner.ledger});
    assert.throws(()=>rec.recordManualReview({
      attemptId:intent.attemptId,outcome,confirmedByUser:true,
      rehearsal:true,accountVerified:false
    }),/unavailable/);
    assert.throws(()=>rec.recordManualReview({
      attemptId:intent.attemptId,outcome,confirmedByUser:false,
      rehearsal:true,accountVerified:true
    }),/verified_user/);
    const report=rec.recordManualReview({
      attemptId:intent.attemptId,outcome,confirmedByUser:true,
      rehearsal:true,accountVerified:true
    });
    assert.equal(report.reviewed,true);
    assert.equal(report.reviewOutcome,outcome);
    assert.equal(report.status,'payment_unknown');
    assert.equal(report.purchaseBlocked,true);
    assert.throws(()=>rec.recordManualReview({
      attemptId:intent.attemptId,outcome,confirmedByUser:true,
      rehearsal:true,accountVerified:true
    }),/review_unavailable_or_already_recorded/);
    const after=new PaymentAttemptLedger(path.dirname(path.dirname(d.runner.ledger.journal.file)));
    assert.equal(after.inspection(intent.attemptId).reviewOutcome,outcome);
    assert.equal(after.inspection(intent.attemptId).purchaseBlocked,true);
    assert.equal(after.recovered()[0].status,'payment_unknown');
    assert.throws(()=>after.recordCommitIntent({
      runId:crypto.randomUUID(),permit:d.runner.purchasePermit,order:d.adapter.order,
      rehearsal:true
    }),/duplicate_purchase_intent/);
    const bytes=fs.readFileSync(d.runner.ledger.journal.file,'utf8');
    assert.equal(bytes.includes('synthetic-account'),false);
    assert.equal(bytes.includes('example@'),false);
    assert.equal(bytes.includes('4111111111111111'),false);
    assert.equal(bytes.includes('http'),false);
    assert.equal(bytes.includes('"reviewOutcome":"'+outcome+'"'),true);
  }
});
test('manual review roundtrips across lab restart and never unlocks a checkout',async t=>{
  const d=lab(t);
  await toUnknown(d);
  assert.equal(d.state.reconciliation.reviewed,false);
  const review=await d.reviewUnknown('reported_not_paid',true);
  assert.equal(review.reconciliation.reviewed,true);
  assert.equal(review.reconciliation.reviewOutcome,'reported_not_paid');
  await assert.rejects(d.reviewUnknown('reported_paid',true),/review_unavailable_or_already_recorded/);
  await d.simulateRestart();
  assert.equal(d.state.status,'payment_unknown');
  assert.equal(d.state.reconciliation.reviewed,true);
  assert.equal(d.state.reconciliation.reviewOutcome,'reported_not_paid');
  assert.equal(d.state.reconciliation.purchaseBlocked,true);
  assert.equal(d.state.active,false);
  await assert.rejects(d.next({confirm:true}),/No active rehearsal step/);
  const recovered=new RehearsalDriver({rootDir:path.dirname(path.dirname(path.dirname(d.folder))),
    plan,ownerId:'synthetic-account'});
  assert.equal(recovered.state.status,'payment_unknown');
  assert.equal(recovered.state.reconciliation.reviewOutcome,'reported_not_paid');
});
test('synthetic receipt must be bound to exact ledger digests and trusted host lease',async t=>{
  const d=lab(t);await toReview(d,'standard');
  const run=d.runner;
  await d.next({confirm:true});
  assert.equal(d.state.status,'running');
  assert.equal(d.adapter.stage,'confirmation');
  const intent=run.paymentIntent,lease=d.coordinator.assertOwner(run.state.id,0,run.state.eventKey);
  const recon=new PaymentReconciler({ledger:run.ledger,coordinator:d.coordinator});
  const base={attemptId:intent.attemptId,adapter:d.adapter,permit:run.purchasePermit,
    order:d.adapter.order,expected:run.expected,preferences:run.preferences,
    runId:run.state.id,windowId:0,eventKey:run.state.eventKey,
    leaseId:lease.leaseId,fencingToken:lease.fencingToken};
  await assert.rejects(recon.verifySyntheticReceipt({...base,leaseId:crypto.randomUUID()}),
    {code:'fencing_mismatch'});
  await assert.rejects(recon.verifySyntheticReceipt({...base,order:{
    ...base.order,totalMinor:base.order.totalMinor+1
  }}),{code:'purchase_snapshot_mismatch'});
  await assert.rejects(recon.verifySyntheticReceipt({...base,permit:{
    ...base.permit,planId:'other'
  }}),{code:'purchase_snapshot_mismatch'});
  await assert.rejects(recon.verifySyntheticReceipt({...base,runId:crypto.randomUUID()}));
  assert.equal(recon.inspect(intent.attemptId).status,'payment_unknown');
  const confirmed=await recon.verifySyntheticReceipt(base);
  assert.equal(confirmed.status,'completed');
  assert.equal(confirmed.merchantConfirmed,true); // only synthetic no-charge
  assert.equal(confirmed.purchaseBlocked,true);
  assert.equal(new PaymentAttemptLedger(path.dirname(path.dirname(run.ledger.journal.file)))
    .inspection(intent.attemptId).status,'completed');
  await assert.rejects(recon.verifySyntheticReceipt(base),{code:'not_reconcilable'});
  assert.throws(()=>run.ledger.recordCommitIntent({runId:crypto.randomUUID(),
    permit:run.purchasePermit,order:d.adapter.order,rehearsal:true}),/duplicate_purchase_intent/);
});
test('fake receipt strings, checkout failure, and 3DS are never accepted as official proof',async t=>{
  const d=lab(t);await toReview(d,'unknown_charge');
  await d.next({confirm:true});
  const recon=new PaymentReconciler({ledger:d.runner.ledger,coordinator:d.coordinator});
  const lease=d.coordinator.assertOwner(d.runner.state.id,0,d.runner.state.eventKey);
  const base={attemptId:d.runner.paymentIntent.attemptId,adapter:d.adapter,
    permit:d.runner.purchasePermit,order:d.adapter.order,
    expected:d.runner.expected,preferences:d.runner.preferences,
    runId:d.runner.state.id,windowId:0,eventKey:d.runner.state.eventKey,
    leaseId:lease.leaseId,fencingToken:lease.fencingToken};
  await assert.rejects(recon.verifySyntheticReceipt(base),{code:'synthetic_receipt_not_verified'});
  d.adapter.stage='confirmation';d.adapter.challenge='Fake 3DS';
  await assert.rejects(recon.verifySyntheticReceipt(base),{code:'synthetic_receipt_not_verified'});
  d.adapter.challenge=null;d.adapter.order={...d.adapter.order,seats:['WRONG1','WRONG2']};
  await assert.rejects(recon.verifySyntheticReceipt(base),{code:'synthetic_receipt_not_verified'});
  const live=new PaymentReconciler({ledger:d.runner.ledger});
  await assert.rejects(live.lookupOfficialReceipt({receipt:'PAYMENT SUCCESS'}),{
    code:'official_receipt_provider_unavailable'
  });
});
test('server lease is read-only: fence and account binding, no payment inference',async t=>{
  const d=lab(t),intent=await toUnknown(d);
  const ledger=d.runner.ledger;
  const rec=new PaymentReconciler({ledger,leaseReader:async()=>({
    leaseId:'lease-1',providerId:'cityline',saleId:'sale-1',performanceId:'p-1',
    fencingToken:3,status:'claimed'
  })});
  const expectedLease={leaseId:'lease-1',fencingToken:3,
    providerId:'cityline',saleId:'sale-1',performanceId:'p-1'};
  await assert.rejects(rec.checkClaim({
    attemptId:intent.attemptId,accountVerified:true,expectedLease
  }),{code:'lease_read_not_authorized'}); // synthetic attempt cannot use real lease
  const livePermit={...d.runner.purchasePermit,providerId:'cityline',eventKey:'live-key',
    saleId:'real-sale',performanceId:'real-performance'};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-ab14-live-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const liveLedger=new PaymentAttemptLedger(dir);
  const liveOrder={...d.adapter.order,providerId:'cityline',eventKey:'live-key',
    performance:'real-performance'};
  const liveIntent=liveLedger.recordCommitIntent({
    runId:crypto.randomUUID(),permit:livePermit,order:liveOrder,rehearsal:false
  });
  const remote=new PaymentReconciler({ledger:liveLedger,leaseReader:rec.leaseReader});
  await assert.rejects(remote.checkClaim({
    attemptId:liveIntent.attemptId,expectedLease,accountVerified:false
  }),{code:'lease_read_not_authorized'});
  const status=await remote.checkClaim({
    attemptId:liveIntent.attemptId,expectedLease,accountVerified:true
  });
  assert.equal(status.leaseStatus,'claimed');
  assert.equal(status.paymentStatus,'payment_unknown');
  assert.equal(status.merchantConfirmed,false);
  assert.equal(status.automaticCheckoutAllowed,false);
  const stale=new PaymentReconciler({ledger:liveLedger,leaseReader:async()=>({
    leaseId:'lease-1',providerId:'cityline',saleId:'sale-1',performanceId:'p-1',
    fencingToken:4,status:'claimed'
  })});
  await assert.rejects(stale.checkClaim({
    attemptId:liveIntent.attemptId,expectedLease,accountVerified:true
  }),{code:'lease_fencing_or_scope_mismatch'});
});
test('journal corruption, contradictory review records and missing attempt fail closed',async t=>{
  const d=lab(t),intent=await toUnknown(d);
  assert.throws(()=>d.runner.ledger.inspection(crypto.randomUUID()),/unknown_attempt/);
  const rec=new PaymentReconciler({ledger:d.runner.ledger});
  assert.throws(()=>rec.recordManualReview({
    attemptId:intent.attemptId,outcome:'success',confirmedByUser:true,
    accountVerified:true,rehearsal:true
  }),/review_requires_verified_user/);
  await d.reviewUnknown('inconclusive',true);
  const file=d.runner.ledger.journal.file;
  fs.appendFileSync(file,'{"broken":');
  assert.throws(()=>d.runner.ledger.recovered(),/corrupt|invalid|journal|checksum|read|trunc|parse/i);
});
