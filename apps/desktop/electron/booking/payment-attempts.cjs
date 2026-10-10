'use strict';
/**
 * AB-05 — host-owned purchase intent ledger.
 *
 * An attempt is recorded and fsynced before any external submit can happen.
 * Same account + canonical performance is single-use until
 * separately reconciled; even CONFIRMED does not authorize an automatic retry.
 * No raw event/order/seat IDs, account IDs, URLs or payment secrets are stored.
 */
const crypto=require('node:crypto');
const {DurableBookingJournal,JournalUnavailable}=require('./journal.cjs');
const {normalizedOffer,termsAllow}=require('./offer-policy.cjs');

const ISO_CURRENCIES=new Set(Intl.supportedValuesOf('currency'));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isString=v=>typeof v==='string'&&v.length>0&&v.length<=180;
const isRecord=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const safeInt=v=>Number.isSafeInteger(v)&&v>0&&v<Number.MAX_SAFE_INTEGER;

function canonicalPermit(permit){
  const terms=termsAllow(permit);
  if(!terms||!isRecord(permit)||!isString(permit.accountId)||!isString(permit.providerId)||
     !isString(permit.saleId)||!isString(permit.performanceId)||
     !isString(permit.eventKey)||!isString(permit.planId)||
     !safeInt(permit.quantity)||!safeInt(permit.maxAllInMinor)||
     typeof permit.currency!=='string'||(!/^[A-Z]{3}$/.test(permit.currency)||!ISO_CURRENCIES.has(permit.currency))||
     typeof permit.requireTogether!=='boolean'||typeof permit.allowFallback!=='boolean'||
     !['review','automatic'].includes(permit.checkout))
    throw new JournalUnavailable('invalid_purchase_intent');
  let identity={};
  if(permit.identityVersion!==undefined){
    if(permit.identityVersion!==2||!isString(permit.providerEventId)||!isString(permit.providerPerformanceId))
      throw new JournalUnavailable('invalid_provider_identity');
    identity={identityVersion:2,providerEventId:permit.providerEventId,providerPerformanceId:permit.providerPerformanceId};
  }else if(permit.providerEventId!==undefined||permit.providerPerformanceId!==undefined){
    throw new JournalUnavailable('invalid_provider_identity');
  }
  return Object.freeze({
    ...identity,accountId:permit.accountId,providerId:permit.providerId,
    saleId:permit.saleId,performanceId:permit.performanceId,
    eventKey:permit.eventKey,planId:permit.planId,
    quantity:permit.quantity,currency:permit.currency,maxAllInMinor:permit.maxAllInMinor,
    requireTogether:permit.requireTogether,allowFallback:permit.allowFallback,
    checkout:permit.checkout,terms,
  });
}
function canonicalOrder(order,permit){
  const normalized=normalizedOffer({...order,available:true});
  const identityMatches=permit.identityVersion===2
    ? order.schemaVersion===2&&order.providerId===permit.providerId&&
      order.providerEventId===permit.providerEventId&&order.canonicalPerformanceId===permit.performanceId&&
      order.performance===permit.providerPerformanceId
    : order.performance===permit.performanceId;
  if(!normalized||normalized.providerId!==null&&normalized.providerId!==permit.providerId||
     !isString(order.id)||order.eventKey!==permit.eventKey||
     order.quantity!==permit.quantity||order.currency!==permit.currency||
     !safeInt(order.totalMinor)||order.totalMinor>permit.maxAllInMinor||
     !isString(order.performance)||!identityMatches||
     !isString(order.priceTier)||order.feesIncluded!==true||
     order.available!==true||
     normalized.maxPerOrder!==null&&normalized.quantity>normalized.maxPerOrder)
    throw new JournalUnavailable('unverified_purchase_order');
  // Standing GA has no numbered adjacency to prove. Automatic allocation
  // cannot be committed with unknown final seat numbers or missing group proof.
  if(normalized.seatMode==='assigned'){
    if(typeof order.adjacent!=='boolean'||
       permit.requireTogether&&order.quantity>1&&!normalized.adjacent)
      throw new JournalUnavailable('unverified_purchase_order');
  }else if(normalized.seatMode==='automatic'){
    if(!normalized.verifiedAllocation||normalized.seats.length!==permit.quantity||
       permit.requireTogether&&order.quantity>1&&!normalized.adjacent)
      throw new JournalUnavailable('unverified_purchase_order');
  }else if(!normalized.areaId){
    throw new JournalUnavailable('unverified_purchase_order');
  }
  for(const [flag,approved] of [
    ['restrictedView','allowRestrictedView'],
    ['realNameRequired','allowRealName'],
    ['ageRestricted','allowAgeRestricted'],
    ['accessibilityRestricted','allowAccessibilityRestricted']
  ])if(normalized.flags[flag]&&!permit.terms[approved])
    throw new JournalUnavailable('unverified_purchase_order');
  if(normalized.extras.some(x=>!permit.terms.allowedExtraIds.includes(x.id)))
    throw new JournalUnavailable('unverified_purchase_order');
  // Hash all financial and material restriction terms for v2. Existing v1
  // journal entries remain append-only, and their stored hashes are not edited.
  return Object.freeze({
    ...(permit.identityVersion===2?{identityVersion:2,providerEventId:order.providerEventId,
      canonicalPerformanceId:order.canonicalPerformanceId}:{}),
    id:order.id,eventKey:order.eventKey,performance:order.performance,
    providerId:normalized.providerId,
    priceTier:order.priceTier,currency:order.currency,quantity:order.quantity,
    totalMinor:order.totalMinor,feesIncluded:true,adjacent:normalized.adjacent,
    seats:[...normalized.seats],section:normalized.section,floor:normalized.floor,
    seatMode:normalized.seatMode,areaId:normalized.areaId,
    fulfillment:normalized.fulfillment,
    feeBreakdown:normalized.feeBreakdown,extras:normalized.extras,
    flags:normalized.flags,verifiedAllocation:normalized.verifiedAllocation,
  });
}

/** Semantic check prevents a validly hashed but reordered/tampered replay
 * from being interpreted as a safe, empty or retryable journal.
 */
function scan(events){
  const pending=new Map(),lastByScope=new Map(),created=new Map(),offers=new Map();
  for(const e of events){
    if(e.type==='RUN_CREATED'){
      if(created.has(e.runId))throw new JournalUnavailable('duplicate_run');
      created.set(e.runId,e);
    }else if(e.type==='OFFER_LOCKED'){
      const run=created.get(e.runId);
      if(!run||run.scopeDigest!==e.scopeDigest||offers.has(e.runId))
        throw new JournalUnavailable('invalid_offer_transition');
      offers.set(e.runId,e);
    }else if(['CLAIM_REQUESTED','COMMIT_INTENT_RECORDED'].includes(e.type)){
      const run=created.get(e.runId),offer=offers.get(e.runId);
      const prior=lastByScope.get(e.scopeDigest);
      const upgrade=e.type==='COMMIT_INTENT_RECORDED'&&prior?.claimOnly===true&&
        prior.runId===e.runId&&prior.attemptId===e.attemptId&&
        prior.permitDigest===e.permitDigest&&prior.orderDigest===e.orderDigest&&
        prior.rehearsal===e.rehearsal&&prior.scopeVersion===2;
      if(!run||!offer||(prior&&!upgrade)||
         run.scopeDigest!==e.scopeDigest||offer.scopeDigest!==e.scopeDigest||
         run.permitDigest!==e.permitDigest||offer.orderDigest!==e.orderDigest||
         run.version!==e.version||offer.version!==e.version||
         (!upgrade&&pending.has(e.attemptId)))
        throw new JournalUnavailable('duplicate_or_invalid_commit');
      const attempt={attemptId:e.attemptId,runId:e.runId,
        scopeDigest:e.scopeDigest,permitDigest:e.permitDigest,
        orderDigest:e.orderDigest,atMs:prior?.atMs||e.atMs,rehearsal:e.rehearsal,
        scopeVersion:e.version===1?1:2,
        claimOnly:e.type==='CLAIM_REQUESTED',status:'payment_unknown'};
      pending.set(e.attemptId,attempt);lastByScope.set(e.scopeDigest,attempt);
    }else if(['PAYMENT_SUBMISSION_RETURNED','PAYMENT_UNKNOWN','PURCHASE_CONFIRMED'].includes(e.type)){
      const p=pending.get(e.attemptId);
      if(!p||p.claimOnly||p.runId!==e.runId||p.scopeDigest!==e.scopeDigest||
         p.rehearsal!==e.rehearsal||p.status==='completed'||
         (e.type==='PAYMENT_SUBMISSION_RETURNED'&&p.returned===true))
        throw new JournalUnavailable('invalid_payment_transition');
      if(e.type==='PAYMENT_SUBMISSION_RETURNED')p.returned=true;
      if(e.type==='PAYMENT_UNKNOWN')p.status='payment_unknown';
      if(e.type==='PURCHASE_CONFIRMED')p.status='completed';
    }else if(e.type==='RECONCILIATION_REVIEWED'){
      const p=pending.get(e.attemptId);
      if(!p||p.runId!==e.runId||p.scopeDigest!==e.scopeDigest||
         p.rehearsal!==e.rehearsal||p.status==='completed'||
         p.reviewed===true)
        throw new JournalUnavailable('invalid_reconciliation_transition');
      p.reviewed=true;p.reviewOutcome=e.reviewOutcome;p.reviewAtMs=e.atMs;
    }else if(e.type==='RUN_STOPPED'){
      if(!created.has(e.runId)||created.get(e.runId).scopeDigest!==e.scopeDigest)
        throw new JournalUnavailable('invalid_stop_transition');
    }
  }
  return {attempts:[...pending.values()],byScope:lastByScope};
}
class PaymentAttemptLedger{
  constructor(parentDir,options={}){
    this.journal=new DurableBookingJournal(parentDir,options);
    scan(this.journal.read());
    this.clock=typeof options.clock==='function'?options.clock:Date.now;
  }
  #events(){return scan(this.journal.read());}
  scopeDigest(permit){
    const p=canonicalPermit(permit);
    // Excludes seller, sale, event page, plan and quantity. Server-verified
    // performance identity is shared by presale/general sale and all sellers.
    return this.journal.digest(['purchase-scope-v2',p.accountId,p.performanceId]);
  }
  hasAttempt(permit){
    const scope=this.scopeDigest(permit);
    const state=this.#events();
    return state.attempts.some(a=>a.scopeVersion===1&&!a.rehearsal)||state.byScope.has(scope);
  }
  /**
   * One exclusive transaction writes all three records and fsyncs them.
   * It returns only AFTER durable commit intent is guaranteed.
   */
  recordClaimRequested(input){
    // Persist before ANY claim network call. This latch survives lost server
    // responses, signout and a crash before COMMIT_INTENT can be appended.
    if(input?.rehearsal!==false)throw new JournalUnavailable('live_claim_only');
    return this.#record(input,true);
  }
  recordCommitIntent(input){return this.#record(input,false);}
  #record({runId,permit,order,rehearsal=false},claimOnly){
    if(!UUID.test(runId||''))throw new JournalUnavailable('invalid_run_id');
    const p=canonicalPermit(permit);
    this.journal.assertWritable();
    const scope=this.scopeDigest(p);
    const existing=this.#events();
    if(existing.attempts.some(a=>a.scopeVersion===1&&!a.rehearsal))
      throw new JournalUnavailable('legacy_scope_unresolved');
    const before=existing.byScope.get(scope);
    if(before&&(claimOnly||!before.claimOnly||before.runId!==runId))
      throw new JournalUnavailable('duplicate_purchase_intent');
    const o=canonicalOrder(order,p);
    const permitDigest=this.journal.digest(['permit-v1',p]);
    const orderDigest=this.journal.digest(['order-v1',o]);
    let attemptId=crypto.randomUUID();
    const atMs=this.clock();
    if(!safeInt(atMs))throw new JournalUnavailable('invalid_clock');
    const batch=this.journal.transact(events=>{
      const state=scan(events);
      // A v1 HMAC cannot be reversed to remove seller/sale. Never reset or
      // silently reclassify real historical attempts, including confirmations.
      if(state.attempts.some(a=>a.scopeVersion===1&&!a.rehearsal))
        throw new JournalUnavailable('legacy_scope_unresolved');
      const prior=state.byScope.get(scope);
      const type=claimOnly?'CLAIM_REQUESTED':'COMMIT_INTENT_RECORDED';
      if(prior){
        if(claimOnly||!prior.claimOnly||prior.runId!==runId||
           prior.permitDigest!==permitDigest||prior.orderDigest!==orderDigest||
           prior.rehearsal!==(rehearsal===true))
          throw new JournalUnavailable('duplicate_purchase_intent');
        attemptId=prior.attemptId;
        return [{type,scopeDigest:scope,runId,atMs,rehearsal:rehearsal===true,
          attemptId,permitDigest,orderDigest}];
      }
      const base={scopeDigest:scope,runId,atMs,rehearsal:rehearsal===true};
      return [
        {...base,type:'RUN_CREATED',permitDigest},
        {...base,type:'OFFER_LOCKED',orderDigest},
        {...base,type,attemptId,permitDigest,orderDigest},
      ];
    });
    return Object.freeze({
      runId,attemptId,scopeDigest:scope,permitDigest,orderDigest,
      journalSequence:batch.at(-1).seq,persistedAtMs:atMs,
      rehearsal:rehearsal===true,claimOnly,purchaseScopeVersion:2
    });
  }
  #event(intent,type,extra={}){
    if(!isRecord(intent)||!UUID.test(intent.attemptId||'')||
       !UUID.test(intent.runId||'')||
       !/^[0-9a-f]{64}$/.test(intent.scopeDigest||''))
      throw new JournalUnavailable('invalid_commit_reference');
    const atMs=this.clock();
    this.journal.transact(events=>{
      const current=scan(events).attempts.find(a=>a.attemptId===intent.attemptId);
      if(!current||current.runId!==intent.runId||
         current.scopeDigest!==intent.scopeDigest||
         current.rehearsal!==(intent.rehearsal===true))
        throw new JournalUnavailable('unknown_commit');
      if(current.claimOnly)throw new JournalUnavailable('invalid_payment_transition');
      if(current.status==='completed')throw new JournalUnavailable('already_completed');
      if(type==='PAYMENT_SUBMISSION_RETURNED'&&current.returned)
        throw new JournalUnavailable('already_recorded');
      return [{type,atMs,scopeDigest:current.scopeDigest,runId:intent.runId,
        attemptId:intent.attemptId,rehearsal:current.rehearsal,...extra}];
    });
  }
  submissionReturned(intent){this.#event(intent,'PAYMENT_SUBMISSION_RETURNED');}
  markUnknown(intent){this.#event(intent,'PAYMENT_UNKNOWN');}
  /**
   * AB-05 cannot authenticate official bank/merchant receipts. Only a
   * synthetic rehearsal proof is accepted. Real confirmation requires AB-14.
   */
  confirmRehearsal(intent,receipt){
    if(intent?.rehearsal!==true||receipt!=='REHEARSAL-NO-CHARGE')
      throw new JournalUnavailable('receipt_not_verified');
    this.#event(intent,'PURCHASE_CONFIRMED',{
      receiptDigest:this.journal.digest(['rehearsal-receipt-v1',receipt,intent.attemptId]),
    });
  }
  /** Typed host evidence closes a committed attempt, not a release grant.
   * Production still requires an independently qualified provider observer.
   */
  confirmOfficial(intent,proof){
    const {consumeReceiptProof}=require('./receipt-contract.cjs');
    const evidence=consumeReceiptProof(proof),p=canonicalPermit(evidence.permit);
    const o=canonicalOrder(evidence.order,p);
    const attempt=this.#events().attempts.find(a=>a.attemptId===intent?.attemptId);
    if(!attempt||attempt.rehearsal||attempt.claimOnly||attempt.runId!==intent.runId||
       attempt.scopeDigest!==this.scopeDigest(p)||
       attempt.permitDigest!==this.journal.digest(['permit-v1',p])||
       attempt.orderDigest!==this.journal.digest(['order-v1',o]))
      throw new JournalUnavailable('receipt_not_verified');
    this.#event(intent,'PURCHASE_CONFIRMED',{
      receiptDigest:this.journal.digest(['official-receipt-contract-v1',evidence.transactionId,
        attempt.attemptId,attempt.orderDigest]),
    });
  }
  /** AB-14: human can record that they checked official order history.
   * This is NOT merchant evidence, never clears the durable purchase tombstone.
   * A single review is fsynced and cannot be rewritten to create false proof.
   */
  reviewUnknown({attemptId,outcome,confirmedByUser=false,accountVerified=false,reviewer='manual'}={}){
    if(!UUID.test(attemptId||'')||
       !['reported_paid','reported_not_paid','inconclusive'].includes(outcome)||
       confirmedByUser!==true||accountVerified!==true||
       !['manual','synthetic'].includes(reviewer))
      throw new JournalUnavailable('review_requires_verified_user');
    const atMs=this.clock();
    if(!safeInt(atMs))throw new JournalUnavailable('invalid_clock');
    return this.journal.transact(events=>{
      const p=scan(events).attempts.find(x=>x.attemptId===attemptId);
      if(!p||p.status!=='payment_unknown'||p.reviewed)
        throw new JournalUnavailable('review_unavailable_or_already_recorded');
      if(p.rehearsal!== (reviewer==='synthetic'))
        throw new JournalUnavailable('wrong_reconciliation_mode');
      return [{
        type:'RECONCILIATION_REVIEWED',scopeDigest:p.scopeDigest,
        runId:p.runId,attemptId:p.attemptId,rehearsal:p.rehearsal,
        atMs,reviewOutcome:outcome,
        reviewDigest:this.journal.digest([
          'manual-review-v1',p.scopeDigest,p.attemptId,outcome,atMs,reviewer
        ])
      }];
    });
  }
  inspection(attemptId){
    if(!UUID.test(attemptId||''))throw new JournalUnavailable('invalid_attempt');
    const p=this.#events().attempts.find(x=>x.attemptId===attemptId);
    if(!p)throw new JournalUnavailable('unknown_attempt');
    return Object.freeze({
      attemptId:p.attemptId,status:p.status,
      reviewOutcome:p.reviewOutcome||null,reviewed:p.reviewed===true,
      reviewAtMs:p.reviewAtMs||null,
      requiresOfficialReceipt:!p.rehearsal,
      purchaseBlocked:true, // confirmed also remains single-use
      noAutomaticRetry:true,
      claimOnly:p.claimOnly,legacyScopeUnresolved:p.scopeVersion===1&&!p.rehearsal
    });
  }
  recovered(){
    // Every unresolved attempt remains UNKNOWN, even if there was a returned
    // submit call. Do not infer no-charge from missing confirmation.
    return this.#events().attempts.filter(a=>a.status!=='completed'||a.scopeVersion===1&&!a.rehearsal)
      .map(a=>Object.freeze({
        id:'recovered-'+a.attemptId,attemptId:a.attemptId,
        status:'payment_unknown',phase:'PAYMENT_UNKNOWN',revision:0,generation:0,
        eventKey:'unverified',rehearsal:a.rehearsal,
        message:a.claimOnly
          ? 'Purchase safety claim needs review. Payment submission is not established; automatic retry is blocked.'
          : a.scopeVersion===1&&!a.rehearsal
          ? 'Legacy purchase scope cannot be verified. Automatic payment remains blocked.'
          : a.rehearsal
          ? 'Interrupted rehearsal attempt. No real charge was made.'
          : 'Previous payment outcome is unknown. Check the official provider order history before another purchase.',
        startedAt:a.atMs,storageRecovered:true,
        claimOnly:a.claimOnly,legacyScopeUnresolved:a.scopeVersion===1&&!a.rehearsal,
        safetyRecoveryRequired:a.claimOnly||a.scopeVersion===1&&!a.rehearsal,
        reviewed:a.reviewed===true,reviewOutcome:a.reviewOutcome||null,
      }));
  }
}
module.exports={PaymentAttemptLedger,canonicalPermit,canonicalOrder,scan};
