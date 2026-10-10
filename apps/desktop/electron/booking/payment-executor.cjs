'use strict';
/**
 * AB-13: zero-charge host-only PaymentExecutor. This is NOT a provider
 * integration. Offline ScenarioAdapter only; no PAN, CVV, banking network,
 * downloaded add-on or model/renderer action can reach submitOnce().
 */
const crypto=require('node:crypto');
const {canonicalOrderSignature,verifyFinalOrder}=require('./offer-policy.cjs');
const {PaymentAttemptLedger,scan}=require('./payment-attempts.cjs');
const {SessionCoordinator}=require('./session-coordinator.cjs');

const DENY=code=>Object.assign(new Error('Mock payment was blocked'),{code});
const ALLOWED_MS=15_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class GatedMockPaymentExecutor{
  #adapter;#ledger;#coordinator;#clock;#timeout;#bound;#approvals=new Map();
  #used=false;#invalid=false;#pending=false;#prepared=null;#outcome='not_started';
  constructor({adapter,ledger,coordinator,binding,clock=Date.now,timeoutMs=2000}={}){
    // Validate the actual class, not a fake "verified:true" field from an add-on.
    const {ScenarioAdapter}=require('./rehearsal-driver.cjs');
    if(!(adapter instanceof ScenarioAdapter))throw DENY('untrusted_adapter');
    if(!(ledger instanceof PaymentAttemptLedger))throw DENY('untrusted_ledger');
    if(!(coordinator instanceof SessionCoordinator))throw DENY('untrusted_coordinator');
    if(!binding||!UUID.test(binding.runId||''))throw DENY('invalid_run_binding');
    if(!Number.isSafeInteger(binding.windowId)||binding.windowId<0)
      throw DENY('invalid_window_binding');
    if(!UUID.test(binding.leaseId||''))throw DENY('invalid_lease_id');
    if(!Number.isSafeInteger(binding.fencingToken)||binding.fencingToken<1)
      throw DENY('invalid_fencing_token');
    if(typeof clock!=='function'||binding.status!=='leased'||
       binding.expiresAtMs<=clock())throw DENY('unverified_lease_status');
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<25||timeoutMs>2000)
      throw DENY('invalid_deadline');
    this.kind='gated-mock';this.verified=true;
    this.#adapter=adapter;this.#ledger=ledger;this.#coordinator=coordinator;
    this.#clock=clock;this.#timeout=timeoutMs;
    this.#bound=Object.freeze({...binding});
  }
  #owner(run){
    if(this.#invalid||!run||run.rehearsal!==true||
       run.id!==this.#bound.runId||run.windowId!==this.#bound.windowId||
       this.#bound.expiresAtMs<=this.#clock())throw DENY('mock_lease_expired');
    const current=this.#coordinator.assertOwner(run.id,run.windowId,run.eventKey);
    if(current.runId!==this.#bound.runId||
       current.windowId!==this.#bound.windowId||
       current.leaseId!==this.#bound.leaseId||
       current.fencingToken!==this.#bound.fencingToken||
       current.status!=='leased'||current.expiresAtMs<=this.#clock())
      throw DENY('fencing_token_changed');
  }
  /**
   * Only a human confirmation at ORDER_REVIEW allows the host to mint an
   * ephemeral opaque purchase approval. Never supplied by model/provider.
   */
  approveReview({run,order,confirmed}={}){
    if(confirmed!==true||run?.phase!=='READY_TO_COMMIT'||
       this.#invalid||this.#used||!order)throw DENY('purchase_approval_required');
    this.#owner(run);
    const signature=canonicalOrderSignature(order);
    if(!signature)throw DENY('unverified_final_order');
    const id=crypto.randomUUID(),expires=this.#clock()+ALLOWED_MS;
    this.#approvals.clear();
    this.#approvals.set(id,Object.freeze({runId:run.id,signature,expires,
      leaseId:this.#bound.leaseId,fence:this.#bound.fencingToken}));
    return id;
  }
  prepare({run,order,expected,preferences,permit,approval}={}){
    if(this.#used||this.#pending||this.#invalid||
       run?.phase!=='READY_TO_COMMIT'||!permit||
       permit.providerId!=='rehearsal'||permit.checkout!=='review'||
       !preferences||preferences.checkout!=='review')
      throw DENY('payment_capability_disabled');
    this.#owner(run);
    if(permit.eventKey!==run.eventKey||permit.quantity!==preferences.quantity||
       permit.currency!==preferences.currency||
       permit.maxAllInMinor!==preferences.maxTotalMinor||
       !verifyFinalOrder(order,preferences,expected,{eventKey:run.eventKey}).ok)
      throw DENY('final_order_changed');
    const auth=this.#approvals.get(approval);
    if(!auth||auth.runId!==run.id||auth.signature!==canonicalOrderSignature(order)||
       auth.expires<=this.#clock()||auth.leaseId!==this.#bound.leaseId||
       auth.fence!==this.#bound.fencingToken)throw DENY('approval_expired_or_changed');
    this.#approvals.delete(approval);
    this.#pending=true;
    this.#prepared=Object.freeze({runId:run.id,signature:auth.signature,
      approvalId:approval,leaseId:auth.leaseId,fence:auth.fence});
    return this.#prepared;
  }
  /** Durable intent must already be fsynced before this method can run.
   * A failed/timed-out submit is UNKNOWN, NEVER retryable.
   */
  async submitOnce({run,order,intent,prepared}={}){
    if(!this.#pending||this.#used||this.#invalid||!prepared||prepared!==this.#prepared||
       prepared.runId!==run?.id||run?.phase!=='PAYMENT_COMMITTING'||
       prepared.signature!==canonicalOrderSignature(order)||
       prepared.leaseId!==this.#bound.leaseId||
       prepared.fence!==this.#bound.fencingToken||
       !intent||intent.runId!==run.id||intent.rehearsal!==true||
       !UUID.test(intent.attemptId||''))
      throw DENY('unverified_commit_intent');
    // Check the actual durable journal, not merely caller-provided intent
    // object, and require absence of return/confirmation records.
    this.#owner(run);
    const records=scan(this.#ledger.journal.read()).attempts;
    const matching=records.find(e=>e.attemptId===intent.attemptId&&
      e.runId===run.id&&e.scopeDigest===intent.scopeDigest&&
      e.orderDigest===intent.orderDigest&&e.permitDigest===intent.permitDigest&&
      e.rehearsal===true&&e.status==='payment_unknown'&&!e.returned);
    if(!matching)throw DENY('missing_fsynced_intent');
    this.#used=true;this.#pending=false;this.#prepared=null;this.#outcome='unknown';
    const abort=new AbortController();
    let timer;
    // Only the trusted synthetic adapter is reachable.
    const execute=Promise.resolve().then(()=>{
      this.#owner(run);
      return this.#adapter.pay({signal:abort.signal});
    });
    try{
      const result=await Promise.race([
        execute,new Promise((_,reject)=>{
          timer=setTimeout(()=>{abort.abort();reject(DENY('mock_payment_timeout'));},this.#timeout);
        })
      ]);
      this.#owner(run);
      if(abort.signal.aborted)throw DENY('mock_payment_timeout');
      this.#outcome='submitted';
      return result;
    }catch{
      // The synthetic submit may have happened. Do not retry or claim a
      // negative payment result, even if transport reports an error.
      abort.abort();throw DENY('mock_outcome_unknown');
    }finally{clearTimeout(timer);}
  }
  verify({run,order,expected,preferences,receipt,challenge}={}){
    if(this.#outcome!=='submitted'||!this.#used||!run||
       !this.#adapter||this.#adapter.stage!=='confirmation'||
       challenge||receipt!=='REHEARSAL-NO-CHARGE')
      return false;
    try{
      this.#owner(run);
      return verifyFinalOrder(order,preferences,expected,{eventKey:run.eventKey}).ok;
    }catch{return false;}
  }
  invalidate(){this.#invalid=true;this.#prepared=null;this.#approvals.clear();}
  get outcome(){return this.#outcome;}
}
module.exports={GatedMockPaymentExecutor};
