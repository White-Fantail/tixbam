'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
// Electron's native API is mocked: no real provider, queue, payment or desktop
// is opened by this regression suite.
const nativeImage={
  createFromBuffer(buffer) {
    const frame=JSON.parse(buffer.toString('utf8'));
    return {
      isEmpty:()=>false,
      getSize:()=>({width:1000,height:700}),
      crop:()=>({toBitmap:()=>Buffer.from(frame.target,'utf8')})
    };
  }
};
const originalLoad=Module._load;
let LiveCopilot;
try{
  Module._load=function(request,parent,...rest) {
    if(request==='electron' && parent?.filename?.endsWith('/copilot/host.cjs'))
      return {nativeImage,BrowserWindow:class {constructor(){throw Error('Unexpected overlay')}}};
    return originalLoad.call(this,request,parent,...rest);
  };
  ({LiveCopilot}=require('./copilot/host.cjs'));
}finally{Module._load=originalLoad;}

function setup(phase='selecting'){
  const events=[],captures=[];
  let frame={target:'seat A',clock:1};
  const wc={
    isDestroyed:()=>false,isLoading:()=>false,
    getURL:()=> 'https://nol.yanolja.com/ticket/123',
    capturePage:async ()=>{
      captures.push({...frame});
      return {isEmpty:()=>false,toJPEG:()=>Buffer.from(JSON.stringify(frame),'utf8')};
    },
    sendInputEvent:e=>events.push(e)
  };
  const win={id:12,isDestroyed:()=>false,webContents:wc,
    getContentBounds:()=>({x:100,y:80,width:1000,height:700}),
    isMinimized:()=>false,show:()=>{},focus:()=>{win.focused=true}};
  const ticketWindows=new Map([[12,{win,phase,providerId:'nol',planId:'plan-1',popup:false}]]);
  const host=new LiveCopilot({ticketWindows,requireInstalled:()=>({allowedHosts:['nol.yanolja.com']})});
  return {host,events,captures,win,ticketWindows,
    change:changed=>{frame={...frame,...changed}}};
}

test('one approved click survives an unrelated countdown redraw',async()=>{
  const f=setup(),s=await f.host.snapshot(12);
  f.change({clock:2});
  const result=await f.host.click(12,s.token,{x:.5,y:.5});
  assert.equal(result.clicked,true);
  assert.equal(f.events.length,2);
  assert.deepEqual(f.events.map(x=>x.type),['mouseDown','mouseUp']);
  assert.equal(f.win.focused,true);
  await assert.rejects(f.host.click(12,s.token,{x:.5,y:.5}),/preview expired|changed/i);
});

test('a changed target never receives a click',async()=>{
  const f=setup(),s=await f.host.snapshot(12);
  f.change({target:'different button'});
  await assert.rejects(f.host.click(12,s.token,{x:.5,y:.5}),/selected button or seat changed/i);
  assert.equal(f.events.length,0);
});

test('preparing-page AI remains advisory and cannot click',async()=>{
  const f=setup('preparing'),s=await f.host.snapshot(12);
  assert.equal(s.mode,'diagnostic_preview');
  let calls=0;
  f.host.setVisionProvider(async input=>{
    calls++;
    assert.equal(input.stage,'preparing');
    assert.ok(input.imageBase64.length>0);
    return {status:'candidates',advisoryOnly:true,humanApprovalRequired:true,
      targets:[{x:.6,y:.5,label:'Book',reason:'Event entry',confidence:.94,kind:'continue'},
        {x:.3,y:.3,label:'Seat',reason:'Not allowed at entry',confidence:.98,kind:'seat'}]};
  });
  const result=await f.host.analyze(12,s.token,
    {quantity:1,currency:'KRW',budgetMinor:300000,locale:'ko'});
  assert.equal(calls,1);
  assert.equal(result.targets.length,1);
  assert.equal(result.targets[0].kind,'continue');
  await assert.rejects(f.host.click(12,s.token,{x:.6,y:.5}),/ticket selection/i);
  assert.equal(f.events.length,0);
});

test('linked popup checks its parent and official provider host',async()=>{
  const f=setup(),parent=f.ticketWindows.get(12);
  const popup={...parent,popup:true,parentId:12,
    win:{...parent.win,id:13,webContents:{...parent.win.webContents,getURL:()=> 'https://nol.yanolja.com/ticket/popup'}}};
  f.ticketWindows.set(13,popup);
  assert.doesNotThrow(()=>f.host.verify(13));
  f.ticketWindows.delete(12);
  assert.throws(()=>f.host.verify(13),/not linked/i);
});
