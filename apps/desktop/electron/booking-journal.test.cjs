'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {PaymentAttemptLedger,scan}=require('./booking/payment-attempts.cjs');
const {DurableBookingJournal,JournalUnavailable}=require('./booking/journal.cjs');
const {BookingRunner}=require('./booking/runner.cjs');
const {RehearsalAdapter}=require('./booking/rehearsal.cjs');

function temp(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-payment-journal-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
const prefs={schemaVersion:1,quantity:2,maxTotalMinor:200000,currency:'HKD',
  requireTogether:true,allowFallback:true,checkout:'automatic',
  options:{performance:'demo-evening',priceTier:['800','500'],section:[],floor:[],seatMode:'',fulfillment:''}};
const order={id:'mock-order-1',eventKey:'event-key-1',
  available:true,quantity:2,currency:'HKD',totalMinor:167000,feesIncluded:true,
  adjacent:true,priceTier:'800',performance:'demo-evening',seats:['A1','A2']};
const permit={accountId:'account@example.test',providerId:'cityline',
  planId:'plan-1',saleId:'sale-1',performanceId:'demo-evening',eventKey:'event-key-1',
  quantity:2,currency:'HKD',maxAllInMinor:200000,requireTogether:true,
  allowFallback:true,checkout:'automatic'};
const uid=()=>crypto.randomUUID();
function commit(ledger,overrides={}){
  const {runId=uid(),p=permit,o=order,rehearsal=false}=overrides;
  return ledger.recordCommitIntent({runId,permit:p,order:o,rehearsal});
}

test('a three-record commit intent is fsynced, append-only, private, and never stores PII',t=>{
  const dir=temp(t),ledger=new PaymentAttemptLedger(dir);
  const intent=commit(ledger);
  const f=ledger.journal.file;
  const records=ledger.journal.read();
  assert.deepEqual(records.map(r=>r.type),[
    'RUN_CREATED','OFFER_LOCKED','COMMIT_INTENT_RECORDED']);
  assert.equal(records[2].seq,3);
  assert.equal(records[2].attemptId,intent.attemptId);
  assert.equal(intent.journalSequence,3);
  assert.equal(ledger.hasAttempt(permit),true);
  const data=fs.readFileSync(f,'utf8');
  for(const secret of [
    permit.accountId,permit.planId,permit.saleId,permit.performanceId,
    permit.eventKey,order.id,'A1','A2','4242424242424242',
    'cvv','password','orderUrl','https://'
  ])assert.equal(data.includes(secret),false,secret);
  assert.ok(data.endsWith('\n'));
  if(process.platform!=='win32'){
    assert.equal(fs.statSync(f).mode&0o777,0o600);
    assert.equal(fs.statSync(path.dirname(f)).mode&0o777,0o700);
  }
  const recovered=ledger.recovered();
  assert.equal(recovered.length,1);
  assert.equal(recovered[0].status,'payment_unknown');
  assert.equal(recovered[0].attemptId,intent.attemptId);
  assert.equal(JSON.stringify(recovered).includes(permit.eventKey),false);
});

test('restart after recorded intent blocks duplicate submission even if process died before submit',t=>{
  const dir=temp(t),first=new PaymentAttemptLedger(dir);
  const old=commit(first);
  const second=new PaymentAttemptLedger(dir);
  assert.equal(second.hasAttempt(permit),true);
  assert.equal(second.recovered()[0].attemptId,old.attemptId);
  for(const p of [
    permit,{...permit,planId:'other-plan'},{...permit,quantity:1,maxAllInMinor:250000},
    {...permit,checkout:'review'}, {...permit,requireTogether:false},
  ]){
    const matchingOrder={...order,quantity:p.quantity,priceTier:'800'};
    assert.throws(()=>commit(second,{p,o:matchingOrder}),/duplicate_purchase_intent/);
  }
  const another={...permit,saleId:'sale-2',eventKey:'event-key-2'};
  assert.doesNotThrow(()=>commit(second,{p:another,o:{...order,eventKey:'event-key-2'}}));
  assert.equal(new PaymentAttemptLedger(dir).recovered().length,2);
});

test('returning submission, stop and missing receipt remain UNKNOWN across restart',t=>{
  const dir=temp(t),ledger=new PaymentAttemptLedger(dir);
  const intent=commit(ledger);
  ledger.submissionReturned(intent);
  ledger.markUnknown(intent);
  assert.equal(ledger.recovered()[0].status,'payment_unknown');
  assert.throws(()=>ledger.submissionReturned(intent),/already_recorded/);
  assert.throws(()=>ledger.confirmRehearsal(intent,'REHEARSAL-NO-CHARGE'),/receipt_not_verified/);
  const restarted=new PaymentAttemptLedger(dir);
  assert.equal(restarted.recovered()[0].status,'payment_unknown');
  assert.throws(()=>commit(restarted),/duplicate_purchase_intent/);
});

test('only explicit synthetic verified receipt can close a rehearsal attempt',t=>{
  const ledger=new PaymentAttemptLedger(temp(t));
  const intent=commit(ledger,{rehearsal:true});
  assert.throws(()=>ledger.confirmRehearsal(intent,'foreign-receipt'),/receipt_not_verified/);
  ledger.submissionReturned(intent);
  ledger.confirmRehearsal(intent,'REHEARSAL-NO-CHARGE');
  assert.equal(ledger.recovered().length,0);
  assert.throws(()=>commit(ledger,{rehearsal:true}),/duplicate_purchase_intent/);
  assert.throws(()=>ledger.markUnknown(intent),/already_completed/);
});

test('failed fsync leaves an unresolved, unretryable boundary and never acknowledges commit',t=>{
  const dir=temp(t);
  let fault='before_fsync';
  const ledger=new PaymentAttemptLedger(dir,{fault:point=>{
    if(point===fault)throw Error('simulated EIO');
  }});
  assert.throws(()=>commit(ledger),/storage_io_failure/);
  assert.equal(ledger.journal.locked,true);
  assert.throws(()=>commit(ledger),/poisoned/);
  const reopened=new PaymentAttemptLedger(dir);
  assert.equal(reopened.hasAttempt(permit),true);
  assert.throws(()=>commit(reopened),/journal_locked/);
  fault=null;
});

test('failure before append can safely retry while a partial-write or fsync failure cannot',t=>{
  const dir=temp(t);
  const l=new PaymentAttemptLedger(dir,{fault:point=>{
    if(point==='before_append')throw Error('simulated disk full');
  }});
  assert.throws(()=>commit(l),/storage_io_failure/);
  assert.equal(l.recovered().length,0);
  const reboot=new PaymentAttemptLedger(dir);
  assert.equal(reboot.hasAttempt(permit),false);
  assert.doesNotThrow(()=>commit(reboot));
});

test('crash after fsync but before acknowledgement still creates an irrevocable intent',t=>{
  const dir=temp(t);
  const l=new PaymentAttemptLedger(dir,{fault:point=>{
    if(point==='after_fsync')throw Error('process killed');
  }});
  assert.throws(()=>commit(l),/storage_io_failure/);
  assert.equal(new PaymentAttemptLedger(dir).recovered().length,1);
  assert.throws(()=>new PaymentAttemptLedger(dir).recordCommitIntent({
    runId:uid(),permit,order
  }),/journal_locked/);
});

test('corrupt tail, tampered hash, missing key and missing journal fail closed',t=>{
  for(const kind of ['tail','integrity','missing_key','missing_journal']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-ledger-corrupt-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const ledger=new PaymentAttemptLedger(dir);commit(ledger);
    const f=ledger.journal.file,key=path.join(path.dirname(f),'journal-v1.key');
    if(kind==='tail')fs.appendFileSync(f,Buffer.from('{"partial":'));
    if(kind==='integrity'){
      const text=fs.readFileSync(f,'utf8');
      fs.writeFileSync(f,text.replace('"RUN_CREATED"','"RUN_STOPPED"'),{mode:0o600});
    }
    if(kind==='missing_key')fs.unlinkSync(key);
    if(kind==='missing_journal')fs.unlinkSync(f);
    assert.throws(()=>new PaymentAttemptLedger(dir),JournalUnavailable,kind);
  }
});

test('unsafe file permissions and symlink are rejected, not silently repaired',t=>{
  if(process.platform==='win32')return;
  const dir=temp(t),ledger=new PaymentAttemptLedger(dir);
  const f=ledger.journal.file;
  fs.chmodSync(f,0o644);
  assert.throws(()=>new PaymentAttemptLedger(dir),/unsafe_file_permissions/);
  fs.chmodSync(f,0o600);
  const other=path.join(dir,'elsewhere');
  fs.renameSync(f,other);fs.symlinkSync(other,f);
  assert.throws(()=>new PaymentAttemptLedger(dir),JournalUnavailable);
});

test('exclusive file lock rejects an overlapping process and is never blindly reclaimed',t=>{
  const dir=temp(t),ledger=new PaymentAttemptLedger(dir);
  const lock=path.join(path.dirname(ledger.journal.file),'journal-v1.lock');
  const fd=fs.openSync(lock,'wx',0o600);
  try{
    assert.throws(()=>commit(new PaymentAttemptLedger(dir)),/journal_locked/);
    assert.equal(fs.existsSync(lock),true);
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  assert.doesNotThrow(()=>commit(new PaymentAttemptLedger(dir)));
});

test('bounded retention never evicts unresolved attempts; full journal denies new payment',t=>{
  const dir=temp(t);
  const ledger=new PaymentAttemptLedger(dir,{maxBytes:4096});
  commit(ledger);
  let denied=false;
  for(let i=0;i<15;i++){
    const p={...permit,performanceId:'other-performance-'+i,eventKey:'event-'+i};
    try{commit(ledger,{p,o:{...order,eventKey:p.eventKey,performance:p.performanceId}});}
    catch(e){assert.ok(e instanceof JournalUnavailable);denied=true;break;}
  }
  assert.equal(denied,true);
  assert.equal(new PaymentAttemptLedger(dir,{maxBytes:4096}).hasAttempt(permit),true);
});

test('invalid order or permit, unknown fees, and mismatched currency never write a commit',t=>{
  const ledger=new PaymentAttemptLedger(temp(t));
  for(const o of [{...order,feesIncluded:false},{...order,totalMinor:200001},
                  {...order,eventKey:'wrong'}, {...order,currency:'USD'},
                  {...order,quantity:1},{...order,adjacent:false},
                  {...order,seats:['']}]){
    assert.throws(()=>commit(ledger,{o}),JournalUnavailable);
  }
  for(const p of [{...permit,currency:'BTC'},{...permit,accountId:''},
                  {...permit,quantity:0},{...permit,maxAllInMinor:null}]){
    assert.throws(()=>commit(ledger,{p}),JournalUnavailable);
  }
  assert.equal(ledger.journal.read().length,0);
});

test('payment runner must durably commit before attempting a simulated provider submission',async t=>{
  const ledger=new PaymentAttemptLedger(temp(t));
  let pay=0;
  const adapter={read:async()=>({eventKey:'event-key-1',stage:'payment',order}),
    pay:async()=>{pay++;}};
  const r=new BookingRunner({adapter,eventKey:'event-key-1',preferences:prefs,
    rehearsal:true,notify:()=>{},secret:{use:fn=>fn(null),clear(){}},
    payment:{verified:true,submit:()=>adapter.pay()},ledger,purchasePermit:permit});
  await r.step();
  assert.equal(pay,1);
  assert.equal(r.submitted,true);
  assert.equal(ledger.recovered().length,1);
  await r.step();
  assert.equal(pay,1);
  assert.equal(r.state.status,'payment_unknown');
  assert.throws(()=>commit(new PaymentAttemptLedger(path.dirname(path.dirname(ledger.journal.file)))),/duplicate_purchase_intent/);
});

test('a runner without a durable ledger can never submit a live payment',async()=>{
  let pay=0;
  const r=new BookingRunner({
    adapter:{read:async()=>({eventKey:'event-key-1',stage:'payment',order})},
    eventKey:'event-key-1',preferences:prefs,rehearsal:false,
    notify:()=>{},payment:{verified:true,submit:()=>{pay++;}},
    secret:{use:fn=>fn({}),clear(){}}
  });
  await r.step();
  assert.equal(pay,0);
  assert.equal(r.submitted,false);
  assert.equal(r.state.status,'failed');
});

test('UI-triggered Stop after durable commit but before submit cannot send even one payment',async t=>{
  const ledger=new PaymentAttemptLedger(temp(t));let pay=0,runner;
  runner=new BookingRunner({
    adapter:{read:async()=>({eventKey:'event-key-1',stage:'payment',order})},
    eventKey:'event-key-1',preferences:prefs,rehearsal:true,
    payment:{verified:true,submit:()=>{pay++;}},
    secret:{use:fn=>fn({}),clear(){}},ledger,purchasePermit:permit,
    notify:state=>{if(state.phase==='PAYMENT_COMMITTING')runner.stop();}
  });
  await runner.step();
  assert.equal(pay,0);
  assert.equal(runner.state.status,'payment_unknown');
  assert.equal(ledger.recovered().length,1);
  assert.throws(()=>commit(ledger),/duplicate_purchase_intent/);
});

test('successful offline rehearsal remains compatible without persisting mock payment as a real purchase',async()=>{
  const adapter=new RehearsalAdapter('event-key-1',prefs);
  const runner=new BookingRunner({adapter,eventKey:'event-key-1',
    rehearsal:true,preferences:prefs,notify:()=>{},
    payment:{verified:true,submit:()=>adapter.pay()},
    secret:{use:fn=>fn(null),clear(){}}
  });
  await runner.step();await runner.step();await runner.step();
  await runner.step(true);await runner.step();
  adapter.completeChallenge();await runner.step();
  assert.equal(runner.state.status,'completed');
});


test('restarting Desktop surfaces unresolved payment in booking list without enabling replay',async t=>{
  const vm=require('node:vm');
  const dir=temp(t);
  const l=new PaymentAttemptLedger(dir);
  const intent=commit(l);l.submissionReturned(intent);
  const controllerFile=path.join(__dirname,'booking/controller.cjs');
  const loaded={exports:{}},handlers=new Map(),lifecycle=new Map();
  const localRequire=name=>name==='electron'?
    {Notification:{isSupported:()=>false}}:
    name.startsWith('.')?require(path.resolve(path.dirname(controllerFile),name)):require(name);
  vm.runInNewContext(fs.readFileSync(controllerFile,'utf8'),{
    module:loaded,require:localRequire,
    setInterval:()=>1,clearInterval:()=>{}
  });
  const config={app:{getPath:()=>dir,on:(name,handler)=>lifecycle.set(name,handler)},
    safeStorage:{isEncryptionAvailable:()=>false},
    ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
    dashboardOnly:event=>{if(!event.authorized)throw Error('Unauthorized');},
    ticketWindows:new Map(),requireInstalled:()=>{throw Error('unneeded')},
    resolveAddonUrl:()=>{throw Error('unneeded')},send:()=>{}};
  loaded.exports.registerBooking(config);
  const list=()=>handlers.get('tixbam:list-bookings')({authorized:true});
  const result=list();
  assert.equal(result.length,1);
  assert.equal(result[0].status,'payment_unknown');
  assert.equal(result[0].phase,'PAYMENT_UNKNOWN');
  assert.equal(result[0].storageRecovered,true);
  assert.equal(result[0].attemptId,intent.attemptId);
  assert.ok(result[0].message.includes('official provider order history'));
  assert.throws(()=>handlers.get('tixbam:list-bookings')({authorized:false}),/Unauthorized/);
  // A recovered attempt is informational/terminal, not a resumable run.
  await assert.rejects(()=>handlers.get('tixbam:resume-booking')({authorized:true},result[0].id),
    /Booking run not found/);
  lifecycle.get('before-quit')();
  // Broken disk history must not be reported as an empty, successful state.
  fs.appendFileSync(l.journal.file,'{\"partial\":');
  const reloaded={exports:{}},handlers2=new Map();
  vm.runInNewContext(fs.readFileSync(controllerFile,'utf8'),{
    module:reloaded,require:localRequire,
    setInterval:()=>1,clearInterval:()=>{}
  });
  reloaded.exports.registerBooking({...config,ipcMain:{
    handle:(name,handler)=>handlers2.set(name,handler)
  }});
  const failed=handlers2.get('tixbam:list-bookings')({authorized:true});
  assert.equal(failed.length,1);
  assert.equal(failed[0].id,'journal-unavailable');
  assert.equal(failed[0].status,'payment_unknown');
  assert.ok(failed[0].message.includes('blocked'));
});

test('journal never silently auto-repairs a missing fingerprint key after restart',t=>{
  const dir=temp(t),l=new PaymentAttemptLedger(dir);
  commit(l);
  fs.unlinkSync(path.join(path.dirname(l.journal.file),'journal-v1.key'));
  assert.throws(()=>new PaymentAttemptLedger(dir),/incomplete_or_deleted_journal/);
});
