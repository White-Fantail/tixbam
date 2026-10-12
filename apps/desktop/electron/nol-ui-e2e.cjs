'use strict';
/**
 * NOL-01..05 real React DOM regression in an isolated Electron window.
 * Runs ONLY local dist-nol-ui HTML, blocks all network, mocks IPC, never
 * loads a live provider URL, and never issues an actual booking action.
 */
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const {app,BrowserWindow,ipcMain,session}=require('electron');
const isolatedProfile=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-nol-offline-'));
app.setPath('userData',isolatedProfile);
app.on('will-quit',()=>{
  try{fs.rmSync(isolatedProfile,{recursive:true,force:true});}catch{}
});
const {assessNolScreen}=require('./copilot/nol-flow.cjs');
const {normalizePlan,planChoices}=require('./copilot/nol-strategy.cjs');
const {NolValidationTimeline}=require('./copilot/nol-validation.cjs');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

let win, resumes=0, stops=0, networkAttempts=0;
const planId='nol-offline-ui-plan';
const out=[],errors=[];
async function diagnostics(){
  if(!win||win.isDestroyed())return {window:'unavailable'};
  try{
    return await dom(`(()=>{
      const root=document.getElementById('root');
      return {
        readyState:document.readyState,
        href:location.protocol+'//'+location.host+location.pathname,
        rootFound:!!root,
        reactFixtureFound:!!document.querySelector('[data-testid="nol-ui-fixture"]'),
        rootText:(root?.textContent||'').slice(0,450),
        scripts:[...document.scripts].map(x=>({src:x.getAttribute('src'),type:x.type})),
        hasBridge:typeof window.tixbam==='object',
        bootError:document.querySelector('[data-testid="nol-ui-boot-error"]')?.textContent||null
      };
    })()`);
  }catch(e){return {diagnosticsError:String(e)};}
}
const base=(status,patch={})=>({
  windowId:42,planId,providerId:'nol',requestedMode:'observe',
  mode:'observe',status,reason:'Offline NOL validation fixture',
  attempts:1,expiresAt:Date.now()+120000,targets:[],automaticClicks:0,...patch
});
async function dom(js){
  if(!win||win.isDestroyed())throw Error('Fixture browser unavailable');
  return win.webContents.executeJavaScript(js,true);
}
async function waitFor(label,predicate,{timeout=7500}={}){
  const start=Date.now();
  while(Date.now()-start<timeout){
    const value=await predicate();
    if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,75));
  }
  throw Error('Timed out: '+label);
}
async function waitText(expected,{absent=false}={}){
  return waitFor((absent?'hidden ':'visible ')+expected,
    ()=>dom(`(()=>{const t=document.querySelector('[data-testid="nol-ui-fixture"]')?.textContent||'';return ${absent?'!t.includes('+JSON.stringify(expected)+')':'t.includes('+JSON.stringify(expected)+')'};})()`));
}
async function send(info){
  win.webContents.send('tixbam:copilot-advance-update',info);
}
async function scenario(name,task){
  await task();
  out.push({scenario:name,status:'PASS'});
}
async function setStage(value){
  await dom(`(()=>{const e=document.querySelector('#live-step');
    if(!e)throw Error('Missing real workspace stage selector');
    const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
    set.call(e,${JSON.stringify(value)});
    e.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor('controlled stage changed to '+value,()=>dom(
    `document.querySelector('#live-step')?.value===${JSON.stringify(value)}`));
}
async function clickButton(part){
  const found=await dom(`(()=>{const b=[...document.querySelectorAll('button')]
    .find(b=>b.textContent.includes(${JSON.stringify(part)}) && !b.disabled);
    if(!b)return false;b.click();return true;})()`);
  assert.equal(found,true,'Expected enabled button: '+part);
}
function observed(phase,stage,step){
  return assessNolScreen({
    url:'https://nol.yanolja.com/product/offline-fixture',phase,
    visionStage:stage,visionConfidence:.99,
    visionStep:step,visionStepConfidence:.99
  });
}
function needsText(text){
  return waitText(text);
}
async function run(){
  const fixture=path.join(__dirname,'../dist-nol-ui/nol-ui-fixture.html');
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const blocked=/^https?:/i.test(details.url);
    if(blocked)networkAttempts++;
    callback({cancel:blocked});
  });
  ipcMain.handle('nol-ui:resume',()=>{
    resumes++;
    return base('guiding',{reason:'Offline resume callback verified.'});
  });
  ipcMain.handle('nol-ui:stop',()=>{
    stops++;return true;
  });
  win=new BrowserWindow({
    width:1280,height:900,show:false,
    webPreferences:{
      contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,
      preload:path.join(__dirname,'nol-ui-preload.cjs')
    }
  });
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('did-fail-load',(_e,code,reason,url)=>{
    errors.push('Renderer load failed '+code+' '+reason+' '+url);
  });
  // Electron 37+ passes console details as ONE object. The old positional
  // listener silently swallowed renderer exceptions and hid why React failed.
  win.webContents.on('console-message',(_event,details)=>{
    const level=typeof details==='object'?details.level:null;
    const message=typeof details==='object'?details.message:'';
    if(level==='error'||level===3)
      errors.push('Renderer console error: '+String(message).slice(0,600));
  });
  win.webContents.on('preload-error',(_event,_preload,error)=>{
    errors.push('Renderer preload error: '+String(error?.stack||error).slice(0,1200));
  });
  win.webContents.on('render-process-gone',(_event,details)=>{
    errors.push('Renderer process gone: '+details.reason);
  });
  await win.loadFile(fixture);
  await waitFor('React fixture mounted',()=>dom(`!!document.querySelector('[data-testid="nol-ui-fixture"]')`));
  // The production JSX i18n plugin translates these titles in the default
  // Korean locale. English literals here caused a guaranteed boot timeout
  // even while the actual React UI had rendered correctly.
  await waitText('AI 예매 코파일럿');
  await waitText('TixBam 실시간 코파일럿');
  // The initial async Copilot status proves the production hook subscribed.
  await waitText('사전 승인 코파일럿');

  await scenario('NOL-01 event/detail + fail-closed human gate',async()=>{
    await send(base('awaiting_user',{
      providerStep:observed('preparing','event','event_detail')
    }));
    await needsText('NOL 화면 진단');
    await needsText('공연 상세');
    await send(base('awaiting_user',{
      providerStep:observed('queue','selecting','seat_map')
    }));
    await needsText('사용자 조작 필요');
  });

  await scenario('NOL-02 substep seat-map / conflict / sold-out / checkout',async()=>{
    await send(base('awaiting_user',{
      providerStep:observed('selecting','selecting','seat_map')
    }));
    await needsText('좌석 배치');
    await send(base('awaiting_user',{
      providerStep:observed('selecting','selecting','seat_conflict')
    }));
    await needsText('좌석 선택 충돌');
    await send(base('awaiting_user',{
      providerStep:observed('selecting','selecting','sold_out')
    }));
    await needsText('매진 표시');
    await send(base('hold_unverified',{
      providerStep:observed('checkout','checkout','cart_review'),
      holdEvidence:{status:'provider_verifier_unavailable',verified:false,
        reason:'Offline UI fixture: no official hold observer'}
    }));
    await needsText('좌석 보류 미확인');
    await needsText('NOL 공식 좌석 보류 검증: 미연결');
  });

  const preferences=normalizePlan({version:1,quantity:1,currency:'KRW',
    budgetMinor:150000,performanceId:'offline-performance',allowFallback:true,
    seatPreferences:{priceTier:['R','S'],section:['Main','Balcony'],
      floor:['1F','2F'],seatMode:'assigned'}});
  const offer={quantity:1,currency:'KRW',
    performanceId:'offline-performance',allInTotalMinor:120000,
    feesIncluded:true,availability:'visibly_available',seatMode:'assigned'};
  const candidates=[
    {kind:'seat',label:'Offline S Balcony',confidence:.99,offer:{
      ...offer,priceTier:'S',section:'Balcony',floor:'2F'}},
    {kind:'seat',label:'Offline R Main',confidence:.99,offer:{
      ...offer,priceTier:'R',section:'Main',floor:'1F'}},
    {kind:'seat',label:'Offline Fallback Upper',confidence:.99,offer:{
      ...offer,priceTier:'A',section:'Upper',floor:'3F'}}
  ];
  await scenario('NOL-03 rank one-ticket candidates and fallback without click',async()=>{
    const strategyInfo=planChoices(preferences,candidates);
    assert.deepEqual(strategyInfo.recommended.map(x=>x.label),
      ['Offline R Main','Offline S Balcony','Offline Fallback Upper']);
    assert.equal(strategyInfo.recommended[2].usedFallback,true);
    assert.equal(strategyInfo.actionAuthorized,false);
    await send(base('awaiting_user',{
      providerStep:observed('selecting','selecting','seat_map'),strategyInfo
    }));
    await needsText('NOL · 1장 우선 후보 검토');
    await needsText('Offline R Main');
    await needsText('Offline S Balcony');
    await needsText('Offline Fallback Upper');
    await needsText('대안');
    const top=await dom(`(()=>{const area=[...document.querySelectorAll('.copilot-candidates')]
      .find(x=>x.textContent.includes('NOL · 1장 우선 후보 검토'));
      const labels=[...area.querySelectorAll('p')].map(p=>p.textContent);
      return labels.filter(x=>x.includes('Offline '));})()`);
    assert.ok(top[0].includes('Offline R Main'),JSON.stringify(top));
    assert.ok(top[1].includes('Offline S Balcony'),JSON.stringify(top));

    // When fallback is disabled, an out-of-section or over-budget item must
    // disappear from the rendered recommendation list, not merely be dimmed.
    const strict=normalizePlan({...preferences,allowFallback:false,
      seatPreferences:{priceTier:['R'],section:['Main'],
        floor:['1F'],seatMode:'assigned'}});
    const strictChoices=planChoices(strict,[...candidates,{
      kind:'seat',label:'Offline Over Budget',confidence:.99,offer:{
        ...offer,priceTier:'R',section:'Main',floor:'1F',
        allInTotalMinor:220000
      }
    }]);
    assert.deepEqual(strictChoices.recommended.map(x=>x.label),['Offline R Main']);
    await send(base('awaiting_user',{
      providerStep:observed('selecting','selecting','seat_map'),
      strategyInfo:strictChoices
    }));
    await waitText('Offline S Balcony',{absent:true});
    await waitText('Offline Fallback Upper',{absent:true});
    await waitText('Offline Over Budget',{absent:true});
    const disabled=await dom(`[...document.querySelectorAll('button')]
      .some(x=>x.disabled && x.textContent.includes('AI 자동 진행'))`);
    assert.equal(disabled,true,'Real CopilotPanel must block unattended booking');
  });

  await scenario('NOL-04 no real hold, protected checkout and no capture',async()=>{
    await setStage('checkout');
    await send(base('hold_unverified',{
      providerStep:observed('checkout','checkout','cart_review'),
      holdEvidence:{status:'provider_verifier_unavailable',verified:false,
        reason:'Offline UI fixture no official hold'}
    }));
    await needsText('NOL 공식 좌석 보류 검증: 미연결');
    const capture=await dom(`[...document.querySelectorAll('.copilot-panel button')]
      .find(x=>x.textContent.includes('실제 예매 화면 가져오기'))?.disabled`);
    assert.equal(capture,true,'Capture must be disabled at protected checkout');
    assert.equal(networkAttempts,0,'No NOL network request was made');
  });

  await scenario('NOL-05 telemetry visible in real React workspace',async()=>{
    const t=new NolValidationTimeline();
    for(const [type,ms] of [['observe_start',1000],['observe_end',1250],
      ['queue_enter',1500],['manual_pause',1600],
      ['queue_resume',2000],['observe_start',2100],
      ['observe_end',2950],['hold_unverified',3000]])
      t.record(type,ms);
    const metrics=t.snapshot();
    assert.equal(metrics.observationLatencyMs.p95,850);
    await send(base('awaiting_user',{
      providerStep:observed('selecting','selecting','seat_map'),
      validationMetrics:metrics
    }));
    await needsText('NOL 검증 진단');
    await needsText('850ms');
    await needsText('1/1');
    assert.equal(metrics.officialHoldVerified,false);
  });

  await scenario('Real UI stage control, manual resume and stop buttons',async()=>{
    await setStage('queue');
    await waitFor('queue capture disabled',()=>dom(`(()=>{
      const b=[...document.querySelectorAll('.copilot-panel button')]
        .find(x=>x.textContent.includes('실제 예매 화면 가져오기'));
      return !!b && b.disabled;})()`));
    await setStage('selecting');
    await waitFor('capture enabled for selecting stage',()=>dom(`(()=>{
      const b=[...document.querySelectorAll('.copilot-panel button')]
        .find(x=>x.textContent.includes('실제 예매 화면 가져오기'));
      return !!b && !b.disabled;})()`));
    await send(base('awaiting_user',{
      providerStep:observed('selecting','selecting','seat_map')
    }));
    await waitFor('resume button available',()=>dom(`[...document.querySelectorAll('button')]
      .some(x=>x.textContent.includes('사용자 조작 완료')&&!x.disabled)`));
    await clickButton('사용자 조작 완료');
    await waitFor('manual resume IPC',()=>Promise.resolve(resumes===1));
    await needsText('Offline resume callback verified');
    await clickButton('자동화 중지');
    await waitFor('manual stop IPC',()=>Promise.resolve(stops===1));
    await waitText('사전 승인 코파일럿',{absent:true});
  });

  assert.deepEqual(errors,[],'Fixture renderer should not log fatal errors');
  assert.equal(networkAttempts,0);
  process.stdout.write(JSON.stringify({
    suite:'NOL Desktop real React DOM E2E',environment:'electron-offline',
    status:'PASS',scenarios:out,networkRequests:networkAttempts,
    officialPurchases:0,resumes,stops
  },null,2)+'\n');
}
const hardTimeout=setTimeout(()=>{
  process.stderr.write('NOL Desktop E2E hard timeout.\n');
  app.exit(1);
},90000);
app.whenReady().then(run).then(()=>{
  clearTimeout(hardTimeout);win?.destroy();app.exit(0);
}).catch(async error=>{
  clearTimeout(hardTimeout);
  process.stderr.write('NOL Desktop UI E2E FAILED: '+String(error?.stack||error)+'\n');
  const page=await diagnostics();
  process.stderr.write(JSON.stringify({passedSoFar:out,rendererErrors:errors,
    page,networkAttempts})+'\n');
  win?.destroy();app.exit(1);
});
