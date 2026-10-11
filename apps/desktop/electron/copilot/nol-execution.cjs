'use strict';
/**
 * NOL-04: OFFLINE-ONLY controlled-action + separately observed hold proof.
 * This module cannot drive Electron, navigate NOL, access live sessions, pay,
 * or turn a model's screen guess into vendor evidence.
 *
 * A future LIVE adapter needs independent provider authorization and an audited
 * offer/hold observer. The current official NOL policy does NOT grant that.
 */
const {normalizePlan,rateCandidate}=require('./nol-strategy.cjs');
const providers=new WeakSet();
const issuedEvidence=new WeakMap();
const KNOWN=new Set(['submitted_unknown','seat_conflict','sold_out','sandbox_hold_verified','expired']);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=160&&!/[<>\r\n]/.test(x);
const time=x=>Number.isSafeInteger(x)&&x>0;
function scopeKey(scope){
  if(!scope||scope.providerId!=='nol'||
     !['accountId','planId','eventId','performanceId','sessionId'].every(k=>text(scope[k]))||
     !Number.isSafeInteger(scope.windowId)||scope.windowId<1||
     !Number.isSafeInteger(scope.generation)||scope.generation<1)
    throw Error('Invalid NOL mock owner binding');
  return JSON.stringify([scope.accountId,scope.providerId,scope.performanceId]);
}
function safeResult(status,reason,extra={}){
  return Object.freeze({status,reason,simulation:true,liveHoldVerified:false,
    paymentSubmitted:false,retryBlocked:status!=='seat_conflict'&&status!=='sold_out',...extra});
}

/** In-memory test journal, retained across test-runner instances to model
 * process-level duplicate guarding; NOT crash-durable, NOT for production. */
class NolSandboxJournal {
  #rows=new Map();
  begin(scope,offerId,confirmedFallback){
    const key=scopeKey(scope),prev=this.#rows.get(key);
    if(prev){
      const allowed=confirmedFallback===true &&
        ['seat_conflict','sold_out'].includes(prev.status) &&
        prev.attempts<2 && !prev.tried.includes(offerId) &&
        prev.scope.planId===scope.planId &&
        prev.scope.sessionId===scope.sessionId &&
        prev.scope.windowId===scope.windowId &&
        prev.scope.generation===scope.generation;
      if(!allowed)throw Error('Existing NOL reservation requires manual review; duplicate request blocked');
    }
    const row={scope:{...scope},attempts:(prev?.attempts||0)+1,
      tried:[...(prev?.tried||[]),offerId],status:'submitted_unknown',offerId};
    // Write the no-retry intent synchronously BEFORE any provider mutation.
    this.#rows.set(key,row);
    return Object.freeze({key,attempts:row.attempts,offerId});
  }
  conclude(intent,status){
    if(!KNOWN.has(status))throw Error('Invalid sandbox journal transition');
    const row=this.#rows.get(intent?.key);
    if(!row||row.attempts!==intent.attempts||row.offerId!==intent.offerId||
       row.status!=='submitted_unknown')throw Error('Stale NOL reservation attempt');
    row.status=status;
  }
  view(scope){
    const row=this.#rows.get(scopeKey(scope));
    return row?Object.freeze({status:row.status,attempts:row.attempts,
      retryBlocked:!['seat_conflict','sold_out'].includes(row.status)}):null;
  }
}
class NolSandboxProvider {
  #offers;#scenario;#holds=new Map();#clock;#submissions=0;
  constructor({offers=[],scenario={},clock=Date.now}={}){
    if(!Array.isArray(offers)||typeof clock!=='function')throw Error('Invalid offline NOL fixture');
    this.#offers=offers.map(x=>structuredClone(x));
    this.#scenario={...scenario};this.#clock=clock;
    providers.add(this);
  }
  get submissions(){return this.#submissions;}
  async readOffer(id){
    return structuredClone(this.#offers.find(x=>x.id===id)||null);
  }
  async submitOnce(id,scope){
    this.#submissions++;
    const offer=this.#offers.find(x=>x.id===id);
    if(this.#scenario.throwBeforeSubmit)throw Error('Mock transport failure');
    const outcome=this.#scenario.outcome||
      (offer?.available===false?'seat_conflict':'held');
    if(['seat_conflict','sold_out'].includes(outcome)){
      this.#holds.set(scopeKey(scope),{status:outcome});
      return; // ACK is not provider confirmation.
    }
    if(outcome!=='held'||!offer)return;
    const original={
      status:'held',source:'nol-offline-provider',reference:'OFFLINE-'+this.#submissions,
      orderId:'TEST-'+this.#submissions,
      accountId:scope.accountId,providerId:scope.providerId,
      planId:scope.planId,eventId:scope.eventId,performanceId:scope.performanceId,
      sessionId:scope.sessionId,windowId:scope.windowId,generation:scope.generation,
      offerId:id,quantity:offer.quantity,currency:offer.currency,
      totalMinor:offer.totalMinor,feesIncluded:offer.feesIncluded,
      priceTier:offer.priceTier,section:offer.section,floor:offer.floor,
      seatMode:offer.seatMode,observedAtMs:this.#clock(),
      expiresAtMs:this.#clock()+(this.#scenario.holdDurationMs??60000)
    };
    this.#holds.set(scopeKey(scope),original);
    if(this.#scenario.throwAfterSubmit)throw Error('Mock response lost after submit');
  }
  async observeHold(scope){
    const row=this.#holds.get(scopeKey(scope));
    if(!row)return null;
    const snapshot=structuredClone(row);
    // A mock ACK does not supply this evidence; the separate provider READ does.
    if(this.#scenario.observationOverride)
      Object.assign(snapshot,this.#scenario.observationOverride);
    issuedEvidence.set(snapshot,{provider:this,scopeKey:scopeKey(scope),
      fingerprint:JSON.stringify(snapshot)});
    return snapshot;
  }
  verifies(evidence,scope){
    const receipt=issuedEvidence.get(evidence);
    return receipt?.provider===this && receipt.scopeKey===scopeKey(scope) &&
      receipt.fingerprint===JSON.stringify(evidence);
  }
}
function verifySandboxHold({provider,scope,plan,offer,evidence,clock=Date.now}={}){
  scopeKey(scope);
  if(!providers.has(provider)||!provider.verifies(evidence,scope)||
     !evidence||evidence.status!=='held'||evidence.source!=='nol-offline-provider'||
     !text(evidence.reference)||!text(evidence.orderId)||
     !text(evidence.offerId)||evidence.offerId!==offer?.id ||
     !['accountId','providerId','planId','eventId','performanceId',
       'sessionId','windowId','generation'].every(k=>evidence[k]===scope[k])||
     !time(evidence.observedAtMs)||evidence.observedAtMs>clock()||
     clock()-evidence.observedAtMs>5000||
     !time(evidence.expiresAtMs)||evidence.expiresAtMs<=clock()||
     evidence.quantity!==1||evidence.currency!=='KRW'||
     !Number.isSafeInteger(evidence.totalMinor)||evidence.totalMinor<0||
     evidence.totalMinor>plan.budgetMinor||evidence.feesIncluded!==true||
     evidence.totalMinor!==offer.totalMinor||evidence.quantity!==offer.quantity||
     evidence.currency!==offer.currency||evidence.feesIncluded!==offer.feesIncluded||
     evidence.priceTier!==offer.priceTier||evidence.section!==offer.section||
     evidence.floor!==offer.floor||evidence.seatMode!==offer.seatMode)
    throw Error('Independent NOL mock seat-hold proof not verified');
  return Object.freeze({mockHoldVerified:true,liveHoldVerified:false,
    holdExpiresAtMs:evidence.expiresAtMs,quantity:1,totalMinor:evidence.totalMinor,
    currency:'KRW',offerId:offer.id});
}
class NolSandboxExecutor {
  #provider;#plan;#scope;#journal;#owner;#clock;#running=false;#closed=false;
  constructor({provider,plan,scope,journal,assertOwner=()=>true,clock=Date.now}={}){
    if(!providers.has(provider)||!(journal instanceof NolSandboxJournal)||
       typeof assertOwner!=='function'||typeof clock!=='function')
      throw Error('NOL offline provider capability required; live site execution is disabled');
    scopeKey(scope);
    const validated=normalizePlan(plan);
    if(!validated||validated.quantity!==1||validated.currency!=='KRW'||
       !Number.isSafeInteger(validated.budgetMinor)||validated.budgetMinor<=0||
       validated.performanceId!==scope.performanceId)
      throw Error('One-ticket scope and verified performance are required');
    this.#provider=provider;this.#plan=validated;this.#scope=Object.freeze({...scope});
    this.#journal=journal;this.#owner=assertOwner;this.#clock=clock;
  }
  stop(){this.#closed=true;}
  #guard(){
    if(this.#closed || this.#owner(this.#scope)!==true)
      throw Error('NOL offline execution owner or session changed');
  }
  async execute({offerId,confirmedFallback=false}={}){
    if(this.#running)return safeResult('blocked','Concurrent NOL attempt blocked');
    if(!text(offerId))return safeResult('blocked','Invalid offer identity');
    this.#running=true;
    let intent;
    try {
      this.#guard();
      const offer=await this.#provider.readOffer(offerId);
      this.#guard();
      if(!offer||offer.id!==offerId||offer.providerId!=='nol'||
         offer.performanceId!==this.#scope.performanceId ||
         offer.eventId!==this.#scope.eventId||offer.available!==true ||
         offer.feesIncluded!==true ||offer.quantity!==1 ||
         offer.currency!=='KRW'||!Number.isSafeInteger(offer.totalMinor) ||
         offer.totalMinor<0||offer.totalMinor>this.#plan.budgetMinor)
        return safeResult('blocked','Provider offer is absent, stale or outside hard requirements');
      const candidate={kind:'seat',label:offer.label||'Mock seat',confidence:1,
        offer:{quantity:offer.quantity,currency:offer.currency,
          performanceId:offer.performanceId,allInTotalMinor:offer.totalMinor,
          feesIncluded:true,availability:'visibly_available',
          priceTier:offer.priceTier,section:offer.section,floor:offer.floor,
          seatMode:offer.seatMode}};
      const checked=rateCandidate(this.#plan,candidate);
      if(['reject','not_configured'].includes(checked.status)||
         (checked.unverified||[]).length)
        return safeResult('blocked','Offer is outside approved preferences or lacks details');
      this.#guard();
      intent=this.#journal.begin(this.#scope,offerId,confirmedFallback);
      this.#guard();
      // Exactly one mutation; a lost response remains UNKNOWN, never replayed.
      await this.#provider.submitOnce(offerId,this.#scope);
      this.#guard();
      const proof=await this.#provider.observeHold(this.#scope);
      this.#guard();
      if(proof?.status==='seat_conflict'||proof?.status==='sold_out'){
        if(!this.#provider.verifies(proof,this.#scope))
          throw Error('Unverified mock conflict observation');
        this.#journal.conclude(intent,proof.status);
        return safeResult(proof.status,'The provider explicitly rejected this mock seat. A different attempt requires user confirmation.',
          {retryBlocked:true,manualFallbackPossible:this.#plan.allowFallback});
      }
      if(proof?.status==='held' && this.#provider.verifies(proof,this.#scope) &&
         time(proof.expiresAtMs) && proof.expiresAtMs<=this.#clock()){
        this.#journal.conclude(intent,'expired');
        return safeResult('hold_expired',
          'Mock provider hold already expired. Reconciliation is needed; automatic retry blocked.',
          {retryBlocked:true});
      }
      const verified=verifySandboxHold({provider:this.#provider,scope:this.#scope,
        plan:this.#plan,offer,evidence:proof,clock:this.#clock});
      this.#guard();
      this.#journal.conclude(intent,'sandbox_hold_verified');
      return safeResult('sandbox_hold_verified','Provider-mock read independently confirmed the seat hold. No real NOL reservation was made.',
        {...verified,retryBlocked:true});
    }catch(error){
      // Before intent there was no provider mutation. After intent we cannot
      // distinguish submission, lost response, and a completed provider hold.
      if(!intent)return safeResult('blocked',
        'No provider request was sent. Review the owner, plan, or existing reservation.');
      return safeResult('reservation_unknown',
        'Outcome unknown or execution interrupted. Do not retry without manual reconciliation.',
        {retryBlocked:true});
    }finally{this.#running=false;}
  }
}
module.exports={NolSandboxProvider,NolSandboxJournal,NolSandboxExecutor,verifySandboxHold};
