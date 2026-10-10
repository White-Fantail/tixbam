'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizedOffer,checkHard,rankOffers,verifyFinalOrder,
  canonicalOrderSignature}=require('./booking/offer-policy.cjs');
const {chooseOffer,validOrder,validatePreferences}=require('./booking/preferences.cjs');
const {schemaFor}=require('./booking/cityline.cjs');
const catalog=require('../addons/catalog.json');

const defaults={
  schemaVersion:1,quantity:2,maxTotalMinor:30000,currency:'HKD',
  requireTogether:true,allowFallback:true,checkout:'review',
  options:{performance:'evening',priceTier:['VIP','A','B'],
    section:['Front','Balcony'],floor:['Lower','Upper'],seatMode:'',fulfillment:''}
};
const sum=(subtotal=18000,service=1200,tax=500,delivery=300,extras=0)=>({
  ticketSubtotalMinor:subtotal,serviceFeeMinor:service,
  taxMinor:tax,deliveryFeeMinor:delivery,extrasMinor:extras
});
const base=(patch={})=>({
  schemaVersion:2,id:'a',eventKey:'demo-event',providerId:'cityline',
  performance:'evening',priceTier:'VIP',section:'Front',floor:'Lower',
  seatMode:'assigned',fulfillment:'eticket',seats:['A1','A2'],adjacent:true,
  quantity:2,currency:'HKD',totalMinor:20000,feesIncluded:true,
  available:true,feeBreakdown:sum(),
  restrictedView:false,realNameRequired:false,ageRestricted:false,
  accessibilityRestricted:false,verifiedAllocation:false,
  totalVerified:true,availabilityVerified:true,identityVerified:true,
  ...patch
});
const scope={providerId:'cityline',eventKey:'demo-event',performance:'evening'};
test('strict v2 all-in quote reconciles each fee and forbids unknown/missing charges',()=>{
  assert.equal(checkHard(base(),defaults).ok,true);
  for(const patch of [
    {totalMinor:19999},{totalMinor:20001},{feesIncluded:false},
    {feeBreakdown:undefined},{feeBreakdown:sum(18000,1200,500,299)},
    {feeBreakdown:{...sum(),taxMinor:null}},
    {feeBreakdown:{...sum(),deliveryFeeMinor:NaN}},
    {feeBreakdown:{...sum(),serviceFeeMinor:-1}},
    {feeBreakdown:{...sum(),extrasMinor:1}},
    {feeBreakdown:{...sum(),someUnknownFee:0}},
    {feeBreakdown:{...sum(),ticketSubtotalMinor:Infinity}},
    {totalVerified:false},{availabilityVerified:false},{identityVerified:false},
    {totalVerified:undefined},{available:false}
  ])assert.equal(checkHard(base(patch),defaults).ok,false,JSON.stringify(patch));
  assert.equal(checkHard(base(),{...defaults,maxTotalMinor:19999}).ok,false);
  assert.equal(normalizedOffer(base({totalMinor:20000.1})),null);
  assert.equal(normalizedOffer(base({currency:'NZD'}))?.currency,'NZD');
  assert.equal(checkHard(base({currency:'NZD'}),defaults).ok,false);
  assert.equal(checkHard(base({maxPerOrder:1}),defaults).code,'SALE_LIMIT');
});
test('assigned adjacency is mandatory only for multiple tickets and exact seats',()=>{
  assert.equal(checkHard(base({adjacent:false}),defaults).code,'NON_ADJACENT');
  assert.equal(checkHard(base({seats:['A1','A1']}),defaults).ok,false);
  assert.equal(checkHard(base({seats:['A1']}),defaults).ok,false);
  const single={...defaults,quantity:1};
  assert.equal(checkHard(base({quantity:1,seats:['A1'],adjacent:undefined}),single).ok,true);
  assert.equal(checkHard(base({adjacent:false}),{...defaults,requireTogether:false}).ok,true);
});
test('standing / general admission needs zone, not invented numbered adjacency',()=>{
  const ga=base({seatMode:'standing',section:'GA',areaId:'PIT',
    seats:[],adjacent:undefined,verifiedAllocation:false});
  const opts={...defaults,options:{...defaults.options,section:[],floor:[],
    seatMode:'standing'}};
  assert.equal(checkHard(ga,opts).ok,true);
  assert.equal(verifyFinalOrder(ga,opts,ga,scope).ok,true);
  assert.equal(checkHard({...ga,areaId:undefined,section:undefined},opts).ok,false);
  assert.equal(checkHard({...ga,seatMode:'assigned'},opts).ok,false);
  assert.equal(checkHard({...ga,seatMode:'automatic'},opts).ok,false);
});
test('automatic seat allocation uses evidence; pending allocation may be reviewed but never paid',()=>{
  const auto=base({seatMode:'automatic',seats:[],adjacent:undefined,
    verifiedAllocation:false});
  const prefs={...defaults,requireTogether:false,options:{
    ...defaults.options,seatMode:'automatic'
  }};
  assert.equal(checkHard(auto,prefs).ok,true);
  assert.equal(verifyFinalOrder(auto,prefs,auto).code,'ALLOCATION_UNKNOWN');
  assert.equal(checkHard(auto,{...prefs,requireTogether:true}).code,'AUTO_ADJACENCY_UNKNOWN');
  const verified=base({seatMode:'automatic',verifiedAllocation:true,adjacent:true});
  assert.equal(checkHard(verified,{...prefs,requireTogether:true}).ok,true);
  assert.equal(verifyFinalOrder(verified,{...prefs,requireTogether:true},verified).ok,true);
  const autoPartial=base({seatMode:'automatic',verifiedAllocation:true,seats:[]});
  assert.equal(verifyFinalOrder(autoPartial,prefs,autoPartial).code,'ALLOCATION_UNKNOWN');
  assert.equal(checkHard(base({ticketMode:'auto_allocated',seatMode:undefined,
    verifiedAllocation:true}),{...prefs,requireTogether:true}).ok,true);
});
test('restricted view, real name, age and accessibility conditions require explicit consent',()=>{
  for(const [field,allow] of [
    ['restrictedView','allowRestrictedView'],
    ['realNameRequired','allowRealName'],
    ['ageRestricted','allowAgeRestricted'],
    ['accessibilityRestricted','allowAccessibilityRestricted']
  ]){
    const item=base({[field]:true});
    assert.equal(checkHard(item,defaults).code,'CONSENT_REQUIRED',field);
    const approved={...defaults,terms:{[allow]:true}};
    assert.equal(checkHard(item,approved).ok,true,field);
  }
  assert.equal(checkHard(base({realNameRequired:null}),defaults).ok,false);
  assert.equal(checkHard(base({ageRestricted:undefined}),defaults).ok,false);
  assert.equal(checkHard(base({restrictedView:true,ageRestricted:true}),
    {...defaults,terms:{allowRestrictedView:true}}).code,'CONSENT_REQUIRED');
});
test('unrequested insurance, subscription or extras rejected even if all-in matches',()=>{
  const e=base({totalMinor:20500,feeBreakdown:sum(18000,1200,500,300,500),
    extras:[{id:'insurance',priceMinor:500,selected:true}]});
  assert.equal(checkHard(e,defaults).code,'UNAPPROVED_EXTRA');
  assert.equal(checkHard(e,{...defaults,terms:{allowedExtraIds:['insurance']}}).ok,true);
  assert.equal(checkHard({...e,extras:[{id:'insurance',priceMinor:501,selected:true}]},
    {...defaults,terms:{allowedExtraIds:['insurance']}}).ok,false);
  assert.equal(checkHard({...e,extras:[{id:'insurance',priceMinor:500,selected:false}]},
    defaults).ok,false);
  const opt={...defaults,terms:{allowedExtraIds:['insurance']}};
  assert.equal(verifyFinalOrder({...e,extras:[{id:'subscription',priceMinor:500,selected:true}]},
    opt,e).ok,false);
});
test('ranking honors explicit fallback order ahead of cheapest and stable ties',()=>{
  const a=base({id:'a',priceTier:'A',totalMinor:12000,feeBreakdown:sum(10000,1000,500,500)});
  const b=base({id:'b',priceTier:'VIP'});
  const c=base({id:'c',priceTier:'VIP',section:'Balcony',floor:'Upper',
    totalMinor:5000,feeBreakdown:sum(3500,700,500,300)});
  const d=base({id:'d',priceTier:'VIP'});
  assert.deepEqual(rankOffers([a,c,d,b],defaults,scope).map(x=>x.id),
    ['b','d','c','a']);
  assert.deepEqual(rankOffers([d,b],defaults,scope).map(x=>x.id),['b','d']);
  assert.equal(chooseOffer([a,b],defaults),b);
  assert.equal(chooseOffer([a],{...defaults,allowFallback:false}),null);
  assert.equal(chooseOffer([a],defaults),a);
  assert.equal(chooseOffer([b],{...defaults,options:{...defaults.options,
    section:['Wrong']} }),null);
});
test('provider/event/performance binding never accepts another ticket agent or session',()=>{
  assert.equal(checkHard(base(),defaults,{scope}).ok,true);
  for(const delta of [
    {providerId:'ticketmaster'},{eventKey:'wrong'},{performance:'day2'}
  ])assert.equal(checkHard(base(delta),defaults,{scope}).code,'WRONG_EVENT');
  assert.equal(checkHard(base({providerId:'nol'}),defaults,{scope:null}).ok,true);
  // Policy evaluation alone is not permission to automate an external vendor.
});
test('checkout refresh freezes price, add-on, mode and all exact seat identity fields',()=>{
  const before=base();assert.equal(validOrder(before,defaults,before,scope),true);
  for(const patch of [
    {id:'other'},{eventKey:'other'},{providerId:'nol'},{totalMinor:20001},
    {feeBreakdown:sum(18000,1199,501,300)},{seats:['B1','B2']},
    {seatMode:'automatic',verifiedAllocation:true},
    {section:'Balcony'},{floor:'Upper'},{fulfillment:'delivery'},
    {restrictedView:true},{realNameRequired:true},{ageRestricted:true},
    {maxPerOrder:2},{verifiedAllocation:true}
  ]){
    const result=verifyFinalOrder(base(patch),defaults,before,scope);
    assert.equal(result.ok,false,JSON.stringify(patch));
  }
  const newPrice=base({totalMinor:20500,feeBreakdown:sum(18000,1200,500,800)});
  assert.equal(validOrder(newPrice,defaults,before,scope),false);
});
test('legacy v1 API retains object identity and requires all-in known total',()=>{
  const old={id:'order1',eventKey:'event1',quantity:2,currency:'HKD',
    totalMinor:167000,feesIncluded:true,adjacent:true,available:true,
    priceTier:'800',performance:'p1',seats:['A1','A2']};
  const prefs={...defaults,maxTotalMinor:200000,options:{...defaults.options,
    performance:'p1',priceTier:['800','500'],section:[],floor:[]}};
  assert.equal(chooseOffer([old],prefs),old);
  assert.equal(validOrder(old,prefs,old),true);
  for(const patch of [{feesIncluded:false},{totalMinor:null},{available:false},
    {adjacent:false},{seats:[]},{totalMinor:200001}]){
    assert.equal(chooseOffer([{...old,...patch}],prefs),null);
  }
});
test('legacy Cityline schema and preferences round-trip without implicit risky consent',()=>{
  const cityline=require('../addons/catalog.json').find(a=>a.id==='cityline');
  const schema=schemaFor(cityline,{options:{performance:[{id:'p',label:'P'}],
    priceTier:[{id:'VIP',label:'VIP'}]}});
  const input={...defaults,maxTotalMinor:20000,options:{
    performance:'p',priceTier:['VIP'],section:[],floor:[],seatMode:'',fulfillment:''}};
  const parsed=validatePreferences(input,schema);
  assert.equal(Object.hasOwn(parsed,'terms'),false);
  assert.throws(()=>validatePreferences({...input,terms:{allowRealName:'yes'}},schema));
  assert.throws(()=>validatePreferences({...input,terms:{allowedExtraIds:['x','x']}},schema));
  const opt=validatePreferences({...input,terms:{
    allowRestrictedView:true,allowRealName:false,allowedExtraIds:['insurance']
  }},schema);
  assert.equal(opt.terms.allowRestrictedView,true);
  assert.deepEqual(opt.terms.allowedExtraIds,['insurance']);
});
test('unknown identity, amounts and suspicious objects never reach candidate ranking',()=>{
  const weird={...base(),totalMinor:Number.MAX_SAFE_INTEGER+1};
  assert.equal(normalizedOffer(weird),null);
  assert.equal(normalizedOffer({...base(),schemaVersion:99}),null);
  assert.equal(normalizedOffer({...base(),seats:['A1','A2'],priceTier:'<script>'}),null);
  assert.equal(normalizedOffer({...base(),seats:null}),null);
  assert.equal(checkHard(base({maxPerOrder:1}),defaults).ok,false);
  assert.equal(chooseOffer([base({available:false}),base()],defaults).id,'a');
  assert.deepEqual(rankOffers(new Array(101).fill(base()),defaults),[]);
});


test('v2 requires actual ticket agent, session and verified delivery evidence',()=>{
  for(const patch of [
    {providerId:undefined},{performance:undefined},
    {priceTier:undefined},{fulfillment:undefined}
  ]) assert.equal(normalizedOffer(base(patch)),null);
  assert.equal(checkHard(base(),defaults,{scope}).ok,true);
  assert.equal(checkHard(base({providerId:'nol'}),defaults,{scope}).ok,false);
});
test('durable journal binds v2 fee, identity, GA and optional extras to the permit',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
  const {PaymentAttemptLedger}=require('./booking/payment-attempts.cjs');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-offer-ledger-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const runId=crypto.randomUUID();
  const permit={accountId:'account',providerId:'cityline',saleId:'sale',
    performanceId:'evening',eventKey:'demo-event',planId:'plan',
    quantity:2,currency:'HKD',maxAllInMinor:30000,requireTogether:true,
    allowFallback:true,checkout:'review'};
  const ledger=new PaymentAttemptLedger(folder);
  const ga=base({seatMode:'standing',areaId:'GA-A',section:'GA-A',
    adjacent:undefined,seats:[]});
  assert.doesNotThrow(()=>ledger.recordCommitIntent({runId,permit,order:ga,rehearsal:true}));
  assert.equal(ledger.recovered().length,1);
  assert.equal(ledger.journal.read().length,3);
  const log=fs.readFileSync(ledger.journal.file,'utf8');
  for(const data of ['GA-A','demo-event','cityline','ticketSubtotalMinor','serviceFeeMinor'])
    assert.equal(log.includes(data),false,data);
  const wrongSeller=base({providerId:'other-agent'});
  const ledger2=new PaymentAttemptLedger(folder+'-separate');
  assert.throws(()=>ledger2.recordCommitIntent({
    runId:crypto.randomUUID(),permit,order:wrongSeller,rehearsal:true
  }),/unverified_purchase_order/);
});
