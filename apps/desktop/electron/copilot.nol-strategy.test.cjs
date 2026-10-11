'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizePlan,rateCandidate,planChoices,recoveryAdvice}=
  require('./copilot/nol-strategy.cjs');

const config=(changes={})=>normalizePlan({
  version:1,quantity:1,currency:'KRW',budgetMinor:140000,
  performanceId:'show-1',allowFallback:true,
  seatPreferences:{priceTier:['R','S'],section:['Main','Balcony'],floor:['1F'],seatMode:'assigned'},
  ...changes
});
const candidate=(changes={})=>({
  kind:'seat',label:'Seat A',confidence:.99,
  offer:{quantity:1,currency:'KRW',performanceId:'show-1',priceTier:'R',
    section:'Main',floor:'1F',seatMode:'assigned',allInTotalMinor:130000,
    feesIncluded:true,availability:'visibly_available'},
  ...changes
});

test('NOL-03 requires exactly 1 KRW ticket and a nonzero total budget',()=>{
  for(const c of [{quantity:2},{currency:'USD'},{budgetMinor:0}]){
    const plan=config(c);
    assert.equal(rateCandidate(plan,candidate()).status,'needs_user');
    const ranked=planChoices(plan,[candidate()]);
    assert.equal(ranked.status,'needs_user');
    assert.equal(ranked.recommended.length,0);
  }
  assert.equal(config().quantity,1);
});

test('NOL-03 sorts visually eligible candidates by approved preferences first',()=>{
  const plan=config();
  const best=candidate();
  const second=candidate({label:'Balcony',offer:{...candidate().offer,
    priceTier:'S',section:'Balcony',floor:'2F'}});
  const result=planChoices(plan,[second,best]);
  assert.deepEqual(result.recommended.map(x=>x.label),['Seat A','Balcony']);
  assert.equal(result.recommended[1].usedFallback,true);
  assert.equal(result.actionAuthorized,false);
  assert.equal(result.holdVerified,false);
});

test('NOL-03 rejects seats outside hard preferences when fallback is disabled',()=>{
  const plan=config({allowFallback:false});
  const outside=candidate({offer:{...candidate().offer,section:'Other'}});
  const result=rateCandidate(plan,outside);
  assert.equal(result.status,'reject');
  assert.match(result.reason,/section/);
  assert.equal(planChoices(plan,[outside]).recommended.length,0);
});

test('NOL-03 never changes performance identity or quantity implicitly',()=>{
  const plan=config();
  for(const bad of [
    {quantity:2},{currency:'USD'},{performanceId:'show-2'},
    {availability:'unavailable'}
  ])assert.equal(rateCandidate(plan,candidate({
    offer:{...candidate().offer,...bad}})).status,'reject');
  assert.equal(rateCandidate(plan,{
    ...candidate(),kind:'performance',
    offer:{...candidate().offer,performanceId:undefined}
  }).status,'needs_user');
});

test('NOL-03 refuses over-budget base/total and leaves unknown fees for review',()=>{
  const plan=config();
  for(const n of [140001,160000]){
    for(const feesIncluded of [true,false])
      assert.equal(rateCandidate(plan,candidate({
        offer:{...candidate().offer,allInTotalMinor:n,feesIncluded}
      })).status,'reject');
  }
  const noFeeQuote=rateCandidate(plan,candidate({offer:{
    ...candidate().offer,feesIncluded:false
  }}));
  assert.equal(noFeeQuote.status,'needs_user');
  assert.ok(noFeeQuote.unverified.includes('allInPrice'));
  assert.equal(rateCandidate(plan,candidate({offer:{
    ...candidate().offer,allInTotalMinor:undefined
  }})).status,'needs_user');
});

test('NOL-03 never converts model visual observations into automatic provider authority',()=>{
  const result=planChoices(config(),[candidate()]);
  assert.equal(result.status,'review');
  assert.equal(result.recommended[0].requiresUser,true,
    'even a full displayed price needs official verification');
  assert.equal(result.actionAuthorized,false);
  assert.equal(result.holdVerified,false);
  assert.equal(rateCandidate(config(),candidate()).actionAuthorized,false);
});

test('NOL-03 recovery is bounded, confirmation-gated, and no blind retries',()=>{
  const plan=config();
  const review=recoveryAdvice({plan,stage:'seat_conflict',previousAction:'seat'});
  assert.equal(review.action,'REOBSERVE_WITH_USER');
  assert.equal(review.autoRetry,false);
  assert.equal(recoveryAdvice({plan,stage:'sold_out',attempts:2}).action,'ASK_USER');
  assert.equal(recoveryAdvice({plan,stage:'seat_conflict',previousAction:'continue'}).action,'ASK_USER');
  assert.equal(recoveryAdvice({plan:config({allowFallback:false}),stage:'seat_conflict'}).action,'ASK_USER');
  assert.equal(recoveryAdvice({plan,stage:'checkout'}).action,'WAIT');
});

test('NOL-03 prioritizes known preferred seat data above unknown labels',()=>{
  const plan=config();
  const unknown=candidate({label:'Unknown',offer:{...candidate().offer,
    section:undefined,floor:undefined}});
  const result=planChoices(plan,[unknown,candidate()]);
  assert.equal(result.recommended[0].label,'Seat A');
  assert.equal(result.recommended[1].requiresUser,true);
});


test('NOL-03 freezes per-session preferred tier/section/floor snapshots',()=>{
  const tier=['R','S'];
  const plan=config({seatPreferences:{
    priceTier:tier,section:['Main'],floor:['1F'],seatMode:'assigned'
  }});
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.seatPreferences));
  assert.ok(Object.isFrozen(plan.seatPreferences.priceTier));
  tier[0]='Modified';
  assert.equal(plan.seatPreferences.priceTier[0],'R');
});
