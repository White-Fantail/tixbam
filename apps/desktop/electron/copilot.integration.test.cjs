'use strict';
// Offline, user-action safety test: no real website, network, order or payment.
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');

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
function setup({developerMode=false,seatConfidence=.93}={}){
  const {state,win}=fakeBrowser(42);
  const entry={win,providerId:'nol',planId:'test-plan',phase:'preparing',popup:false};
  const ticketWindows=new Map([[win.id,entry]]);
  const host=new LiveCopilot({ticketWindows,
    developerClickTestEnabled:()=>developerMode,
    requireInstalled:id=>{
      assert.equal(id,'nol');
      return {kind:'ticketing',allowedHosts:['nol.yanolja.com'],
        automation:{level2:{status:'restricted'}},bookingAssistance:{mode:'manual'}};
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
  assert.equal(armed.mode,'dev_single_click');
  await host.observe(42);
  assert.deepEqual(state.events.map(x=>x.type),['mouseDown','mouseUp']);
  assert.equal(state.events[0].x,310);
  assert.equal(state.events[0].y,400);
  assert.ok(statuses.some(x=>x.status==='clicked'));
  assert.equal(host.autoSessions.size,0);
  await host.observe(42);
  assert.equal(state.events.length,2,'the same session cannot click again');
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
