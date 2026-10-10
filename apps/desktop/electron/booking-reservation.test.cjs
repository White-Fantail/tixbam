'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {allocationRequest,verifyReservation,ReservationLedger,ReservationTransaction}=require('./booking/reservation.cjs');
const {RehearsalDriver}=require('./booking/rehearsal-driver.cjs');
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-reservation-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const scope={accountId:'a1',providerId:'test',performanceId:'canonical-p1',
    providerEventId:'e1',providerPerformanceId:'p1',eventKey:'event1',
    sessionId:'session1',runId:crypto.randomUUID(),windowId:1,generation:1};
  const prefs={quantity:2,maxTotalMinor:200000,currency:'HKD',requireTogether:true,
    allowFallback:false,checkout:'review',options:{performance:'p1',seatMode:'automatic',priceTier:['800'],section:[],floor:[]}};
  const now=Date.now();
  const page={stage:'allocation',eventKey:'event1',providerId:'test',providerEventId:'e1',
    performance:'p1',sessionId:'session1',generation:1,observedAtMs:now,challengeType:'none',
    allocation:{id:'target1',mode:'express',available:true,maxPerOrder:4,currency:'HKD',priceTier:'800'}};
  const order={schemaVersion:2,id:'order1',eventKey:'event1',providerId:'test',providerEventId:'e1',
    canonicalPerformanceId:'canonical-p1',performance:'p1',priceTier:'800',fulfillment:'eticket',
    quantity:2,currency:'HKD',totalMinor:167000,feesIncluded:true,seats:['A1','A2'],
    seatMode:'automatic',verifiedAllocation:true,adjacent:true,totalVerified:true,
    availabilityVerified:true,identityVerified:true,restrictedView:false,realNameRequired:false,
    ageRestricted:false,accessibilityRestricted:false,extras:[],
    feeBreakdown:{ticketSubtotalMinor:160000,serviceFeeMinor:7000,taxMinor:0,deliveryFeeMinor:0,extrasMinor:0}};
  const cart={...page,stage:'cart',order,hold:{source:'provider-cart',status:'held',reference:'PRIVATE-HOLD',
    orderId:'order1',providerEventId:'e1',performance:'p1',expiresAtMs:now+120000}};
  const ledger=new ReservationLedger(dir);
  return {dir,scope,prefs,page,order,cart,now,ledger};
}
test('Express request has no fabricated seats/fees and requires explicit automatic allocation choice',t=>{
  const f=setup(t),r=allocationRequest(f.page,f.prefs,f.scope,f.now);
  assert.equal(r.quantity,2);assert.equal(r.maxTotalMinor,200000);
  assert.equal(r.seats,undefined);assert.equal(r.totalMinor,undefined);
  for(const change of [{sessionId:'other'},{generation:2},{performance:'other'},
    {observedAtMs:f.now-5001},{observedAtMs:f.now+1},{challenge:'captcha'}])
    assert.throws(()=>allocationRequest({...f.page,...change},f.prefs,f.scope,f.now));
  for(const prefs of [{...f.prefs,quantity:21},{...f.prefs,quantity:5},
    {...f.prefs,options:{...f.prefs.options,seatMode:'assigned'}},
    {...f.prefs,options:{...f.prefs.options,priceTier:['500','800']}}])
    assert.throws(()=>allocationRequest(f.page,prefs,f.scope,f.now));
});
test('held proof requires strict cart identity, final fees, allocated seats and unexpired provider evidence',t=>{
  const f=setup(t);assert.ok(verifyReservation(f.cart,f.prefs,f.scope,f.now));
  assert.ok(verifyReservation({...f.cart,hold:{...f.cart.hold,expiresAtMs:null}},f.prefs,f.scope,f.now));
  for(const change of [{sessionId:'other'},{generation:2},{challenge:'login'},
    {hold:{...f.cart.hold,expiresAtMs:f.now}},{hold:{...f.cart.hold,status:'selected'}},
    {hold:{...f.cart.hold,reference:''}},{hold:{...f.cart.hold,orderId:'other'}},
    {order:{...f.order,canonicalPerformanceId:'other'}},{order:{...f.order,adjacent:false}},
    {order:{...f.order,feesIncluded:false}},{order:{...f.order,verifiedAllocation:false}},
    {order:{...f.order,seats:[]}}, {order:{...f.order,restrictedView:true}}])
    assert.throws(()=>verifyReservation({...f.cart,...change},f.prefs,f.scope,f.now));
});
test('one dispatch and durable opaque hold evidence; zero payment and no private reference output',async t=>{
  const f=setup(t);let reads=0,dispatches=0;
  const tx=new ReservationTransaction({...f,preferences:f.prefs,rehearsal:true,
    read:async()=>++reads===1?f.page:{...f.cart,order:{...f.order,cardNumber:'DO-NOT-EXPOSE'}},
    allocate:async()=>{dispatches++;assert.equal(f.ledger.journal.read()[0].type,'RESERVATION_REQUESTED');},
    authorize:()=>true,assertOwner(){},clock:()=>f.now});
  const result=await tx.reserve();assert.equal(result.status,'held');
  assert.equal(result.reservationVerified,true);assert.equal(dispatches,1);
  assert.equal(JSON.stringify(result).includes('PRIVATE-HOLD'),false);
  assert.equal(JSON.stringify(result).includes('DO-NOT-EXPOSE'),false);
  assert.equal((await tx.reserve()).status,'blocked');
  assert.deepEqual(f.ledger.journal.read().map(x=>x.type),['RESERVATION_REQUESTED','RESERVATION_HELD']);
  const recovered=new ReservationLedger(f.dir);
  assert.equal(recovered.recovered()[0].status,'reservation_unknown');
  assert.throws(()=>recovered.requested({...f.scope,runId:crypto.randomUUID(),windowId:2},
    allocationRequest(f.page,f.prefs,f.scope,f.now),true));
});
test('lost allocation response blocks retry across transaction instances',async t=>{
  const f=setup(t);let dispatches=0;
  const options={...f,preferences:f.prefs,read:async()=>f.page,
    allocate:async()=>{dispatches++;throw Error('lost');},authorize:()=>true,assertOwner(){},clock:()=>f.now};
  assert.equal((await new ReservationTransaction(options).reserve()).status,'reservation_unknown');
  assert.equal((await new ReservationTransaction(options).reserve()).status,'not_requested');
  assert.equal(dispatches,1);
});
test('allocation mismatch and expired/missing holds never publish secured seats',async t=>{
  for(const change of [{hold:{status:'unknown'}},{hold:{...setup(t).cart.hold,expiresAtMs:1}},
    {order:{...setup(t).order,adjacent:false}}]){
    const f=setup(t);let reads=0;
    const tx=new ReservationTransaction({...f,preferences:f.prefs,
      read:async()=>++reads===1?f.page:{...f.cart,...change},allocate:async()=>{},
      authorize:()=>true,assertOwner(){},clock:()=>f.now});
    const result=await tx.reserve();assert.equal(result.status,'reservation_unknown');
    assert.equal(result.reservationVerified,false);
  }
});
test('permission denial, ownership change and journal IO fault prevent dispatch',async t=>{
  for(const kind of ['permission','owner','journal']){
    const f=setup(t);let owners=0;
    const ledger=kind==='journal'?new ReservationLedger(f.dir,{fault:p=>{if(p==='before_fsync')throw Error('disk');}}):f.ledger;
    const tx=new ReservationTransaction({...f,ledger,preferences:f.prefs,read:async()=>f.page,
      allocate:async()=>assert.fail('must not allocate'),authorize:()=>kind!=='permission',
      assertOwner(){if(kind==='owner'&&++owners>2)throw Error('lease lost');},clock:()=>f.now});
    assert.equal((await tx.reserve()).status,'not_requested');
  }
});
test('timeout/Stop block late callbacks from dispatching or reporting a hold',async t=>{
  for(const kind of ['read_timeout','allocate_timeout','stop']){
    const f=setup(t);let resolve,reads=0,dispatches=0;
    const pending=new Promise(r=>{resolve=r;});
    const tx=new ReservationTransaction({...f,preferences:f.prefs,timeoutMs:25,
      read:async()=>{reads++;return kind==='read_timeout'?pending:f.page;},
      allocate:async()=>{dispatches++;return pending;},authorize:()=>true,assertOwner(){},clock:()=>f.now});
    const operation=tx.reserve();
    if(kind==='stop'){await new Promise(r=>setImmediate(r));tx.invalidate();}
    const result=await operation;assert.equal(result.reservationVerified,false);
    resolve(f.page);await new Promise(r=>setImmediate(r));
    assert.equal(reads,1);assert.equal(dispatches,kind==='read_timeout'?0:1);
    assert.equal(f.ledger.journal.read().some(x=>x.type==='RESERVATION_HELD'),false);
  }
});
test('full session binding rejects a hold proof from another window generation',t=>{
  const f=setup(t),request=allocationRequest(f.page,f.prefs,f.scope,f.now);
  const attempt=f.ledger.requested(f.scope,request,true);
  const scope={...f.scope,windowId:2,generation:2};
  const proof=verifyReservation({...f.cart,generation:2},f.prefs,scope,f.now);
  assert.throws(()=>f.ledger.held(attempt,proof));
  assert.throws(()=>f.ledger.held({...attempt,attemptId:crypto.randomUUID()},proof));
});
test('hold proof is one-use, unknown attempts cannot forge ledger outcomes',t=>{
  const f=setup(t),attempt=f.ledger.requested(f.scope,allocationRequest(f.page,f.prefs,f.scope,f.now),true);
  const proof=verifyReservation(f.cart,f.prefs,f.scope,f.now);
  f.ledger.held(attempt,proof);assert.throws(()=>f.ledger.held(attempt,proof));
  assert.throws(()=>f.ledger.unknown({...attempt,attemptId:crypto.randomUUID()}));
});
test('Express rehearsal uses runner handoff with no payment and no resume mutations',async t=>{
  const f=setup(t);const driver=new RehearsalDriver({rootDir:f.dir,
    plan:{id:crypto.randomUUID(),quantity:2,budgetMinor:200000,currency:'HKD',requireTogether:true,allowFallback:true}});
  await driver.start('express');await driver.next();await driver.next();
  assert.equal(driver.runner.state.phase,'MANUAL_PAYMENT');
  assert.equal(driver.runner.state.reservationVerified,true);
  assert.equal(driver.adapter.scope.runId,driver.runner.state.id);
  assert.equal(driver.state.paymentAttempts,0);assert.equal(driver.adapter.requests,1);
  await driver.next();assert.equal(driver.adapter.requests,1);
  for(const kind of ['express_timeout','express_separated','express_expired','express_missing_hold']){
    await driver.stop();await driver.start(kind);await driver.next();await driver.next();
    assert.equal(driver.runner.state.phase,'RESERVATION_UNKNOWN',kind);
    assert.equal(driver.state.paymentAttempts,0);assert.equal(driver.adapter.requests,1);
  }
});
test('concurrent calls dispatch once and mutated caller preferences never widen consent',async t=>{
  const f=setup(t);let reads=0,calls=0;
  const tx=new ReservationTransaction({...f,preferences:f.prefs,
    read:async()=>++reads===1?f.page:f.cart,allocate:async()=>{calls++;},
    authorize:()=>true,assertOwner(){},clock:()=>f.now});
  f.prefs.maxTotalMinor=1;f.scope.sessionId='changed';
  const results=await Promise.all([tx.reserve(),tx.reserve()]);
  assert.equal(calls,1);assert.equal(results.filter(x=>x.status==='held').length,1);
  assert.equal(results.filter(x=>x.status==='blocked').length,1);
});
test('allocation tier cannot silently change to another permitted fallback tier',async t=>{
  const f=setup(t);let reads=0;
  f.prefs.allowFallback=true;f.prefs.options.priceTier.push('500');
  const tx=new ReservationTransaction({...f,preferences:f.prefs,
    read:async()=>++reads===1?f.page:{...f.cart,order:{...f.order,priceTier:'500'}},
    allocate:async()=>{},authorize:()=>true,assertOwner(){},clock:()=>f.now});
  assert.equal((await tx.reserve()).status,'reservation_unknown');
});
test('unknown expiry remains unknown and does not invent a countdown',async t=>{
  const f=setup(t);let reads=0;
  const tx=new ReservationTransaction({...f,preferences:f.prefs,
    read:async()=>++reads===1?f.page:{...f.cart,hold:{...f.cart.hold,expiresAtMs:null}},
    allocate:async()=>{},authorize:()=>true,assertOwner(){},clock:()=>f.now});
  const result=await tx.reserve();assert.equal(result.status,'held');assert.equal(result.holdExpiresAtMs,null);
});
test('permission lost after durable intent prevents dispatch and blocks retry',async t=>{
  const f=setup(t);let permissions=0;
  const tx=new ReservationTransaction({...f,preferences:f.prefs,read:async()=>f.page,
    allocate:async()=>assert.fail('permission revoked'),authorize:()=>++permissions<3,
    assertOwner(){},clock:()=>f.now});
  assert.equal((await tx.reserve()).status,'reservation_unknown');
  assert.equal(f.ledger.recovered()[0].retryBlocked,true);
});
test('stop during pending reservation never publishes successful handoff',async t=>{
  const f=setup(t);const {BookingRunner}=require('./booking/runner.cjs');
  let resolve,allocated=false;const pending=new Promise(r=>{resolve=r;});
  const reservation=new ReservationTransaction({...f,preferences:f.prefs,read:async()=>f.page,
    allocate:async()=>{allocated=true;return pending;},authorize:()=>true,assertOwner(){},clock:()=>f.now});
  const runner=new BookingRunner({adapter:{read:async()=>f.page},preferences:f.prefs,
    eventKey:f.scope.eventKey,windowId:f.scope.windowId,runId:f.scope.runId,rehearsal:true,reservation});
  const step=runner.step();await new Promise(r=>setImmediate(r));assert.equal(allocated,true);
  runner.stop();resolve();await step;assert.equal(runner.state.status,'stopped');
  assert.equal(runner.state.reservationRecoveryRequired,true);
  assert.match(runner.state.message,/not cancelled/);
  assert.notEqual(runner.state.reservationVerified,true);
  assert.equal(f.ledger.recovered()[0].retryBlocked,true);
});
test('hold that expires during fsync cannot publish success',async t=>{
  const f=setup(t);let reads=0,time=f.now,writes=0;
  const ledger=new ReservationLedger(f.dir,{fault:point=>{
    if(point==='after_fsync'&&++writes===2)time=f.cart.hold.expiresAtMs;
  }});
  const tx=new ReservationTransaction({...f,ledger,preferences:f.prefs,
    read:async()=>++reads===1?f.page:f.cart,allocate:async()=>{},
    authorize:()=>true,assertOwner(){},clock:()=>time});
  const result=await tx.reserve();assert.equal(result.status,'reservation_unknown');
  assert.equal(result.reservationVerified,false);
});
test('runner rejects reservation attached to a different run before dispatch',async t=>{
  const f=setup(t);const {BookingRunner}=require('./booking/runner.cjs');
  const reservation=new ReservationTransaction({...f,preferences:f.prefs,read:async()=>f.page,
    allocate:async()=>assert.fail('wrong run'),authorize:()=>true,assertOwner(){},clock:()=>f.now});
  const runner=new BookingRunner({adapter:{read:async()=>f.page},preferences:f.prefs,
    eventKey:f.scope.eventKey,windowId:f.scope.windowId,rehearsal:true,reservation});
  await runner.step();assert.equal(runner.state.status,'failed');
  assert.equal(f.ledger.journal.read().length,0);
});
