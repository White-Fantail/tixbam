'use strict';
// Offline, user-action safety test: no real website, network, order or payment.
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const catalog=require('../addons/catalog.json');

const electronStub={
  BrowserWindow:class { constructor(){throw new Error('Overlay creation is not part of this test');} },
  nativeImage:{
    createFromBuffer(bytes){
      const value=Buffer.from(bytes);
      return {isEmpty:()=>false,getSize:()=>({width:1000,height:800}),
        crop:()=>({toBitmap:()=>Buffer.from(value)})};
    }
  }
};
const originalLoad=Module._load;
let LiveCopilot;
try {
  Module._load=function(request,parent,isMain){
    if(request==='electron')return electronStub;
    return originalLoad.call(this,request,parent,isMain);
  };
  ({LiveCopilot}=require('./copilot/host.cjs'));
} finally {Module._load=originalLoad;}

function fakeBrowser(id, initialUrl='https://nol.yanolja.com/product/123'){
  const state={url:initialUrl,visual:'stable ticket buttons',events:[],focused:false};
  const win={
    id,isDestroyed:()=>false,isMinimized:()=>false,show:()=>{},
    focus:()=>{state.focused=true;},getContentBounds:()=>({width:1000,height:800}),
    webContents:{
      isDestroyed:()=>false,isLoading:()=>false,getURL:()=>state.url,
      capturePage:async()=>({isEmpty:()=>false,toJPEG:()=>Buffer.from(state.visual)}),
      sendInputEvent:input=>{state.events.push(input);}
    }
  };
  return {state,win};
}
function setup({developerMode=false,seatConfidence=.93,providerId='nol'}={}){
  const addon=catalog.find(item=>item.id===providerId);
  assert.ok(addon,'Fixture must use a bundled provider');
  const startingUrl=providerId==='cityline'
    ? 'https://www.cityline.com.hk/en_US/BuyEventTickets.html'
    : 'https://nol.yanolja.com/product/123';
  const {state,win}=fakeBrowser(42,startingUrl);
  const entry={win,providerId,planId:'test-plan',phase:'preparing',popup:false};
  const ticketWindows=new Map([[win.id,entry]]);
  const host=new LiveCopilot({ticketWindows,
    developerClickTestEnabled:()=>developerMode,
    requireInstalled:id=>{
      assert.equal(id,providerId);
      return addon;
    }});
  const requests=[];
  host.setVisionProvider(async payload=>{
    requests.push(payload);
    return {status:'candidates',advisoryOnly:true,humanApprovalRequired:true,targets:[
      {x:.72,y:.7,label:'예매하기',reason:'Go to ticket selection',
       confidence:.96,kind:'continue'},
      {x:.31,y:.5,label:'Seat',reason:'Seat suggestion',
       confidence:seatConfidence,kind:'seat'}
    ]};
  });
  return {host,entry,state,win,ticketWindows,requests};
}
const preferences={quantity:1,budgetMinor:300000,currency:'KRW',locale:'ko'};

test('NOL event page: preview and AI entry-button hint, never an automatic click',async()=>{
  const {host,state,requests}=setup();
  const snapshot=await host.snapshot(42);
  assert.equal(snapshot.mode,'diagnostic_preview');
  assert.equal(snapshot.automaticClickAvailable,false);
  assert.ok(snapshot.image.startsWith('data:image/jpeg;base64,'));
  const response=await host.analyze(42,snapshot.token,preferences);
  assert.deepEqual(response.targets.map(x=>x.kind),['continue']);
  assert.equal(requests[0].stage,'preparing');
  assert.equal(requests[0].providerId,'nol');
  assert.ok(requests[0].imageBase64.length>5);
  await assert.rejects(host.click(42,snapshot.token,{x:.72,y:.7}),/ticket selection/i);
  assert.equal(state.events.length,0);
  host.clearAll();
});
test('NOL ticket selection: proposal, one approved click, no repeat or stale click',async()=>{
  const {host,entry,state,requests}=setup();
  entry.phase='selecting';
  const snapshot=await host.snapshot(42);
  assert.equal(snapshot.mode,'human_guidance');
  const advice=await host.analyze(42,snapshot.token,preferences);
  assert.equal(advice.targets.length,2);
  assert.equal(requests[0].stage,undefined); // Default selection mode remains backward compatible.
  await host.click(42,snapshot.token,{x:.31,y:.5});
  assert.equal(state.focused,true);
  assert.deepEqual(state.events.map(x=>x.type),['mouseDown','mouseUp']);
  assert.equal(state.events[0].x,310);
  await assert.rejects(host.click(42,snapshot.token,{x:.31,y:.5}));
  assert.equal(state.events.length,2);
  host.clearAll();
});
test('changing a target-region image blocks native click',async()=>{
  const {host,entry,state}=setup();
  entry.phase='selecting';
  const shot=await host.snapshot(42);
  state.visual='different visible target';
  await assert.rejects(host.click(42,shot.token,{x:.5,y:.5}),/changed/i);
  assert.equal(state.events.length,0);
  host.clearAll();
});
test('linked popup works, but detached and payment popups fail closed',async()=>{
  const {host,ticketWindows}=setup();
  const {win,state}=fakeBrowser(43,'https://nol.yanolja.com/ticket/select');
  const popup={win,providerId:'nol',planId:'test-plan',
    popup:true,parentId:42,phase:'selecting'};
  ticketWindows.set(43,popup);
  const shot=await host.snapshot(43);
  assert.equal(shot.mode,'human_guidance');
  state.url='https://nol.yanolja.com/payment';
  await assert.rejects(host.click(43,shot.token,{x:.5,y:.5}),/payment|authentication/i);
  state.url='https://nol.yanolja.com/ticket/select';
  ticketWindows.delete(42);
  await assert.rejects(host.snapshot(43),/not linked/i);
  host.clearAll();
});

const developerConsent={mode:'observe',confirmed:true,shareScreenshots:true,
  actions:['seat'],developmentOverride:true};
const developerConditions={planId:'test-plan',...preferences};

test('developer-only automatic NOL seat click: one native pair without provider permission',async()=>{
  const {host,entry,state}=setup({developerMode:true,seatConfidence:.97});
  const statuses=[];
  host.onAutoUpdate=info=>statuses.push(info);
  entry.phase='selecting';
  const armed=host.arm(42,developerConditions,developerConsent);
  assert.equal(armed.mode,'dev_flow');
  await host.observe(42);
  assert.deepEqual(state.events.map(x=>x.type),['mouseDown','mouseUp']);
  assert.equal(state.events[0].x,310);
  assert.equal(state.events[0].y,400);
  assert.ok(statuses.some(x=>x.status==='progress'));
  assert.equal(host.autoSessions.size,1,'the run remains active for later stages');
  await host.observe(42);
  assert.equal(state.events.length,2,'cooldown prevents immediate repeat');
  host.clearAll();
});
test('packaged/flag-disabled runtime cannot arm developer mode even with forged IPC consent',()=>{
  const {host,entry,state}=setup({developerMode:false,seatConfidence:1});
  entry.phase='selecting';
  assert.throws(()=>host.arm(42,developerConditions,developerConsent),/developer click test/i);
  assert.equal(state.events.length,0);
  assert.equal(host.autoSessions.size,0);
  host.clearAll();
});
test('developer test never auto clicks event entry, login/queue, checkout or lower-confidence seats',async()=>{
  for(const phase of ['preparing','queue','checkout','verification']){
    const {host,entry,state}=setup({developerMode:true,seatConfidence:.99});
    entry.phase=phase;
    host.arm(42,developerConditions,developerConsent);
    await host.observe(42);
    assert.equal(state.events.length,0,phase);
    host.clearAll();
  }
  const {host,entry,state}=setup({developerMode:true,seatConfidence:.90});
  entry.phase='selecting';
  host.arm(42,developerConditions,developerConsent);
  await host.observe(42);
  assert.equal(state.events.length,0,'low confidence must not click');
  host.clearAll();
});
test('developer test stopping during AI latency blocks late native input',async()=>{
  const {host,entry,state}=setup({developerMode:true,seatConfidence:.99});
  entry.phase='selecting';
  let release;
  const waiter=new Promise(resolve=>{release=resolve;});
  host.setVisionProvider(async()=>{
    await waiter;
    return {status:'candidates',advisoryOnly:true,humanApprovalRequired:true,targets:[
      {x:.45,y:.4,label:'Seat',reason:'Select seat',confidence:.99,kind:'seat'}]};
  });
  host.arm(42,developerConditions,developerConsent);
  const pending=host.observe(42);
  host.disarm(42);
  release();
  await pending;
  assert.equal(state.events.length,0);
  host.clearAll();
});

test('Cityline manual-only addon: explicit developer automatic mode is configurable and runs one click',async()=>{
  const {host,entry,state,requests}=setup({providerId:'cityline',developerMode:true,seatConfidence:.99});
  entry.phase='selecting';
  const consent={mode:'authorized',confirmed:true,shareScreenshots:true,
    actions:['seat','quantity'],developmentOverride:true};
  const armed=host.arm(42,{...developerConditions,currency:'HKD'},consent);
  assert.equal(armed.requestedMode,'authorized','chosen mode must not be silently downgraded');
  assert.equal(armed.mode,'dev_flow','only developer multi-step executor is permitted');
  await host.observe(42);
  assert.equal(requests[0].providerId,'cityline');
  assert.deepEqual(state.events.map(x=>x.type),['mouseDown','mouseUp']);
  assert.equal(state.events.length,2);
  assert.equal(host.autoSessions.size,1,'automatic execution may continue to the next approved stage');
  host.clearAll();
});

test('NOL restricted addon: developer automatic mode works only in an explicit developer runtime',async()=>{
  const {host,entry,state}=setup({developerMode:true,seatConfidence:.97});
  entry.phase='selecting';
  const consent={...developerConsent,mode:'authorized'};
  const armed=host.arm(42,developerConditions,consent);
  assert.equal(armed.mode,'dev_flow');
  await host.observe(42);
  assert.deepEqual(state.events.map(x=>x.type),['mouseDown','mouseUp']);
  host.clearAll();
  const production=setup({developerMode:false,seatConfidence:.97});
  production.entry.phase='selecting';
  assert.throws(()=>production.host.arm(42,developerConditions,consent),
    /developer click test requires/i);
  const normal=production.host.arm(42,developerConditions,
    {...consent,developmentOverride:false});
  assert.equal(normal.mode,'observe','normal runtime must downgrade restricted provider');
  assert.equal(production.state.events.length,0);
  production.host.clearAll();
});

test('developer click requires a real ticket provider and an approved selection target',()=>{
  const {host,entry}=setup({developerMode:true});
  entry.phase='selecting';
  assert.throws(()=>host.arm(42,developerConditions,{
    mode:'authorized',confirmed:true,shareScreenshots:true,
    actions:['continue'],developmentOverride:true}),/approved selection action/i);
  host.clearAll();
});

test('preapproved Cityline flow moves from event booking entry to seat and halts at checkout',async()=>{
  const {host,entry,state,requests}=setup({providerId:'cityline',developerMode:true,seatConfidence:.99});
  host.setVisionProvider(async payload=>{
    requests.push(payload);
    const proposal=entry.phase==='preparing'
      ? {x:.45,y:.60,label:'예매하기',reason:'Enter booking flow',confidence:.99,kind:'continue'}
      : {x:.30,y:.50,label:'Seat A',reason:'Seat selection',confidence:.99,kind:'seat'};
    return {status:'candidates',advisoryOnly:true,humanApprovalRequired:true,
      targets:[proposal]};
  });
  const updates=[];
  host.onAutoUpdate=info=>updates.push(info);
  const consent={mode:'authorized',confirmed:true,shareScreenshots:true,
    actions:['continue','seat'],developmentOverride:true};
  host.arm(42,{...developerConditions,currency:'HKD'},consent);
  await host.observe(42);
  assert.deepEqual(state.events.map(e=>e.type),['mouseDown','mouseUp']);
  state.url='https://www.cityline.com.hk/en_US/seats';
  state.visual='now showing seat selection';
  assert.equal(host.inferSelectionStage(42),true);
  assert.equal(entry.phase,'selecting');
  host.autoSessions.get(42).lastAttemptAt=0;
  await host.observe(42);
  assert.deepEqual(state.events.map(e=>e.type),
    ['mouseDown','mouseUp','mouseDown','mouseUp']);
  assert.equal(host.autoSessions.get(42).automaticClicks,2);
  state.url='https://www.cityline.com.hk/en_US/checkout';
  host.autoSessions.get(42).lastAttemptAt=0;
  await host.observe(42);
  assert.equal(updates.at(-1).status,'hold_unverified');
  assert.equal(state.events.length,4,'never click checkout');
  assert.equal(requests[0].stage,'preparing');
  assert.equal(requests[1].stage,undefined);
  host.clearAll();
});

test('unchanged screen cannot repeat the same selection',async()=>{
  const {host,entry,state}=setup({developerMode:true,seatConfidence:.99});
  entry.phase='selecting';
  const consent={mode:'authorized',confirmed:true,shareScreenshots:true,
    actions:['seat'],developmentOverride:true};
  host.arm(42,developerConditions,consent);
  await host.observe(42);
  assert.equal(state.events.length,2);
  host.autoSessions.get(42).lastAttemptAt=0;
  await host.observe(42);
  assert.equal(state.events.length,2);
  assert.equal(host.autoStatus(42).status,'awaiting_user');
  host.clearAll();
});


test('NOL-01 live assessment reports event detail without falsely asserting a hold',async()=>{
  const {host,entry,state}=setup({developerMode:true});
  host.setVisionProvider(async()=>({status:'candidates',advisoryOnly:true,
    humanApprovalRequired:true,screenStage:'event',stageConfidence:.99,
    targets:[{x:.72,y:.7,label:'예매하기',reason:'Enter booking',
      confidence:.96,kind:'continue'}]}));
  const consent={mode:'authorized',confirmed:true,shareScreenshots:true,
    actions:['continue','seat'],developmentOverride:true};
  host.arm(42,developerConditions,consent);
  await host.observe(42);
  const info=host.autoStatus(42);
  assert.equal(info.providerStep.step,'event_detail');
  assert.equal(info.providerStep.holdVerified,false);
  assert.equal(state.events.length,0,'a low-confidence entry must not click');
  host.clearAll();
});

test('NOL-01 visual phase conflict blocks live dev clicks until user verifies stage',async()=>{
  const {host,entry,state}=setup({developerMode:true,seatConfidence:.99});
  host.setVisionProvider(async()=>({status:'candidates',advisoryOnly:true,
    humanApprovalRequired:true,screenStage:'selecting',stageConfidence:.99,
    targets:[{x:.7,y:.7,label:'예매하기',reason:'Enter booking',
      confidence:.99,kind:'continue'}]}));
  const consent={mode:'authorized',confirmed:true,shareScreenshots:true,
    actions:['continue','seat'],developmentOverride:true};
  host.arm(42,developerConditions,consent);
  await host.observe(42);
  const info=host.autoStatus(42);
  assert.equal(info.status,'awaiting_user');
  assert.equal(info.providerStep.evidence,'phase_conflict');
  assert.equal(state.events.length,0);
  host.clearAll();
});

test('NOL-01 high-confidence checkout or queue hints stop clicking even on selection URL',async()=>{
  for(const [screenStage,status,step] of [
    ['checkout','hold_unverified','checkout_unverified'],
    ['queue','awaiting_user','human_gate']
  ]){
    const {host,entry,state}=setup({developerMode:true,seatConfidence:.99});
    entry.phase='selecting';
    host.setVisionProvider(async()=>({status:'candidates',advisoryOnly:true,
      humanApprovalRequired:true,screenStage,stageConfidence:.99,
      targets:[{x:.31,y:.5,label:'Seat',reason:'Select seat',
        confidence:.99,kind:'seat'}]}));
    host.arm(42,developerConditions,developerConsent);
    await host.observe(42);
    const info=host.autoStatus(42);
    assert.equal(info.status,status,screenStage);
    assert.equal(info.providerStep.step,step,screenStage);
    assert.equal(info.providerStep.holdVerified,false);
    assert.equal(state.events.length,0,screenStage);
    host.clearAll();
  }
});

test('NOL-01 checkout/cart/payment routes never upload images or click',async()=>{
  for(const protectedRoute of ['checkout','cart','payment']){
    const {host,entry,state,requests}=setup({developerMode:true,seatConfidence:.99});
    entry.phase='selecting';
    state.url='https://nol.yanolja.com/en/'+protectedRoute;
    host.arm(42,developerConditions,developerConsent);
    await host.observe(42);
    const info=host.autoStatus(42);
    assert.equal(info.status,'hold_unverified',protectedRoute);
    assert.equal(info.providerStep.step,'checkout_unverified',protectedRoute);
    assert.equal(info.holdEvidence.status,'provider_verifier_unavailable',protectedRoute);
    assert.equal(info.holdEvidence.verified,false);
    assert.equal(requests.length,0,'protected route cannot upload: '+protectedRoute);
    assert.equal(state.events.length,0,protectedRoute);
    host.clearAll();
  }
});


test('NOL-02 reports detailed permitted selection screens without falsely verifying a hold',async()=>{
  for(const substep of ['performance_date','seat_map','price_quantity']){
    const {host,entry,state}=setup({developerMode:true,seatConfidence:.99});
    entry.phase='selecting';
    host.setVisionProvider(async()=>({status:'candidates',advisoryOnly:true,
      humanApprovalRequired:true,screenStage:'selecting',stageConfidence:.99,
      nolScreenStep:substep,nolStepConfidence:.99,
      targets:[{x:.31,y:.5,label:'Seat',reason:'Select eligible item',
        confidence:.99,kind:'seat'}]}));
    host.arm(42,developerConditions,developerConsent);
    await host.observe(42);
    const info=host.autoStatus(42);
    assert.equal(info.providerStep.substep,substep);
    assert.equal(info.providerStep.holdVerified,false);
    assert.equal(info.status,'progress');
    assert.equal(state.events.length,2);
    host.clearAll();
  }
});

test('NOL-02 stops on sold out, seat conflict, cart and challenge evidence',async()=>{
  for(const [nolScreenStep,screenStage,status] of [
    ['seat_conflict','selecting','awaiting_user'],
    ['sold_out','selecting','awaiting_user'],
    ['cart_review','checkout','hold_unverified'],
    ['human_gate','unknown','awaiting_user']
  ]){
    const {host,entry,state}=setup({developerMode:true,seatConfidence:.99});
    entry.phase='selecting';
    host.setVisionProvider(async()=>({status:'candidates',advisoryOnly:true,
      humanApprovalRequired:true,screenStage,stageConfidence:.99,
      nolScreenStep,nolStepConfidence:.99,
      targets:[{x:.31,y:.5,label:'Seat',reason:'Select eligible item',
        confidence:.99,kind:'seat'}]}));
    host.arm(42,developerConditions,developerConsent);
    await host.observe(42);
    const info=host.autoStatus(42);
    assert.equal(info.providerStep.substep,nolScreenStep);
    assert.equal(info.providerStep.holdVerified,false);
    assert.equal(info.status,status,nolScreenStep);
    assert.equal(state.events.length,0,'no click for '+nolScreenStep);
    host.clearAll();
  }
});

test('NOL-02 absent substep from older API does not claim fine-grained classification',async()=>{
  const {host,entry,state}=setup({developerMode:true,seatConfidence:.99});
  entry.phase='selecting';
  host.setVisionProvider(async()=>({status:'candidates',advisoryOnly:true,
    humanApprovalRequired:true,screenStage:'selecting',stageConfidence:.99,
    targets:[{x:.31,y:.5,label:'Seat',reason:'Select eligible item',
      confidence:.99,kind:'seat'}]}));
  host.arm(42,developerConditions,developerConsent);
  await host.observe(42);
  assert.equal(host.autoStatus(42).providerStep.substep,'unknown');
  assert.equal(host.autoStatus(42).providerStep.holdVerified,false);
  assert.equal(state.events.length,2);
  host.clearAll();
});


const nolStrategyFixture={
  version:1,quantity:1,currency:'KRW',budgetMinor:140000,
  performanceId:'perf-42',allowFallback:true,
  seatPreferences:{priceTier:['R','S'],section:['A','B'],floor:['1F'],seatMode:'assigned'}
};
const nolApprovedConditions={
  ...developerConditions,
  // In these tests the approved booking budget must match the NOL strategy.
  // Keep the production host's mismatch rejection fully enabled.
  budgetMinor:nolStrategyFixture.budgetMinor
};

test('NOL-03 passes bounded plan preferences and ranks 1-seat candidates without selecting',async()=>{
  const {host,entry,state,requests}=setup({developerMode:true,seatConfidence:.99});
  entry.phase='selecting';
  host.setVisionProvider(async payload=>{
    requests.push(payload);
    return {status:'candidates',advisoryOnly:true,humanApprovalRequired:true,
      screenStage:'selecting',stageConfidence:.99,
      nolScreenStep:'seat_map',nolStepConfidence:.99,targets:[
        {x:.7,y:.3,confidence:.99,label:'Seat B',reason:'Candidate',kind:'seat',offer:{
          quantity:1,currency:'KRW',performanceId:'perf-42',
          priceTier:'S',section:'B',floor:'2F',seatMode:'assigned',
          allInTotalMinor:110000,feesIncluded:true}},
        {x:.3,y:.3,confidence:.99,label:'Seat A',reason:'Candidate',kind:'seat',offer:{
          quantity:1,currency:'KRW',performanceId:'perf-42',
          priceTier:'R',section:'A',floor:'1F',seatMode:'assigned',
          allInTotalMinor:120000,feesIncluded:true}}
      ]};
  });
  host.arm(42,{...nolApprovedConditions,nolStrategy:nolStrategyFixture},developerConsent);
  await host.observe(42);
  const info=host.autoStatus(42);
  assert.equal(info.status,'awaiting_user');
  assert.equal(info.strategyInfo.recommended[0].label,'Seat A');
  assert.equal(info.strategyInfo.recommended[1].usedFallback,true);
  assert.equal(info.strategyInfo.holdVerified,false);
  assert.equal(info.strategyInfo.actionAuthorized,false);
  assert.equal(state.events.length,0,'NOL strategy does not auto-confirm visual seat offers');
  assert.deepEqual(requests[0].nolPreferences.section,['A','B']);
  assert.equal(requests[0].nolPreferences.allowFallback,true);
  host.clearAll();
});

test('NOL-03 rejects forged or mismatched approved price/quantity fields',()=>{
  const {host,entry}=setup({developerMode:true});
  entry.phase='selecting';
  for(const wrong of [
    {...nolStrategyFixture,quantity:2},
    {...nolStrategyFixture,currency:'USD'},
    {...nolStrategyFixture,budgetMinor:140001}
  ])assert.throws(()=>host.arm(42,{...nolApprovedConditions,nolStrategy:wrong},
    developerConsent),/NOL plan constraints/);
  host.clearAll();
});

test('NOL-03 seat conflict recovery requires manual action without blind retries',async()=>{
  const {host,entry,state}=setup({developerMode:true});
  entry.phase='selecting';
  host.setVisionProvider(async()=>({
    status:'candidates',advisoryOnly:true,humanApprovalRequired:true,
    screenStage:'selecting',stageConfidence:.99,
    nolScreenStep:'seat_conflict',nolStepConfidence:.99,targets:[]
  }));
  host.arm(42,{...nolApprovedConditions,nolStrategy:nolStrategyFixture},developerConsent);
  await host.observe(42);
  const info=host.autoStatus(42);
  assert.equal(info.status,'awaiting_user');
  assert.equal(info.strategyInfo.recovery.action,'REOBSERVE_WITH_USER');
  assert.equal(info.strategyInfo.recovery.autoRetry,false);
  assert.equal(state.events.length,0);
  host.clearAll();
});


test('NOL-05 real Copilot session diagnostic tracks queue handoff and holds without screenshot leakage',async()=>{
  const {host,entry,state,requests}=setup();
  entry.phase='queue';
  const consent={mode:'observe',confirmed:true,shareScreenshots:true,
    actions:['seat'],developmentOverride:false};
  host.arm(42,{...preferences,planId:'test-plan'},consent);
  await host.observe(42);
  let info=host.autoStatus(42);
  assert.equal(info.status,'awaiting_user');
  assert.equal(info.validationMetrics.queueEntries,1);
  assert.equal(info.validationMetrics.queuePending,true);
  assert.equal(info.validationMetrics.observationCount,0);
  assert.equal(requests.length,0,'queue cannot be uploaded');

  entry.phase='selecting';
  host.setVisionProvider(async payload=>{
    requests.push(payload);
    return {status:'uncertain',advisoryOnly:true,
      humanApprovalRequired:true,screenStage:'selecting',
      stageConfidence:.99,targets:[]};
  });
  await host.observe(42);
  info=host.autoStatus(42);
  assert.equal(info.validationMetrics.queueResumptions,1);
  assert.equal(info.validationMetrics.queuePending,false);
  assert.equal(info.validationMetrics.observationCount,1);
  assert.ok(info.validationMetrics.manualPauses>=2);
  assert.equal(info.validationMetrics.officialHoldVerified,false);
  assert.equal(state.events.length,0);

  entry.phase='checkout';
  state.url='https://nol.yanolja.com/en/cart';
  await host.observe(42);
  info=host.autoStatus(42);
  assert.equal(info.status,'hold_unverified');
  assert.equal(info.holdEvidence.verified,false);
  assert.ok(info.validationMetrics.holdUnverified>=1);
  assert.equal(info.validationMetrics.observationCount,1);
  assert.equal(requests.length,1,'cart never triggers a new image upload');
  assert.equal(info.validationMetrics.clickAttempts,0);
  assert.equal(state.events.length,0);
  const telemetry=JSON.stringify(info.validationMetrics);
  assert.ok(!telemetry.includes('nol.yanolja.com'));
  assert.ok(!telemetry.includes('test-plan'));
  host.clearAll();
});
