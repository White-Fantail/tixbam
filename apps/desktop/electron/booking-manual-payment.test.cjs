'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {BookingRunner}=require('./booking/runner.cjs');
const {checkoutReadiness}=require('./booking/checkout-readiness.cjs');
const prefs={quantity:1,maxTotalMinor:100000,currency:'HKD',requireTogether:true,
  allowFallback:false,checkout:'review',options:{performance:'p1',priceTier:['800'],section:[],floor:[]}};
const order={id:'order1',eventKey:'event1',quantity:1,currency:'HKD',totalMinor:83500,
  feesIncluded:true,adjacent:true,priceTier:'800',performance:'p1',seats:['A1']};
test('user payment handoff clears secrets and never resumes reads, selection, reservation or payment',async()=>{
  let reads=0,clears=0;
  const r=new BookingRunner({eventKey:'event1',preferences:prefs,rehearsal:true,
    adapter:{read:async()=>{reads++;return {eventKey:'event1',stage:'payment',order};},
      reserve:()=>assert.fail('no reservation after takeover'),pay:()=>assert.fail('no payment')},
    secret:{clear(){clears++;},use(){assert.fail('no card access');}}});
  await r.step();assert.equal(r.state.phase,'MANUAL_PAYMENT');
  assert.equal(r.state.reservationVerified,false);assert.equal(r.submitted,false);
  assert.deepEqual(r.state.order,order);assert.equal(clears,1);
  await Promise.all([r.step(),r.step(true),r.step()]);assert.equal(reads,1);
  assert.notEqual(r.state.status,'completed');r.stop();assert.equal(r.state.status,'stopped');
});
test('invalid order never reaches payment handoff',async()=>{
  const r=new BookingRunner({eventKey:'event1',preferences:prefs,rehearsal:true,
    adapter:{read:async()=>({eventKey:'event1',stage:'payment',order:{...order,totalMinor:200000}})}});
  await r.step();assert.equal(r.state.phase,'WAITING_FOR_USER');assert.equal(r.state.manualPayment,undefined);
});
test('provider selection and payment support remain separate and restricted automation stays blocked',()=>{
  const result=checkoutReadiness('cityline','1.1.0');
  assert.equal(result.paymentMode,'user');assert.equal(result.selectionStatus,'restricted');
  assert.equal(result.paymentStatus,'restricted');assert.equal(result.livePaymentEnabled,false);
});
