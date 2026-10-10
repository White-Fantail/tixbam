'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {screenAllowed,pixelPoint,targetRegion,validSnapshot}=require('./copilot/core.cjs');
function entry(url='https://www.cityline.com.hk/event/sales') {
  return {providerId:'cityline',planId:'a-plan',phase:'selecting',popup:false,
    win:{id:12,isDestroyed:()=>false,webContents:{
      isDestroyed:()=>false,isLoading:()=>false,getURL:()=>url}}};
}
const hosts=['cityline.com.hk'];
test('screenshots require a plan-linked provider selection window',()=>{
  assert.equal(screenAllowed(entry(),hosts,12).allowed,true);
  assert.equal(screenAllowed({...entry(),phase:'queue'},hosts,12).allowed,false);
  assert.equal(screenAllowed({...entry(),popup:true},hosts,12).allowed,false);
  assert.equal(screenAllowed({...entry(),planId:null},hosts,12).allowed,false);
  assert.equal(screenAllowed(entry('https://evilcityline.com.hk/choose'),hosts,12).allowed,false);
  assert.equal(screenAllowed(entry('https://cityline.com.hk/payment'),hosts,12).allowed,false);
  assert.equal(screenAllowed(entry('https://cityline.com.hk/login'),hosts,12).allowed,false);
});
test('preparation preview is local-only, provider-bound and never an action permission',()=>{
  const pre={...entry('https://nol.yanolja.com/product/123'),providerId:'nol',phase:'preparing'};
  const nolHosts=['world.nol.com','nol.yanolja.com'];
  assert.equal(screenAllowed(pre,nolHosts,12).allowed,false);
  assert.equal(screenAllowed(pre,nolHosts,12,{localPreview:true}).reason,'preparation_preview_only');
  assert.equal(screenAllowed({...pre,phase:'queue'},nolHosts,12,{localPreview:true}).allowed,false);
  assert.equal(screenAllowed({...pre,popup:true},nolHosts,12,{localPreview:true}).allowed,false);
  assert.equal(screenAllowed({...pre,planId:null},nolHosts,12,{localPreview:true}).allowed,false);
  assert.equal(screenAllowed({...pre,win:{...pre.win,webContents:{...pre.win.webContents,getURL:()=> 'https://nol.yanolja.com/login'}}},nolHosts,12,{localPreview:true}).allowed,false);
  assert.equal(screenAllowed({...pre,win:{...pre.win,webContents:{...pre.win.webContents,getURL:()=> 'https://notnol.yanolja.com.evil.test/product'}}},nolHosts,12,{localPreview:true}).allowed,false);
});
test('user-selected linked popup is eligible only with safe host and stage',()=>{
  const popup={...entry('https://nol.yanolja.com/ticket/seat'),providerId:'nol',
    phase:'selecting',popup:true,parentId:12};
  assert.equal(screenAllowed(popup,['nol.yanolja.com'],12).allowed,true);
  assert.equal(screenAllowed({...popup,parentId:null},['nol.yanolja.com'],12).allowed,false);
  assert.equal(screenAllowed({...popup,phase:'checkout'},['nol.yanolja.com'],12).allowed,false);
  assert.equal(screenAllowed({...popup,win:{...popup.win,webContents:{...popup.win.webContents,getURL:()=> 'https://other.example/ticket'}}},['nol.yanolja.com'],12).allowed,false);
});
test('target coordinates are bounded and scaled to the content viewport',()=>{
  assert.deepEqual(pixelPoint({x:0.5,y:0.25},1000,800),{x:500,y:200});
  for(const p of [{x:1,y:0.5},{x:0.5,y:-0.1},{x:NaN,y:0.1},{x:'0.5',y:0.2}])
    assert.throws(()=>pixelPoint(p,1000,800));
});
test('target neighbourhood remains bounded across edges and screen sizes',()=>{
  for(const size of [[1100,780],[2200,1560],[360,300]]){
    for(const point of [{x:0.001,y:0.001},{x:0.5,y:0.5},{x:0.999,y:0.999}]){
      const r=targetRegion(point,...size);
      assert.ok(r.x>=0 && r.y>=0 && r.width>0 && r.height>0);
      assert.ok(r.x+r.width<=size[0] && r.y+r.height<=size[1]);
      const p=pixelPoint(point,...size);
      assert.ok(p.x>=r.x && p.x<r.x+r.width && p.y>=r.y && p.y<r.y+r.height);
    }
  }
  assert.throws(()=>targetRegion({x:1.2,y:.5},1100,780));
});
test('preview binds exact page, window, plan and a single use',()=>{
  const e=entry(),now=2000,url=e.win.webContents.getURL();
  const s={token:'abc',windowId:12,planId:'a-plan',providerId:'cityline',phase:'selecting',url,
    issuedAt:1000,expiresAt:5000,consumed:false};
  assert.doesNotThrow(()=>validSnapshot(s,e,'abc',url,now));
  assert.throws(()=>validSnapshot(s,e,'wrong',url,now));
  assert.throws(()=>validSnapshot(s,e,'abc',url,5001));
  assert.throws(()=>validSnapshot({...s,consumed:true},e,'abc',url,now));
  assert.throws(()=>validSnapshot({...s,phase:'preparing'},e,'abc',url,now));
  assert.throws(()=>validSnapshot(s,e,'abc',url+'/new',now));
  assert.throws(()=>validSnapshot(s,{...e,planId:'different'},'abc',url,now));
});
