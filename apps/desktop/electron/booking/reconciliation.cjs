'use strict';
/** AB-14. Read-only reconciliation of durable purchase attempts.
 * Recorded human reviews are NOT official receipts, never remove a tombstone
 * and never authorize a replay. Live receipt adapters do not exist yet.
 */
const {PaymentAttemptLedger,canonicalOrder,canonicalPermit,scan}=require('./payment-attempts.cjs');
const {verifyFinalOrder}=require('./offer-policy.cjs');
const {SessionCoordinator}=require('./session-coordinator.cjs');
const FAIL=(code)=>Object.assign(new Error('Payment reconciliation unavailable'),{code});
class PaymentReconciler{
  constructor({ledger,coordinator=null,leaseReader=null}={}){
    if(!(ledger instanceof PaymentAttemptLedger)||
       coordinator!==null&&!(coordinator instanceof SessionCoordinator)||
       leaseReader!==null&&typeof leaseReader!=='function')
      throw FAIL('invalid_reconciler');
    this.ledger=ledger;this.coordinator=coordinator;this.leaseReader=leaseReader;
  }
  inspect(attemptId){
    const entry=this.ledger.inspection(attemptId);
    return Object.freeze({...entry,source:'durable_host_journal',
      merchantConfirmed:entry.status==='completed'&&!entry.requiresOfficialReceipt,
      // A matching synthetic receipt proves a test, not a real bank charge.
      recommendedAction:entry.claimOnly?'REVIEW_PURCHASE_SAFETY_CLAIM':entry.requiresOfficialReceipt?
        'CHECK_OFFICIAL_ORDER_HISTORY_MANUALLY':
        entry.status==='completed'?'MOCK_NO_CHARGE_CONFIRMED':'REVIEW_SYNTHETIC_RECEIPT',
      automaticCheckoutAllowed:false});
  }
  /** A user acknowledgement never means "safe to try payment again."
   * accountVerified must be supplied by the authenticated trusted host.
   * Offline rehearsal passes a synthetic identity only.
   */
  recordManualReview({attemptId,outcome,confirmedByUser,accountVerified=false,
    rehearsal=false}={}){
    const entry=this.ledger.inspection(attemptId);
    if(entry.status!=='payment_unknown'||entry.requiresOfficialReceipt===rehearsal)
      throw FAIL('review_scope_mismatch');
    this.ledger.reviewUnknown({attemptId,outcome,confirmedByUser,
      accountVerified,reviewer:rehearsal?'synthetic':'manual'});
    return this.inspect(attemptId);
  }
  /** Live server status is informational, fetched through a trusted,
   * already-authenticated read-only callback, NEVER based on renderer data.
   * Comparing lease/fence/status is independent of merchant receipt proof.
   */
  async checkClaim({attemptId,expectedLease,accountVerified=false}={}){
    const entry=this.inspect(attemptId);
    if(!accountVerified||!entry.requiresOfficialReceipt||
       !this.leaseReader||!expectedLease||
       typeof expectedLease.leaseId!=='string'||
       !Number.isSafeInteger(expectedLease.fencingToken)||
       expectedLease.fencingToken<1)
      throw FAIL('lease_read_not_authorized');
    let value;
    try{value=await this.leaseReader(expectedLease.leaseId);}
    catch{throw FAIL('lease_status_unavailable');}
    if(!value||value.leaseId!==expectedLease.leaseId||
       value.fencingToken!==expectedLease.fencingToken||
       value.providerId!==expectedLease.providerId||
       value.saleId!==expectedLease.saleId||
       value.performanceId!==expectedLease.performanceId||
       !['claimed','leased'].includes(value.status))
      throw FAIL('lease_fencing_or_scope_mismatch');
    return Object.freeze({
      ...entry,leaseStatus:value.status,leaseFencingToken:value.fencingToken,
      // A lease claim cannot serve as proof the merchant charged or did not.
      paymentStatus:entry.claimOnly?'not_established':'payment_unknown',merchantConfirmed:false,
      purchaseBlocked:true,automaticCheckoutAllowed:false
    });
  }
  /** Only internal synthetic ScenarioAdapter evidence is supported now.
   * In the future, official receipt verification needs a separate signed
   * provider module, account/merchant bound lookup and release review.
   */
  async verifySyntheticReceipt({attemptId,adapter,permit,order,expected,
    preferences,runId,windowId,eventKey,leaseId,fencingToken}={}){
    const {ScenarioAdapter}=require('./rehearsal-driver.cjs');
    if(!(adapter instanceof ScenarioAdapter)||!this.coordinator||
       !Number.isSafeInteger(windowId)||windowId<0||
       typeof runId!=='string'||typeof eventKey!=='string')
      throw FAIL('synthetic_adapter_only');
    const entry=this.ledger.inspection(attemptId);
    if(entry.status!=='payment_unknown'||entry.requiresOfficialReceipt)
      throw FAIL('not_reconcilable');
    const owner=this.coordinator.assertOwner(runId,windowId,eventKey);
    if(owner.leaseId!==leaseId||owner.fencingToken!==fencingToken||
       owner.status!=='leased')throw FAIL('fencing_mismatch');
    let p,o;
    try{p=canonicalPermit(permit);o=canonicalOrder(order,p);}
    catch{throw FAIL('purchase_snapshot_mismatch');}
    const pending=scan(this.ledger.journal.read()).attempts
      .find(x=>x.attemptId===attemptId);
    if(!pending||pending.runId!==runId||
       pending.scopeDigest!==this.ledger.scopeDigest(p)||
       pending.permitDigest!==this.ledger.journal.digest(['permit-v1',p])||
       pending.orderDigest!==this.ledger.journal.digest(['order-v1',o])||
       !verifyFinalOrder(order,preferences,expected,{eventKey}).ok)
      throw FAIL('purchase_snapshot_mismatch');
    // No generic HTML, AI response or human statement counts as a receipt.
    let observed;
    try{observed=await adapter.read();}catch{throw FAIL('receipt_lookup_failed');}
    if(observed?.stage!=='confirmation'||observed.eventKey!==eventKey||
       observed.challenge||observed.receipt!=='REHEARSAL-NO-CHARGE'||
       !verifyFinalOrder(observed.order,preferences,order,{eventKey}).ok)
      throw FAIL('synthetic_receipt_not_verified');
    const intent={attemptId,runId,scopeDigest:pending.scopeDigest,rehearsal:true};
    this.ledger.confirmRehearsal(intent,observed.receipt);
    return this.inspect(attemptId);
  }
  /** No official merchant integration allowlist has been approved under AB-12.
   * Deliberately no "mark paid", "mark unpaid", "retry" or "unlock" method.
   */
  async lookupOfficialReceipt(){
    throw FAIL('official_receipt_provider_unavailable');
  }
}
module.exports={PaymentReconciler};
