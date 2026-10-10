'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const providers=require('../addons/catalog.json');
const {MAX_AUTO_STEPS,actionPermission,chooseStep}=require('./copilot/auto-flow.cjs');
const {MAX_ANALYSES,MAX_AGE_MS}=require('./copilot/advance-authorization.cjs');
const addon=providers.find(x=>x.id==='cityline');
const now=Date.now();
const entry={planId:'p',providerId:'cityline',phase:'preparing',win:{id:12}};
const session={planId:'p',providerId:'cityline',windowId:12,
  mode:'dev_flow',stopped:false,automaticClicks:0,expiresAt:now+60000,
  consent:{confirmed:true,developmentOverride:true,
    actions:['continue','performance','price_tier','seat','quantity']}};
const target=(kind,label,confidence=.99)=>({kind,label,reason:'Visible ticket selection',
  confidence,x:.45,y:.6});
const permission=(stage,t,extras={})=>actionPermission({
  session:{...session,...extras},entry:{...entry,phase:stage},
  addon,target:t,developerEnabled:true,now});

test('preapproved booking entry and seat/cart steps are eligible but payment never is',()=>{
  assert.equal(permission('preparing',target('continue','예매하기')).allowed,true);
  assert.equal(permission('preparing',target('seat','Seat A')).allowed,false);
  assert.equal(permission('selecting',target('seat','Seat A')).allowed,true);
  assert.equal(permission('selecting',target('continue','Add to cart')).allowed,true);
  for(const stage of ['queue','waiting','checkout','verification'])
    assert.equal(permission(stage,target('seat','Seat A')).allowed,false);
  for(const label of ['PAY NOW','Checkout','Submit order','결제','CAPTCHA','OTP','대기열'])
    assert.equal(permission('selecting',target('continue',label)).allowed,false,label);
});
test('no automation without independent developer or bundled provider release authority',()=>{
  const t=target('seat','Seat A');
  assert.equal(actionPermission({session,entry:{...entry,phase:'selecting'},
    addon,target:t,developerEnabled:false,now}).allowed,false);
  assert.equal(actionPermission({session:{...session,mode:'authorized'},
    entry:{...entry,phase:'selecting'},
    addon,target:t,developerEnabled:false,now}).allowed,false);
  assert.equal(permission('selecting',t,{stopped:true}).allowed,false);
  assert.equal(permission('selecting',t,{automaticClicks:MAX_AUTO_STEPS}).allowed,false);
  assert.equal(permission('selecting',t,{planId:'other'}).allowed,false);
  assert.equal(MAX_AUTO_STEPS,20);
  assert.equal(MAX_ANALYSES,24);
  assert.equal(MAX_AGE_MS,2*60*60*1000);
});
test('same target is not replayed after a click, and low-confidence targets pause',()=>{
  const t=target('seat','Seat A');
  const base={session,entry:{...entry,phase:'selecting'},
    addon,developerEnabled:true,now};
  const proposed=chooseStep(base,[t]);
  assert.equal(proposed.target,t);
  assert.equal(chooseStep({...base,session:{...session,lastActionKey:proposed.key}},[t]).target,null);
  assert.equal(chooseStep(base,[target('seat','Seat A',.85)]).target,null);
});
