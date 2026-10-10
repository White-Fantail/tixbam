'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {RehearsalDriver}=require('./booking/rehearsal-driver.cjs');
const {RehearsalPlanner}=require('./booking/ai-planner.cjs');
const {strictProposal}=require('./booking/action-validator.cjs');

const plan={id:crypto.randomUUID(),artist:'Sample Artist',title:'Fictional fan meeting',
  providerId:'cityline',quantity:2,budgetMinor:200000,currency:'HKD',
  requireTogether:true,allowFallback:true,preferencesReady:true};
function setup(t){
  const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-planner-v1-'));
  t.after(()=>fs.rmSync(rootDir,{recursive:true,force:true}));
  const driver=new RehearsalDriver({rootDir,plan,ownerId:'some-user@example.net'});
  const planner=new RehearsalPlanner();
  return {driver,planner};
}
function response(request,action='WAIT',token=null,extra={}){
  return {
    schemaVersion:1,requestId:request.requestId,snapshotId:request.snapshotId,
    expectedPageGeneration:request.pageGeneration,
    expectedStage:request.observation.stage,
    action,targetToken:token,rationaleCode:'REHEARSAL_WAIT',
    expiresAtMs:Date.now()+5000,advisoryOnly:true,
    model:'openai/gpt-4.1-mini',...extra,
  };
}
const ask=async(plan,send,locale='ko')=>plan.planner.propose({
  driver:plan.driver,providerId:'cityline',locale,send
});

test('only redacted AB-04 observation goes to server, never raw page/plan/card/URL data',async t=>{
  const env=setup(t);
  await env.driver.start('standard',2027);
  let payload;
  const result=await ask(env,async request=>{
    payload=request;
    return response(request);
  });
  assert.deepEqual({action:result.action,advisoryOnly:result.advisoryOnly},
                   {action:'WAIT',advisoryOnly:true});
  assert.equal(result.source,'openrouter');
  assert.equal(result.model,'openai/gpt-4.1-mini');
  assert.equal(payload.locale,'ko');
  assert.equal(payload.rehearsal,true);
  assert.equal(payload.providerId,'cityline');
  assert.equal(payload.observation.schemaVersion,1);
  assert.deepEqual(Object.keys(payload.observation),
    ['schemaVersion','stage','challenge','confidence','optionCounts','targets']);
  assert.deepEqual(payload.observation.targets,[]);
  assert.equal(payload.observation.stage,'options');
  assert.equal(payload.observation.challenge,'none');
  assert.ok(crypto.randomUUID);
  const printed=JSON.stringify(payload);
  for(const secret of [
    plan.artist,plan.title,plan.id,env.driver.runner.state.id,
    'some-user@example.net','4242424242424242','https://','cookie',
    'password','rawHtml','bankOtp','cvv','seatPrice','orderId'
  ])assert.equal(printed.includes(secret),false,secret);
  assert.equal(env.driver.adapter.payments,0);
  assert.equal(env.driver.state.status,'running');
  // Host-only AB-03 ProposalV1 is not returned to UI or model.
  assert.ok(strictProposal(env.planner.lastHostProposal));
  assert.equal(result.runId,undefined);
  assert.equal(result.snapshotId,undefined);
  assert.equal(result.targetRef,undefined);
  assert.equal(result.requestId,undefined);
});
test('valid synthetic offer token is resolved ONLY in host into typed AB-03 proposal',async t=>{
  const env=setup(t);
  await env.driver.start('automatic',200);
  await env.driver.next(); // options -> offers (no payment effect)
  const status=env.driver.state;
  assert.equal(status.status,'running');
  assert.equal(env.driver.adapter.payments,0);
  const result=await ask(env,async request=>{
    assert.equal(request.observation.stage,'offers');
    const token=request.observation.targets.find(t=>t.kind==='offer')?.token;
    assert.ok(token);
    const json=JSON.stringify(request);
    assert.equal(json.includes(env.driver.adapter.offer.id),false);
    assert.equal(json.includes(env.driver.runner.state.id),false);
    return response(request,'SELECT_APPROVED_OFFER',token,
      {rationaleCode:'MATCHING_OFFER'});
  });
  assert.equal(result.action,'SELECT_APPROVED_OFFER');
  assert.equal(result.advisoryOnly,true);
  assert.equal(env.driver.state.status,'running');
  assert.equal(env.driver.adapter.stage,'offers'); // AI did not reserve
  assert.equal(env.driver.adapter.payments,0);
  const host=env.planner.lastHostProposal;
  assert.ok(strictProposal(host));
  assert.equal(host.action,result.action);
  assert.equal(typeof host.targetRef,'string');
  assert.notEqual(host.targetRef,env.driver.adapter.offer.id);
});
test('wrong target, executable action, wrong snapshot and extra fields always fallback',async t=>{
  const env=setup(t);await env.driver.start('automatic',12);await env.driver.next();
  for(const choice of [
    req=>response(req,'SELECT_APPROVED_OFFER',crypto.randomUUID()),
    req=>response(req,'CLICK_PAY_NOW',null),
    req=>response(req,'SELECT_APPROVED_OFFER',null),
    req=>response(req,'WAIT',null,{targetRef:'style=script'}),
    req=>response(req,'WAIT',null,{snapshotId:crypto.randomUUID()}),
    req=>response(req,'WAIT',null,{requestId:crypto.randomUUID()}),
    req=>response(req,'WAIT',null,{expectedPageGeneration:999}),
    req=>response(req,'WAIT',null,{expiresAtMs:Date.now()-1}),
    req=>response(req,'WAIT',crypto.randomUUID()),
    req=>response(req,'WAIT',null,{rationaleCode:'https://evil.test'}),
    req=>response(req,'WAIT',null,{advisoryOnly:false}),
  ]){
    const result=await ask(env,async req=>choice(req));
    assert.equal(result.action,'ASK_USER');
    assert.equal(result.rationaleCode,'PROPOSAL_REJECTED');
    assert.equal(result.advisoryOnly,true);
  }
  assert.equal(env.driver.adapter.stage,'offers');
  assert.equal(env.driver.adapter.payments,0);
});
test('provider errors return generic non-executing manual fallback without leaking secrets',async t=>{
  const env=setup(t);await env.driver.start('standard');
  for(const error of [
    Error('OPENROUTER_API_KEY=secret, card 4242424242424242'),
    Error('Provider 500: OTP 123456'),
    Error('Schema unsupported: token=' + crypto.randomUUID())
  ]){
    const result=await ask(env,async()=>{throw error});
    assert.deepEqual(result,{
      action:'ASK_USER',rationaleCode:'MODEL_UNAVAILABLE',
      advisoryOnly:true,source:'fallback'});
    assert.equal(JSON.stringify(result).includes('secret'),false);
  }
  assert.equal(env.driver.adapter.payments,0);
});
test('model response after phase advancement is stale and cannot mutate booking',async t=>{
  const env=setup(t);await env.driver.start('standard',4);
  let resolve,issued;
  const promise=new Promise(done=>resolve=done);
  const proposal=ask(env,req=>{issued=req;return promise});
  // Allow the host capture to complete before advancing.
  await new Promise(done=>setImmediate(done));
  assert.ok(issued);
  await env.driver.next();
  resolve(response(issued));
  const result=await proposal;
  assert.equal(result.rationaleCode,'STALE_REHEARSAL');
  assert.equal(env.driver.adapter.stage,'offers');
});
test('signout/identity-change invalidates an in-flight model response',async t=>{
  const env=setup(t);await env.driver.start('standard');
  let resolve;
  const promise=new Promise(done=>resolve=done);
  let issued;
  const pending=ask(env,req=>{issued=req;return promise});
  await new Promise(done=>setImmediate(done));
  env.planner.invalidate(); // main process does this on account switch/sign-out
  resolve(response(issued));
  const result=await pending;
  assert.equal(result.rationaleCode,'STALE_REHEARSAL');
});
test('CAPTCHA and queue observations cannot turn into mutating instructions',async t=>{
  const env=setup(t);await env.driver.start('captcha',100);
  await env.driver.next();
  assert.equal(env.driver.state.status,'awaiting_user');
  const result=await ask(env,async req=>{
    assert.equal(req.observation.challenge,'captcha');
    assert.equal(req.observation.targets.length,0);
    return response(req,'SELECT_PERFORMANCE',crypto.randomUUID());
  });
  assert.equal(result.action,'ASK_USER');
  assert.equal(result.rationaleCode,'PROPOSAL_REJECTED');
  assert.equal(env.driver.adapter.payments,0);
});
test('planner is not automatically invoked by normal steps or completed/recovered states',async t=>{
  const env=setup(t);
  await env.driver.start('standard');
  await env.driver.next();await env.driver.next();await env.driver.next();
  assert.equal(env.driver.state.status,'review');
  const status=await ask(env,async req=>response(req));
  assert.equal(status.action,'WAIT');
  await env.driver.next({confirm:true});await env.driver.next();
  assert.equal(env.driver.state.status,'completed');
  await assert.rejects(()=>ask(env,async()=>{throw Error('should not call')}),
    /idle active rehearsal run/);
  await env.driver.simulateRestart();
  await assert.rejects(()=>ask(env,async()=>{throw Error('should not call')}),
    /idle active rehearsal run/);
});
