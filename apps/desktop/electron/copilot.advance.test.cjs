'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const addons=require('../addons/catalog.json');
const {normalizeConsent,providerAutomationStatus,canRun,MAX_ANALYSES,MIN_ANALYSIS_GAP_MS}=
  require('./copilot/advance-authorization.cjs');

test('all currently bundled restricted and unverified add-ons deny auto click',()=>{
  for(const addon of addons){
    for(const kind of ['seat','continue','quantity','price_tier','performance']){
      const result=providerAutomationStatus(addon,kind);
      assert.equal(result.allowed,false,addon.id+' '+kind);
      assert.ok(result.reason);
    }
  }
  assert.equal(addons.some(x=>x.automation.level2.status==='available'),false);
});

test('remote capability flag alone never grants native auto click',()=>{
  const forged={
    kind:'ticketing',automation:{
      level2:{status:'available'},
      verifiedNativeExecutor:'host-reviewed-v1',verifiedActionKinds:['seat']
    },booking:{implementation:{seats:'pending'}}
  };
  assert.equal(providerAutomationStatus(forged,'seat').allowed,false);
  forged.booking.implementation.seats='verified';
  assert.equal(providerAutomationStatus(forged,'seat').allowed,true);
  assert.equal(providerAutomationStatus(forged,'quantity').allowed,false);
  forged.bookingAssistance={mode:'manual'};
  assert.equal(providerAutomationStatus(forged,'seat').allowed,false);
  forged.bookingAssistance=undefined;
  forged.automation.level2.status='restricted';
  assert.equal(providerAutomationStatus(forged,'seat').allowed,false);
});

test('advanced consent cannot be silently enabled or expanded',()=>{
  const manual=normalizeConsent({mode:'manual'});
  assert.equal(manual.mode,'manual');
  assert.deepEqual(manual.actions,[]);
  assert.throws(()=>normalizeConsent({mode:'authorized',confirmed:false,shareScreenshots:true,actions:['seat']}));
  assert.throws(()=>normalizeConsent({mode:'observe',confirmed:true,shareScreenshots:false,actions:['continue']}));
  assert.throws(()=>normalizeConsent({mode:'observe',confirmed:true,shareScreenshots:true,actions:['seat','seat']}));
  assert.throws(()=>normalizeConsent({mode:'authorized',confirmed:true,shareScreenshots:true,actions:['payment']}));
  const allowed=normalizeConsent({mode:'observe',confirmed:true,shareScreenshots:true,actions:['continue']});
  assert.deepEqual(allowed.actions,['continue']);
  assert.ok(Object.isFrozen(allowed));
  assert.ok(Object.isFrozen(allowed.actions));
});

test('bounded session refuses stale, mismatched, stopped and exhausted attempts',()=>{
  const session={planId:'p',providerId:'nol',windowId:12,expiresAt:50000,count:0,
    lastAttemptAt:0,stopped:false};
  const entry={planId:'p',providerId:'nol',phase:'preparing',win:{id:12}};
  assert.equal(canRun(session,entry,MIN_ANALYSIS_GAP_MS+100).allowed,true);
  assert.equal(canRun(session,{...entry,planId:'other'},MIN_ANALYSIS_GAP_MS+100).allowed,false);
  assert.equal(canRun(session,{...entry,phase:'queue'},MIN_ANALYSIS_GAP_MS+100).allowed,false);
  assert.equal(canRun({...session,count:MAX_ANALYSES},entry,MIN_ANALYSIS_GAP_MS+100).allowed,false);
  assert.equal(canRun({...session,stopped:true},entry,MIN_ANALYSIS_GAP_MS+100).allowed,false);
  assert.equal(canRun(session,entry,50000).allowed,false);
  assert.equal(canRun(session,entry,MIN_ANALYSIS_GAP_MS-1).allowed,false);
});
