'use strict';
/** Host-only receipt contract. Input must come from a separately qualified
 * merchant observer, never renderer/AI/user reports. Not a Cityline DOM mapper.
 */
const {verifyFinalOrder}=require('./offer-policy.cjs');
const proofs=new WeakMap();
function verifyReceiptContract({page,permit,expected,preferences}={}){
  const r=page?.receipt;
  if(!permit||permit.identityVersion!==2||page?.stage!=='confirmation'||page.challenge||
     (page.challengeType&&page.challengeType!=='none')||page.eventKey!==permit.eventKey||
     !r||r.status!=='paid'||typeof r.transactionId!=='string'||
     !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(r.transactionId)||
     r.providerId!==permit.providerId||r.providerEventId!==permit.providerEventId||
     r.providerPerformanceId!==permit.providerPerformanceId||r.orderId!==expected?.id||
     r.quantity!==permit.quantity||r.currency!==permit.currency||r.totalMinor!==expected?.totalMinor||
     page.order?.canonicalPerformanceId!==permit.performanceId||
     page.order?.providerEventId!==permit.providerEventId||
     !verifyFinalOrder(page.order,preferences,expected,{eventKey:permit.eventKey,
       providerId:permit.providerId,performance:permit.providerPerformanceId}).ok)
    throw new Error('Official receipt contract did not match the submitted purchase.');
  const proof=Object.freeze({});
  proofs.set(proof,structuredClone({permit,order:page.order,transactionId:r.transactionId}));
  return proof;
}
function consumeReceiptProof(proof){
  const evidence=proof&&proofs.get(proof);
  if(!evidence)throw new Error('Unverified receipt evidence.');
  proofs.delete(proof);return evidence;
}
module.exports={verifyReceiptContract,consumeReceiptProof};
