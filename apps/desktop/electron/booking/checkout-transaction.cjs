'use strict';
/** Host-internal protocol, not a grant or IPC/AI tool. Production does not
 * attach it until the real provider observer/submitter is qualified. read,
 * submit and authorize must be trusted host functions, never addon callbacks.
 * No PAN/CVV, credentials, URL, raw DOM or payment input is accepted here.
 */
const {PaymentAttemptLedger,canonicalPermit,canonicalOrder}=require('./payment-attempts.cjs');
const {SessionCoordinator}=require('./session-coordinator.cjs');
const {canonicalOrderSignature,verifyFinalOrder,termsAllow}=require('./offer-policy.cjs');
const {verifyReceiptContract}=require('./receipt-contract.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const denied=code=>Object.assign(new Error('Checkout transaction blocked ('+code+').'),{code});
class CheckoutTransaction{
  #ledger;#coordinator;#binding;#permit;#preferences;#read;#submit;#authorize;
  #clock;#timeout;#approval=null;#used=false;#invalid=false;#abort=null;
  #outcome='not_started';#intent=null;#expected=null;#reconciling=false;#committing=false;
  constructor({ledger,coordinator,binding,permit,preferences,read,submit,authorize,
    clock=Date.now,timeoutMs=5000}={}){
    if(!(ledger instanceof PaymentAttemptLedger)||!(coordinator instanceof SessionCoordinator)||
       !binding||!UUID.test(binding.runId||'')||!UUID.test(binding.leaseId||'')||
       !Number.isSafeInteger(binding.windowId)||binding.windowId<0||
       !Number.isSafeInteger(binding.fencingToken)||binding.fencingToken<1||
       typeof clock!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<25||timeoutMs>5000||
       ![read,submit,authorize].every(x=>typeof x==='function'))throw denied('invalid_host_binding');
    const p=canonicalPermit(permit);
    if(p.identityVersion!==2||p.providerId!=='cityline'||p.currency!=='HKD'||!preferences||
       p.quantity!==preferences.quantity||p.maxAllInMinor!==preferences.maxTotalMinor||
       p.currency!==preferences.currency||p.checkout!==preferences.checkout||
       p.requireTogether!==preferences.requireTogether||p.allowFallback!==preferences.allowFallback||
       p.providerPerformanceId!==preferences.options?.performance||
       JSON.stringify(p.terms)!==JSON.stringify(termsAllow(preferences)))
      throw denied('unverified_purchase_identity');
    this.#ledger=ledger;this.#coordinator=coordinator;this.#binding=Object.freeze({...binding});
    this.#permit=structuredClone(p);this.#preferences=structuredClone(preferences);
    this.#read=read;this.#submit=submit;this.#authorize=authorize;
    this.#clock=clock;this.#timeout=timeoutMs;this.#owner();
  }
  #owner(claimed=false){
    if(this.#invalid||this.#abort?.signal.aborted)throw denied('cancelled');
    const b=this.#binding,p=this.#permit;
    const o=this.#coordinator.assertOwner(b.runId,b.windowId,p.eventKey);
    if(o.leaseId!==b.leaseId||o.fencingToken!==b.fencingToken||
       ['accountId','providerId','saleId','performanceId','planId','eventKey'].some(k=>o[k]!==p[k])||
       o.status!==(claimed?'claimed':'leased')||(!claimed&&o.expiresAtMs<=this.#clock()+1000)||
       (claimed&&(!UUID.test(o.guardId||'')||!UUID.test(o.claimId||''))))
      throw denied('owner_or_guard_changed');
    return o;
  }
  #checkPage(page,expected,sessionId){
    if(!page||page.stage!=='payment'||page.challenge||(page.challengeType&&page.challengeType!=='none')||
       page.eventKey!==this.#permit.eventKey||page.order?.schemaVersion!==2||
       !verifyFinalOrder(page.order,this.#preferences,expected,{eventKey:this.#permit.eventKey,
         providerId:this.#permit.providerId,performance:this.#permit.providerPerformanceId}).ok)
      throw denied('final_order_changed');
    canonicalOrder(page.order,this.#permit);
    const c=page.checkout;
    if(!c||typeof c.sessionId!=='string'||!c.sessionId||c.sessionId.length>180||
       (sessionId&&c.sessionId!==sessionId)||!Number.isSafeInteger(c.reservedUntilMs)||
       c.reservedUntilMs<=this.#clock()+1000)throw denied('checkout_expired_or_changed');
    return c;
  }
  async #allowed(){
    if(await this.#wait(Promise.resolve().then(()=>this.#authorize()))!==true)
      throw denied('capability_revoked');
  }
  async #wait(promise){
    const s=this.#abort.signal;let listener;
    try{return await Promise.race([promise,new Promise((_,reject)=>{
      listener=()=>reject(denied('cancelled_or_timed_out'));
      if(s.aborted)listener();else s.addEventListener('abort',listener,{once:true});
    })]);}finally{s.removeEventListener('abort',listener);}
  }
  prepare({run,page,confirmed=false}={}){
    if(this.#invalid||this.#used||run?.id!==this.#binding.runId||run.rehearsal!==false||
       run.windowId!==this.#binding.windowId||run.phase!=='READY_TO_COMMIT'||
       (this.#permit.checkout==='review'&&confirmed!==true))throw denied('approval_required');
    this.#owner();const c=this.#checkPage(page,page?.order);
    if(this.#ledger.hasAttempt(this.#permit))throw denied('purchase_already_latched');
    const approval=Object.freeze({signature:canonicalOrderSignature(page.order),sessionId:c.sessionId,
      expiresAtMs:Math.min(this.#clock()+15000,c.reservedUntilMs-1000)});
    this.#approval=approval;return approval;
  }
  /** Latch before await. Persist before claim and before dispatch. Late claim,
   * observer or submit replies cannot reopen the one-use submission boundary.
   */
  async commit({run,approval,expected,signal}={}){
    if(this.#used||this.#invalid||!approval||approval!==this.#approval||
       run?.id!==this.#binding.runId||run.windowId!==this.#binding.windowId||
       run.rehearsal!==false||run.phase!=='READY_TO_COMMIT'||approval.expiresAtMs<=this.#clock()||
       approval.signature!==canonicalOrderSignature(expected))throw denied('stale_or_used_approval');
    const snapshot=structuredClone(expected),runId=this.#binding.runId,windowId=this.#binding.windowId;
    this.#used=true;this.#committing=true;this.#approval=null;this.#abort=new AbortController();
    this.#expected=snapshot;const abort=()=>this.#abort.abort();
    if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,this.#timeout);let claimAttempted=false,dispatchAttempted=false;
    try{
      this.#owner();await this.#allowed();this.#owner();
      let page=await this.#wait(this.#read({signal:this.#abort.signal}));this.#owner();
      this.#checkPage(page,snapshot,approval.sessionId);
      if(approval.expiresAtMs<=this.#clock())throw denied('approval_expired');
      this.#intent=this.#ledger.recordClaimRequested({runId,permit:this.#permit,order:page.order,rehearsal:false});
      this.#owner();claimAttempted=true;this.#outcome='claim_unknown';
      await this.#wait(this.#coordinator.claimBeforeCommit(runId,windowId,this.#permit.eventKey));
      this.#owner(true);await this.#allowed();this.#owner(true);
      page=await this.#wait(this.#read({signal:this.#abort.signal}));this.#owner(true);
      const c=this.#checkPage(page,snapshot,approval.sessionId);
      if(approval.expiresAtMs<=this.#clock())throw denied('approval_expired');
      await this.#allowed();this.#owner(true);
      if(approval.expiresAtMs<=this.#clock()||c.reservedUntilMs<=this.#clock()+1000)
        throw denied('checkout_expired_or_changed');
      this.#intent=this.#ledger.recordCommitIntent({runId,permit:this.#permit,order:page.order,rehearsal:false});
      this.#owner(true);dispatchAttempted=true;this.#outcome='payment_unknown';
      // Qualified driver must recheck order/session/expiry/abort atomically
      // in its document immediately before a unique final submit control.
      await this.#wait(this.#submit({order:structuredClone(page.order),sessionId:c.sessionId,
        reservedUntilMs:Math.min(c.reservedUntilMs,approval.expiresAtMs),signal:this.#abort.signal}));
      this.#owner(true);this.#ledger.submissionReturned(this.#intent);
      this.#outcome='submitted';return this.#intent; // Not evidence of paid.
    }catch{
      this.#outcome=dispatchAttempted?'payment_unknown':claimAttempted||this.#intent?'claim_unknown':'not_submitted';
      throw denied(this.#outcome);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.#committing=false;}
  }
  async reconcile(){
    if(this.#invalid||this.#committing||this.#reconciling||!this.#intent||this.#intent.claimOnly||
       !['submitted','payment_unknown'].includes(this.#outcome))throw denied('receipt_unavailable');
    this.#reconciling=true;this.#abort=new AbortController();
    const timer=setTimeout(()=>this.#abort.abort(),this.#timeout);
    try{
      this.#owner(true);await this.#allowed();this.#owner(true);
      const page=await this.#wait(this.#read({signal:this.#abort.signal}));this.#owner(true);
      const proof=verifyReceiptContract({page,permit:this.#permit,expected:this.#expected,preferences:this.#preferences});
      this.#ledger.confirmOfficial(this.#intent,proof);this.#outcome='confirmed';return true;
    }catch{throw denied('receipt_not_verified');}
    finally{clearTimeout(timer);this.#reconciling=false;}
  }
  invalidate(){this.#invalid=true;this.#approval=null;this.#abort?.abort();}
  get outcome(){return this.#outcome;}
  get intent(){return this.#intent;}
}
module.exports={CheckoutTransaction};
