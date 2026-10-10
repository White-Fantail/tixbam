'use strict';
/**
 * AB-05 — host-owned purchase intent ledger.
 *
 * An attempt is recorded and fsynced before any external submit can happen.
 * Same account + provider + actual sale/performance is single-use until
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
  return Object.freeze({
    accountId:permit.accountId,providerId:permit.providerId,
    saleId:permit.saleId,performanceId:permit.performanceId,
    eventKey:permit.eventKey,planId:permit.planId,
    quantity:permit.quantity,currency:permit.currency,maxAllInMinor:permit.maxAllInMinor,
    requireTogether:permit.requireTogether,allowFallback:permit.allowFallback,
    checkout:permit.checkout,terms,
  });
}
function canonicalOrder(order,permit){
  const normalized=normalizedOffer({...order,available:true});
  if(!normalized||normalized.providerId!==null&&normalized.providerId!==permit.providerId||
     !isString(order.id)||order.eventKey!==permit.eventKey||
     order.quantity!==permit.quantity||order.currency!==permit.currency||
     !safeInt(order.totalMinor)||order.totalMinor>permit.maxAllInMinor||
     !isString(order.performance)||order.performance!==permit.performanceId||
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
    }else if(e.type==='COMMIT_INTENT_RECORDED'){
      const run=created.get(e.runId),offer=offers.get(e.runId);
      if(!run||!offer||lastByScope.has(e.scopeDigest)||
         run.scopeDigest!==e.scopeDigest||offer.scopeDigest!==e.scopeDigest||
         run.permitDigest!==e.permitDigest||offer.orderDigest!==e.orderDigest||
         [...pending.values()].some(p=>p.attemptId===e.attemptId))
        throw new JournalUnavailable('duplicate_or_invalid_commit');
      const attempt={attemptId:e.attemptId,runId:e.runId,
        scopeDigest:e.scopeDigest,permitDigest:e.permitDigest,
        orderDigest:e.orderDigest,atMs:e.atMs,rehearsal:e.rehearsal,
        status:'payment_unknown'};
      pending.set(e.attemptId,attempt);lastByScope.set(e.scopeDigest,attempt);
    }else if(['PAYMENT_SUBMISSION_RETURNED','PAYMENT_UNKNOWN','PURCHASE_CONFIRMED'].includes(e.type)){
      const p=pending.get(e.attemptId);
      if(!p||p.runId!==e.runId||p.scopeDigest!==e.scopeDigest||
         p.rehearsal!==e.rehearsal||p.status==='completed'||
         (e.type==='PAYMENT_SUBMISSION_RETURNED'&&p.returned===true))
        throw new JournalUnavailable('invalid_payment_transition');
      if(e.type==='PAYMENT_SUBMISSION_RETURNED')p.returned=true;
      if(e.type==='PAYMENT_UNKNOWN')p.status='payment_unknown';
      if(e.type==='PURCHASE_CONFIRMED')p.status='completed';
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
    // Intentionally excludes plan and quantity to block accidental retries
    // using another plan, quantity or price for the SAME actual performance.
    return this.journal.digest(['purchase-scope-v1',p.accountId,p.providerId,
      p.saleId,p.eventKey,p.performanceId]);
  }
  hasAttempt(permit){
    const scope=this.scopeDigest(permit);
    return this.#events().byScope.has(scope);
  }
  /**
   * One exclusive transaction writes all three records and fsyncs them.
   * It returns only AFTER durable commit intent is guaranteed.
   */
  recordCommitIntent({runId,permit,order,rehearsal=false}={}){
    if(!UUID.test(runId||''))throw new JournalUnavailable('invalid_run_id');
    const p=canonicalPermit(permit);
    // A crash-after-fsync or poisoned writer is more important than an
    // ordinary duplicate: never suppress the lock / corruption warning.
    this.journal.assertWritable();
    const scope=this.scopeDigest(p);
    // A second attempt for the same account/sale/performance is denied
    // *before* examining an altered order, quantity, seats or fee model.
    // The transaction below repeats this check under the exclusive lock.
    if(this.#events().byScope.has(scope))
      throw new JournalUnavailable('duplicate_purchase_intent');
    const o=canonicalOrder(order,p);
    const permitDigest=this.journal.digest(['permit-v1',p]);
    const orderDigest=this.journal.digest(['order-v1',o]);
    const attemptId=crypto.randomUUID();
    const atMs=this.clock();
    if(!safeInt(atMs))throw new JournalUnavailable('invalid_clock');
    const batch=this.journal.transact(events=>{
      if(scan(events).byScope.has(scope))throw new JournalUnavailable('duplicate_purchase_intent');
      const base={scopeDigest:scope,runId,atMs,rehearsal:rehearsal===true};
      return [
        {...base,type:'RUN_CREATED',permitDigest},
        {...base,type:'OFFER_LOCKED',orderDigest},
        {...base,type:'COMMIT_INTENT_RECORDED',attemptId,permitDigest,orderDigest},
      ];
    });
    return Object.freeze({
      runId,attemptId,scopeDigest:scope,permitDigest,orderDigest,
      journalSequence:batch[2].seq,persistedAtMs:atMs,rehearsal:rehearsal===true
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
  recovered(){
    // Every unresolved attempt remains UNKNOWN, even if there was a returned
    // submit call. Do not infer no-charge from missing confirmation.
    return this.#events().attempts.filter(a=>a.status!=='completed')
      .map(a=>Object.freeze({
        id:'recovered-'+a.attemptId,attemptId:a.attemptId,
        status:'payment_unknown',phase:'PAYMENT_UNKNOWN',revision:0,generation:0,
        eventKey:'unverified',rehearsal:a.rehearsal,
        message:a.rehearsal
          ? 'Interrupted rehearsal attempt. No real charge was made.'
          : 'Previous payment outcome is unknown. Check the official provider order history before another purchase.',
        startedAt:a.atMs,storageRecovered:true,
      }));
  }
}
module.exports={PaymentAttemptLedger,canonicalPermit,canonicalOrder,scan};
