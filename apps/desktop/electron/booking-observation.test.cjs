'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const crypto=require('node:crypto');
const {ActionValidator}=require('./booking/action-validator.cjs');
const {ObservationPipeline}=require('./booking/observation.cjs');
const {classifyPage,normalizeOptions,projectAIObservation}=require('./booking/observation-redaction.cjs');

const URL_OK='https://venue.cityline.com.hk/utsvInternet/internet/eventDetail?event=123';
const BEFORE=1781060400000;
const pii='person@example.net 4242424242424242 123 jwt.cookie';
function entry(){
  const wc=new EventEmitter();
  wc.url=URL_OK;
  wc.getURL=()=>wc.url;
  return wc;
}
function testPage(overrides={}){
  return {eventKey:'book-event-123',providerEventId:'123',stage:'options',
    challenge:null,challengeType:'none',
    options:{
      performance:[{id:'evening_1',available:true,label:pii},
                   {id:'evening_2',available:false,label:'Another seat'}],
      priceTier:[{id:'800',available:true,label:'HK$800 '+pii}]
    },
    html:'<form><input type=password value=SECRET></form>',
    cookies:'secret-cookie',cardNumber:'4242424242424242',
    email:'person@example.net',oneTimePassword:'123456',
    screenshot:'data:image/png;base64,SECRET',url:'https://user:pw@evil.example',
    ...overrides};
}
function fixture({rehearsal=false,source,initialTime=BEFORE}={}){
  let time=initialTime;
  const clock=()=>time;
  const validator=new ActionValidator({clock});
  const pipeline=new ObservationPipeline({validator,clock});
  const windowId=42;
  const wc=rehearsal?null:entry();
  pipeline.watchWindow({
    windowId,webContents:wc,providerId:'cityline',
    planId:'plan-123',expectedEventId:rehearsal?null:'123',
    allowedHosts:rehearsal?[]:['cityline.com.hk'],
    eventQueryParam:rehearsal?null:'event',
    pathSuffix:rehearsal?null:'/eventDetail',
    rehearsal,
  });
  const run={id:crypto.randomUUID(),eventKey:'book-event-123',
    windowId,revision:3,generation:1,phase:'OBSERVING',status:'running',rehearsal};
  const binding={
    windowId,run,accountId:'account-123',planId:'plan-123',
    providerId:'cityline',country:'HK',addonVersion:'1.1.0',
    policyRevision:7,source:source|| (rehearsal?'rehearsal':'verified_adapter')
  };
  return {wc,pipeline,validator,binding,run,setTime:next=>time=next};
}

test('provider-neutral host observation is strictly bounded, with no page HTML or secret values',async()=>{
  const x=fixture();
  const host=await x.pipeline.capture({...x.binding,page:testPage()});
  assert.equal(host.stage,'options');
  assert.equal(host.challenge,'none');
  assert.equal(host.trustedSource,'verified_adapter');
  assert.equal(host.accountId,'account-123'); // only in host private memory
  assert.equal(host.providerEventId,'123');
  assert.ok(host.handles.length>0);
  assert.equal(host.handles.some(h=>h.label.includes('800')||h.label.includes('person')),false);
  const asText=JSON.stringify(host);
  for(const secret of [pii,'4242424242424242','secret-cookie','data:image',
    '<form>','user:pw@evil.example','123456'])
    assert.equal(asText.includes(secret),false,secret);
  assert.deepEqual(host.handles.map(h=>h.kind),['performance','price_tier']);
  // A host-issued action snapshot can still be validated by AB-03.
  assert.ok(x.validator instanceof ActionValidator);
});

test('AI projection has separate task handles and zero account/event/URL/price identifiers',async()=>{
  const x=fixture();
  const host=await x.pipeline.capture({...x.binding,page:testPage()});
  assert.throws(()=>x.pipeline.projectForAI(host.snapshotId),/not authorized/);
  const ai=x.pipeline.projectForAI(host.snapshotId,{externalSharingPermitted:true});
  assert.deepEqual(Object.keys(ai),['schemaVersion','stage','challenge','confidence','optionCounts','targets']);
  assert.equal(ai.stage,'options');
  assert.equal(ai.optionCounts.performance,1);
  assert.equal(ai.optionCounts.price_tier,1);
  for(const target of ai.targets){
    assert.notEqual(target.token,host.handles[0].ref);
    assert.ok(host.handles.some(h=>h.ref===x.pipeline.resolveTarget(host.snapshotId,target.token)));
  }
  const text=JSON.stringify(ai);
  for(const secret of ['account-123','plan-123','book-event-123',
    'HKD',pii,'secret-cookie','4242424242424242','windowId','snapshotId','runId'])
    assert.equal(text.includes(secret),false,secret);
  // Generating a projection does not itself contact a provider or the model.
});

test('navigation including same-document navigation invalidates old snapshot and task mappings',async()=>{
  for(const event of ['did-start-navigation','did-navigate','did-navigate-in-page',
                      'did-frame-navigate','render-process-gone','destroyed']){
    const x=fixture();
    const host=await x.pipeline.capture({...x.binding,page:testPage()});
    const token=x.pipeline.projectForAI(host.snapshotId,{externalSharingPermitted:true}).targets[0].token;
    assert.ok(x.pipeline.resolveTarget(host.snapshotId,token));
    x.wc.emit(event);
    assert.equal(x.pipeline.resolveTarget(host.snapshotId,token),null,event);
    assert.throws(()=>x.pipeline.projectForAI(host.snapshotId,{externalSharingPermitted:true}),/Expired/);
  }
});

test('same-URL DOM option changes invalidate old snapshot; identical rereads do not bump generation',async()=>{
  const x=fixture();
  const first=await x.pipeline.capture({...x.binding,page:testPage()});
  const firstToken=x.pipeline.projectForAI(first.snapshotId,{externalSharingPermitted:true}).targets[0].token;
  const same=x.pipeline.noteRead({windowId:42,providerId:'cityline',page:testPage()});
  assert.equal(same.pageGeneration,first.pageGeneration);
  const updated=testPage({options:{
    performance:[{id:'evening_3',available:true,label:'changed'}],
    priceTier:[{id:'900',available:true,label:'HK$900'}]}});
  const newer=await x.pipeline.capture({...x.binding,page:updated});
  assert.equal(newer.pageGeneration,first.pageGeneration+1);
  assert.equal(x.pipeline.resolveTarget(first.snapshotId,firstToken),null);
  assert.equal(newer.handles.length,2);
});

test('slow adapter returning after navigation cannot mint an actionable snapshot',async()=>{
  const x=fixture();
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const job=x.pipeline.capture({...x.binding,adapter:{read:()=>pending}});
  x.wc.emit('did-start-navigation');
  release(testPage());
  await assert.rejects(job,/Navigation/);
});

test('wrong country/event/host/path or window is denied; closed window releases listeners',async()=>{
  const x=fixture();
  await assert.rejects(x.pipeline.capture({...x.binding,
    page:testPage({providerEventId:'other'})}),/event changed/);
  await assert.rejects(x.pipeline.capture({...x.binding,
    page:testPage({eventKey:'wrong'})}),/run event mismatch/);
  await assert.rejects(x.pipeline.capture({...x.binding,windowId:314,
    page:testPage()}),/binding invalid/);
  x.wc.url='https://cityline.com.hk/utsvInternet/internet/eventDetail?event=124';
  await assert.rejects(x.pipeline.capture({...x.binding,page:testPage()}),/event changed/);
  x.wc.url='https://cityline.com.hk/account?event=123';
  await assert.rejects(x.pipeline.capture({...x.binding,page:testPage()}),/event changed/);
  x.wc.url='https://cityline.com.hk.evil.example/utsvInternet/internet/eventDetail?event=123';
  await assert.rejects(x.pipeline.capture({...x.binding,page:testPage()}),/event changed/);
  x.wc.url=URL_OK;
  const host=await x.pipeline.capture({...x.binding,page:testPage()});
  x.pipeline.unwatchWindow(42);
  assert.equal(x.pipeline.resolveTarget(host.snapshotId,'bogus'),null);
  assert.equal(x.wc.listenerCount('did-navigate'),0);
});

test('read-only legacy observation does not create AI handles or depend on account keys',()=>{
  const x=fixture();
  const s=x.pipeline.noteRead({windowId:42,providerId:'cityline',page:testPage(),runId:x.run.id});
  assert.deepEqual(s,{stage:'options',challenge:'none',pageGeneration:0});
  assert.equal(x.wc.listenerCount('did-navigate-in-page'),1);
  x.wc.emit('did-navigate-in-page');
  assert.equal(x.pipeline.noteRead({windowId:42,providerId:'cityline',page:testPage()}).pageGeneration,1);
});

test('challenge and payment pages contain no actionable controls and never expose secrets',async()=>{
  for(const [challenge,expected] of [
    ['captcha','captcha'],['login','login'],['queue','queue'],
    ['3ds','3ds'],['consent','consent'],['unknown','unknown']
  ]){
    const x=fixture();
    const host=await x.pipeline.capture({...x.binding,page:testPage({
      challengeType:challenge,challenge:'Handle on provider',stage:'options'})});
    assert.equal(host.challenge,expected);
    assert.equal(host.handles.length,0);
    const ai=x.pipeline.projectForAI(host.snapshotId,{externalSharingPermitted:true});
    assert.equal(ai.targets.length,0);
  }
  for(const stage of ['payment','confirmation','bank_challenge','access_blocked']){
    const x=fixture();
    const host=await x.pipeline.capture({...x.binding,page:testPage({
      stage,options:{performance:[{id:'p1',available:true}],priceTier:[{id:'800',available:true}]}})});
    assert.equal(host.handles.length,0);
    assert.notEqual(host.confidence,'verified');
  }
});

test('oversized or malicious options are denied wholesale; no arbitrary page text is forwarded',async()=>{
  for(const options of [
    {performance:Array.from({length:31},(_,i)=>({id:'p'+i,available:true})),priceTier:[]},
    {performance:[{id:'p1',available:true},{id:'p1',available:true}],priceTier:[]},
    {performance:[{id:'https://evil.com',available:true}],priceTier:[]},
    {performance:[{id:'p1',available:'true'}],priceTier:[]},
    {performance:[{id:'<script>alert(1)</script>',available:true}],priceTier:[]},
    {performance:[{id:'__proto__',available:true,label:pii}],priceTier:[]},
  ]){
    const x=fixture();
    const host=await x.pipeline.capture({...x.binding,page:testPage({options})});
    assert.equal(host.handles.length,0);
    assert.equal(host.stage,'options');
  }
  assert.equal(classifyPage({stage:'constructor'}).stage,'unknown');
  assert.deepEqual(normalizeOptions({stage:'unknown',options:{}},'verified_adapter'),[]);
});

test('snapshot TTL expiry, signout-like invalidation, and rehearsal opt-in are fail closed',async()=>{
  const x=fixture();
  const host=await x.pipeline.capture({...x.binding,page:testPage(),ttlMs:500});
  const ai=x.pipeline.projectForAI(host.snapshotId,{externalSharingPermitted:true});
  x.setTime(BEFORE+501);
  assert.equal(x.pipeline.resolveTarget(host.snapshotId,ai.targets[0].token),null);
  assert.throws(()=>x.pipeline.projectForAI(host.snapshotId,{externalSharingPermitted:true}),/Expired/);
  x.pipeline.invalidateRun(x.run.id);
  const y=fixture({rehearsal:true});
  const fake={eventKey:y.run.eventKey,stage:'offers',challenge:null,challengeType:'none',
    offers:[{id:'fake',eventKey:y.run.eventKey,available:true,
      quantity:1,currency:'HKD',totalMinor:50000,feesIncluded:true,
      adjacent:true,priceTier:'800',performance:'evening_1',seats:['A1']}]};
  const demo=await y.pipeline.capture({...y.binding,page:fake});
  assert.equal(demo.handles.length,1);
  assert.throws(()=>y.pipeline.projectForAI(demo.snapshotId),/not authorized/);
  assert.equal(y.pipeline.projectForAI(demo.snapshotId,{rehearsal:true}).targets.length,1);
});

test('host-only projection schema rejects arbitrary objects and no screenshots are captured',()=>{
  assert.throws(()=>projectAIObservation({stage:'__proto__',challenge:'none'},[]));
  const x=fixture();
  assert.equal(typeof x.pipeline.capture,'function');
  assert.equal(typeof x.pipeline.projectForAI,'function');
  assert.equal('captureScreenshot' in x.pipeline,false);
});


test('Cityline DOM inspection remains bounded and challenge-aware without reading input values', () => {
  const vm=require('node:vm');
  const {inspectCityline}=require('./booking/cityline.cjs');
  const element=(label,attributes={})=>({
    textContent:label,disabled:false,getClientRects:()=>[1],
    getAttribute:key=>attributes[key]
  });
  const date=element('Evening',{'data-perf-id':'date_1'});
  const price=element('800');
  function inspect(url,{performances=[date],prices=[price],captcha=false,password=false}={}){
    const document={
      title:'Cityline public event',
      querySelectorAll:selector=>selector==='button.date-time-position[data-perf-id]'?performances:
        selector==='button.price-btn'?prices:
        selector==="input[type=password]"&&password?[element('')]:
        selector==='#inputCaptcha,iframe[src*="captcha"],.g-recaptcha'&&captcha?[element('')]:[]
    };
    return vm.runInNewContext('('+inspectCityline.toString()+')("123")',{
      document,location:{href:url},URL,
      getComputedStyle:()=>({visibility:'visible'})
    });
  }
  const event=inspect(URL_OK);
  assert.equal(event.stage,'options');
  assert.equal(event.challengeType,'none');
  assert.equal(event.providerEventId,'123');
  assert.equal(event.options.performance[0].id,'date_1');
  assert.equal(event.options.priceTier[0].id,'800');
  assert.equal(inspect(URL_OK,{performances:Array.from({length:31},()=>date)}).stage,'unknown');
  assert.equal(inspect(URL_OK,{prices:Array.from({length:31},()=>price)}).stage,'unknown');
  assert.equal(inspect(URL_OK,{captcha:true}).challengeType,'captcha');
  assert.equal(inspect(URL_OK,{password:true}).challengeType,'login');
  assert.equal(inspect('https://venue.cityline.com.hk/queue?event=123').challengeType,'queue');
  assert.equal(inspect('https://venue.cityline.com.hk/login?event=123').challengeType,'login');
  assert.equal(inspect('https://venue.cityline.com.hk/utsvInternet/internet/eventDetail?event=124').stage,'unknown');
  assert.equal(inspect(URL_OK,{performances:[element(pii,{'data-perf-id':'bad<script>'})]}).stage,'unknown');
});

test('trusted login redirect is classified as manual handoff without issuing handles', () => {
  const x=fixture();
  const hostURL=x.wc.url;
  x.wc.url='https://venue.cityline.com.hk/login';
  const summary=x.pipeline.noteRead({
    windowId:42,providerId:'cityline',runId:x.run.id,
    page:{stage:'unknown',eventKey:null,providerEventId:null,
      challengeType:'login',challenge:'Sign in'}
  });
  assert.equal(summary.stage,'login');
  assert.equal(summary.challenge,'login');
  x.wc.url=hostURL;
  assert.equal(x.pipeline.noteRead({windowId:42,providerId:'cityline',page:testPage()}).stage,'options');
});
