'use strict';
// Host-only contracts. No selectors, hidden APIs, AI action callbacks, or IPC.
const crypto=require('node:crypto');
const {DurableBookingJournal}=require('./journal.cjs');
const {checkHard,canonicalOrderSignature,termsAllow}=require('./offer-policy.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const name=x=>typeof x==='string'&&x.length>0&&x.length<=160&&!/[<>\r\n]/.test(x);
const stamp=x=>Number.isSafeInteger(x)&&x>0;
const proofs=new WeakMap();
function scopeKey(scope){
  if(!scope||!['accountId','providerId','performanceId','providerEventId',
    'providerPerformanceId','eventKey','sessionId','runId'].every(k=>name(scope[k]))||
    !UUID.test(scope.runId)||!Number.isSafeInteger(scope.windowId)||scope.windowId<0||
    !Number.isSafeInteger(scope.generation)||scope.generation<1)throw Error('Invalid reservation binding');
  // Retry guard follows the canonical performance across runs and windows.
  return {accountId:scope.accountId,providerId:scope.providerId,performanceId:scope.performanceId};
}
function allocationRequest(page,prefs,scope,now=Date.now()){
  scopeKey(scope);
  const a=page?.allocation;
  if(page?.stage!=='allocation'||page.challenge||page.challengeType&&page.challengeType!=='none'||
    page.eventKey!==scope.eventKey||page.providerId!==scope.providerId||page.sessionId!==scope.sessionId||
    page.providerEventId!==scope.providerEventId||page.performance!==scope.providerPerformanceId||
    page.generation!==scope.generation||!stamp(page.observedAtMs)||
    page.observedAtMs>now||now-page.observedAtMs>5000||
    !a||a.mode!=='express'||!name(a.id)||a.available!==true||
    !Number.isSafeInteger(a.maxPerOrder)||a.maxPerOrder<1||a.maxPerOrder>100||
    !Number.isSafeInteger(prefs?.quantity)||prefs.quantity<1||prefs.quantity>20||prefs.quantity>a.maxPerOrder||
    typeof prefs.requireTogether!=='boolean'||typeof prefs.allowFallback!=='boolean'||!termsAllow(prefs)||
    !Number.isSafeInteger(prefs.maxTotalMinor)||prefs.maxTotalMinor<=0||
    prefs.currency!==a.currency||!/^[A-Z]{3}$/.test(a.currency||'')||
    prefs.options?.seatMode!=='automatic'||prefs.options.performance!==scope.providerPerformanceId||
    !Array.isArray(prefs.options.priceTier)||!prefs.options.priceTier.length||
    prefs.options.priceTier.some(x=>!name(x))||
    !prefs.options.priceTier.includes(a.priceTier)||
    prefs.allowFallback!==true&&prefs.options.priceTier[0]!==a.priceTier)
    throw Error('Allocation request not approved');
  // Unknown actual section/floor is not invented before provider allocation.
  return Object.freeze({schemaVersion:1,mode:'express',targetId:a.id,
    eventKey:scope.eventKey,providerId:scope.providerId,
    providerEventId:scope.providerEventId,performance:scope.providerPerformanceId,
    quantity:prefs.quantity,currency:prefs.currency,maxTotalMinor:prefs.maxTotalMinor,
    priceTier:a.priceTier,generation:scope.generation,
    observedAtMs:page.observedAtMs,deadlineMs:page.observedAtMs+5000});
}
// Only a trusted, reviewed provider observer may call this with parsed cart
// evidence. A seller/AI reserved:true or UI highlight is never sufficient.
function verifyReservation(page,prefs,scope,now=Date.now()){
  scopeKey(scope);
  const h=page?.hold,o=page?.order;
  if(page?.stage!=='cart'||page.challenge||page.challengeType&&page.challengeType!=='none'||
    page.eventKey!==scope.eventKey||page.providerId!==scope.providerId||
    page.sessionId!==scope.sessionId||page.generation!==scope.generation||
    !stamp(page.observedAtMs)||page.observedAtMs>now||now-page.observedAtMs>5000||
    !h||h.source!=='provider-cart'||h.status!=='held'||!name(h.reference)||
    h.orderId!==o?.id||h.providerEventId!==scope.providerEventId||
    h.performance!==scope.providerPerformanceId||
    o?.schemaVersion!==2||o.providerId!==scope.providerId||
    o.providerEventId!==scope.providerEventId||
    o.canonicalPerformanceId!==scope.performanceId||
    h.expiresAtMs!==null&&(!stamp(h.expiresAtMs)||h.expiresAtMs<=now))
    throw Error('Reservation hold unverified');
  const checked=checkHard({...o,available:true},prefs,{final:true,
    scope:{eventKey:scope.eventKey,providerId:scope.providerId,performance:scope.providerPerformanceId}});
  if(!checked.ok)throw Error('Allocated order violates preferences');
  const signature=canonicalOrderSignature(o);
  const proof=Object.freeze({});
  const cleanOrder=Object.fromEntries(['schemaVersion','id','eventKey','providerId','providerEventId',
    'canonicalPerformanceId','performance','priceTier','section','floor','fulfillment','areaId',
    'quantity','currency','totalMinor','feesIncluded','adjacent','seats','seatMode','verifiedAllocation',
    'maxPerOrder','feeBreakdown','extras','restrictedView','realNameRequired','ageRestricted',
    'accessibilityRestricted','totalVerified','availabilityVerified','identityVerified']
    .filter(k=>Object.hasOwn(o,k)).map(k=>[k,structuredClone(o[k])]));
  cleanOrder.extras=(o.extras||[]).map(e=>({id:e.id,priceMinor:e.priceMinor,selected:true}));
  proofs.set(proof,{scope:structuredClone(scope),order:cleanOrder,signature,
    reference:h.reference,expiresAtMs:h.expiresAtMs,observedAtMs:page.observedAtMs});
  return proof;
}
class ReservationLedger{
  constructor(parentDir,options={}){this.journal=new DurableBookingJournal(parentDir,options);}
  requested(scope,request,rehearsal){
    const scopeDigest=this.journal.digest(scopeKey(scope));
    const attempt={scopeDigest,runId:scope.runId,attemptId:crypto.randomUUID(),
      rehearsal:rehearsal===true,atMs:Date.now()};
    this.journal.transact(previous=>{
      if(previous.some(e=>e.scopeDigest===scopeDigest))
        throw Error('Existing reservation requires manual review before another request');
      return [{...attempt,type:'RESERVATION_REQUESTED',
        permitDigest:this.journal.digest(scope),orderDigest:this.journal.digest(request)}];
    });
    return Object.freeze(attempt);
  }
  held(attempt,proof){
    const p=proofs.get(proof);
    if(!p||p.scope.runId!==attempt.runId||
      this.journal.digest(scopeKey(p.scope))!==attempt.scopeDigest)throw Error('Unbound reservation proof');
    this.journal.transact(previous=>{
      if(!previous.some(e=>e.type==='RESERVATION_REQUESTED'&&e.attemptId===attempt.attemptId&&
        e.scopeDigest===attempt.scopeDigest&&e.runId===attempt.runId&&
        e.rehearsal===attempt.rehearsal&&e.permitDigest===this.journal.digest(p.scope))||
        previous.some(e=>e.attemptId===attempt.attemptId&&e.type!=='RESERVATION_REQUESTED'))
        throw Error('Reservation intent not active');
      return [{...attempt,atMs:Date.now(),type:'RESERVATION_HELD',
        orderDigest:this.journal.digest({signature:p.signature,reference:p.reference,
          expiresAtMs:p.expiresAtMs})}];
    });
    proofs.delete(proof);
  }
  unknown(attempt){this.journal.transact(previous=>{
    if(!previous.some(e=>e.type==='RESERVATION_REQUESTED'&&e.attemptId===attempt.attemptId&&
      e.scopeDigest===attempt.scopeDigest&&e.runId===attempt.runId&&e.rehearsal===attempt.rehearsal)||
      previous.some(e=>e.attemptId===attempt.attemptId&&e.type!=='RESERVATION_REQUESTED'))
      throw Error('Reservation intent not active');
    return [{...attempt,atMs:Date.now(),type:'RESERVATION_UNKNOWN'}];
  });}
  recovered(){
    const groups=new Map();
    for(const e of this.journal.read())if(e.type.startsWith('RESERVATION_')){
      const value=groups.get(e.attemptId)||{attemptId:e.attemptId,runId:e.runId,rehearsal:e.rehearsal};
      // A persisted held record does not prove that the merchant still holds it.
      groups.set(e.attemptId,{...value,status:'reservation_unknown',retryBlocked:true});
    }
    return [...groups.values()];
  }
}
class ReservationTransaction{
  #scope;#prefs;#ledger;#read;#allocate;#authorize;#owner;#clock;#attempt=null;
  #latched=false;#controller=null;#busy=false;#closed=false;
  constructor({scope,preferences,ledger,read,allocate,authorize,assertOwner,
    clock=Date.now,rehearsal=false,timeoutMs=5000}={}){
    scopeKey(scope);
    if(!(ledger instanceof ReservationLedger)||
      [read,allocate,authorize,assertOwner,clock].some(x=>typeof x!=='function')||
      !Number.isSafeInteger(timeoutMs)||timeoutMs<25||timeoutMs>5000)
      throw Error('Trusted reservation service required');
    this.#scope=structuredClone(scope);this.#prefs=structuredClone(preferences);
    this.#ledger=ledger;this.#read=read;this.#allocate=allocate;
    this.#authorize=authorize;this.#owner=assertOwner;this.#clock=clock;
    this.rehearsal=rehearsal===true;this.timeoutMs=timeoutMs;
  }
  invalidate(){this.#closed=true;this.#controller?.abort();}
  get requested(){return this.#attempt!==null;}
  assertBinding({runId,eventKey,windowId}){
    if(runId!==this.#scope.runId||eventKey!==this.#scope.eventKey||windowId!==this.#scope.windowId)
      throw Error('Reservation run binding changed');
  }
  async #guard(signal){
    if(this.#closed||signal.aborted)throw Error('Reservation cancelled');
    this.#owner();
    if(await this.#authorize()!==true)throw Error('Reservation permission missing');
    if(this.#closed||signal.aborted)throw Error('Reservation cancelled');
    this.#owner();
  }
  async reserve(){
    if(this.#busy||this.#latched||this.#closed)return {status:'blocked',retryBlocked:true};
    this.#busy=true;this.#latched=true; // before any awaits; never retry this instance
    const controller=this.#controller=new AbortController(),signal=controller.signal;
    let timer;
    const task=(async()=>{
      await this.#guard(signal);
      const page=await this.#read({signal});
      await this.#guard(signal);
      const request=allocationRequest(page,this.#prefs,this.#scope,this.#clock());
      this.#attempt=this.#ledger.requested(this.#scope,request,this.rehearsal);
      await this.#guard(signal);
      if(this.#clock()>=request.deadlineMs)throw Error('Allocation observation expired');
      // Reviewed driver must also check abort/deadline/generation immediately
      // before its single mutation. Timeout is not cancellation of a click.
      await this.#allocate(request,{signal});
      await this.#guard(signal);
      const cart=await this.#read({signal});
      await this.#guard(signal);
      const proof=verifyReservation(cart,this.#prefs,this.#scope,this.#clock());
      const held=proofs.get(proof);
      if(held.order.priceTier!==request.priceTier)throw Error('Allocation price tier changed');
      if(this.#clock()-held.observedAtMs>5000||
        held.expiresAtMs!==null&&held.expiresAtMs<=this.#clock())throw Error('Hold expired');
      this.#ledger.held(this.#attempt,proof);
      if(signal.aborted||this.#closed||held.expiresAtMs!==null&&held.expiresAtMs<=this.#clock())
        throw Error('Hold expired while persisting');
      return {status:'held',retryBlocked:true,reservationVerified:true,
        holdExpiresAtMs:held.expiresAtMs,holdObservedAtMs:held.observedAtMs,
        order:structuredClone(held.order)};
    })();
    const deadline=new Promise((_,reject)=>{
      timer=setTimeout(()=>{controller.abort();reject(Error('Reservation deadline'));},this.timeoutMs);
      signal.addEventListener('abort',()=>reject(Error('Reservation cancelled')),{once:true});
    });
    try{return await Promise.race([task,deadline]);}
    catch{
      controller.abort();
      if(this.#attempt){try{this.#ledger.unknown(this.#attempt);}catch{/* durable intent still blocks */}}
      return {status:this.#attempt?'reservation_unknown':'not_requested',retryBlocked:true,
        reservationVerified:false};
    }finally{clearTimeout(timer);this.#busy=false;}
  }
}
module.exports={allocationRequest,verifyReservation,ReservationLedger,ReservationTransaction};
