'use strict';
const catalog=require('../../addons/catalog.json');
const {localProfile}=require('./provider-runtime.cjs');
const REQUIRED=['LIST_OFFERS','SELECT_OFFER','READ_ORDER','PREPARE_CHECKOUT','VERIFY_ORDER','PAYMENT_EXECUTOR'];
/** Read-only host diagnosis, not an execution grant. */
function checkoutReadiness(providerId,addonVersion){
  const addon=catalog.find(x=>x.id===providerId&&x.version===addonVersion);
  const profile=localProfile(providerId,addonVersion),blockers=[];
  if(!addon||!profile)blockers.push('unknown_or_upgraded_addon');
  if(addon?.automation?.level2?.status==='restricted'||addon?.automation?.level3?.status==='restricted')
    blockers.push('provider_automation_restricted');
  const missing=REQUIRED.filter(x=>profile?.capabilities[x]!=='verified');
  if(missing.length)blockers.push('checkout_profile_incomplete');
  blockers.push('live_executor_not_attached','official_receipt_integration_missing',
    'verified_provider_performance_mapping_missing','runner_transaction_bridge_missing',
    'provider_permission_workflow_missing','host_release_not_approved');
  return Object.freeze({schemaVersion:1,providerId,addonVersion,livePaymentEnabled:false,
    blockers:Object.freeze(blockers),missingCapabilities:Object.freeze(missing),
    sourceUrl:addon?.automation?.level3?.sourceUrl||null,
    transactionProtocolAvailable:providerId==='cityline'});
}
module.exports={checkoutReadiness,REQUIRED};
