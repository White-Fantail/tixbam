'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {RehearsalDriver,ScenarioAdapter,makeSyntheticOffer,makePreferences,deterministicNumber}=
  require('./booking/rehearsal-driver.cjs');
const {DEFINITIONS,getScenario}=require('./booking/rehearsal-fixtures.cjs');
const {PaymentAttemptLedger}=require('./booking/payment-attempts.cjs');
const PLAN={id:'c6df8a3a-676a-40f4-9c27-e8500938976a',artist:'Sample',
  title:'Fictional fan meeting',providerId:'cityline',quantity:2,
  budgetMinor:200000,currency:'HKD',requireTogether:true,
  allowFallback:true,preferencesReady:true};
function lab(t,overrides={}){
  const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-ab07-'));
  t.after(()=>fs.rmSync(rootDir,{recursive:true,force:true}));
  return new RehearsalDriver({rootDir,plan:{...PLAN,...overrides},ownerId:'demo-user'});
}
async function toReview(driver){
  await driver.next();await driver.next();await driver.next();
  return driver.state;
}
test('all scenarios are allowlisted and provider-neutral, deterministic seed yields same seats',()=>{
  assert.ok(DEFINITIONS.length>=12);
  const ids=new Set(DEFINITIONS.map(x=>x.id));
  assert.equal(ids.size,DEFINITIONS.length);
  for(const scenario of DEFINITIONS){assert.deepEqual(getScenario(scenario.id),scenario);}
  assert.equal(getScenario('https://cityline.com'),null);
  const prefs=makePreferences(PLAN,'standing');
  assert.equal(prefs.options.seatMode,'standing');
  const a=makeSyntheticOffer('same-run',prefs,2027,'standing');
  const b=makeSyntheticOffer('same-run',prefs,2027,'standing');
  assert.deepEqual(a,b);
  assert.equal(deterministicNumber(2027,'row'),deterministicNumber(2027,'row'));
  assert.ok(a.seats.every(x=>x.startsWith('GA-')));
  assert.equal(a.feesIncluded,true);
  assert.ok(a.totalMinor<=prefs.maxTotalMinor);
});
test('standard mock workflow uses real FSM and journal, has zero real payment calls',async t=>{
  const d=lab(t);
  assert.equal(d.state.status,'idle');
  await d.start('standard',42);
  assert.equal(d.state.status,'running');
  assert.equal(d.state.events.some(e=>e.phase==='OBSERVING'),true);
  const review=await toReview(d);
  assert.equal(review.status,'review');
  assert.equal(review.order.quantity,2);
  await assert.rejects(()=>d.next(),/Confirm/);
  await d.next({confirm:true});
  assert.equal(d.state.paymentAttempts,1);
  assert.equal(d.state.status,'running');
  await d.next();
  assert.equal(d.state.status,'completed');
  assert.equal(d.state.active,false);
  const folders=fs.readdirSync(path.join(d.folder,'runs'));
  assert.equal(folders.length,1);
  const receipt=new PaymentAttemptLedger(path.join(d.folder,'runs',folders[0]));
  assert.equal(receipt.recovered().length,0);
  assert.equal(receipt.journal.read().at(-1).type,'PURCHASE_CONFIRMED');
  const lines=fs.readFileSync(receipt.journal.file,'utf8');
  for(const secret of ['4242424242424242','cvv','https://','person@example.com',
    PLAN.artist,PLAN.title,PLAN.id])assert.equal(lines.includes(secret),false,secret);
  await assert.rejects(()=>d.next(),/No active rehearsal/);
  const after=new RehearsalDriver({rootDir:path.dirname(path.dirname(path.dirname(d.folder))),plan:PLAN,ownerId:'demo-user'});
  // Ensure host restart never restores a runnable BookingRunner.
  assert.equal(after.state.active,false);
  assert.equal(after.state.status,'completed');
});
test('queue and CAPTCHA require explicit human handoff, not a model confirmation',async t=>{
  for(const kind of ['queue','captcha']){
    const d=lab(t);
    await d.start(kind,2);
    await d.next();
    assert.equal(d.state.status,'awaiting_user');
    assert.equal(d.state.challenge,kind);
    await assert.rejects(()=>d.next({confirm:true}),/Only the order review/);
    await d.next({completeChallenge:true});
    assert.equal(d.state.status,'running');
    assert.equal(d.state.challenge,'none');
    await d.next();
    assert.equal(d.state.status,'running');
    await d.next();
    assert.equal(d.state.status,'review');
  }
});
test('sold out and unapproved nonadjacent allocation stop before cart and payment',async t=>{
  for(const kind of ['sold_out','adjacency']){
    const d=lab(t);
    await d.start(kind,5);
    await d.next();await d.next();
    assert.equal(d.state.status,'awaiting_user');
    assert.equal(d.state.order,null);
    assert.equal(d.state.paymentAttempts,0);
    assert.equal(fs.readdirSync(path.join(d.folder,'runs')).length,1);
  }
});
test('standing, automatic allocation and separate-seat policy remain validated',async t=>{
  for(const kind of ['standing','automatic']){
    const d=lab(t);await d.start(kind,7);
    await toReview(d);
    assert.equal(d.state.status,'review');
    assert.equal(d.state.order.seats.length,kind==='standing'?0:PLAN.quantity);
  }
  const loose=lab(t,{requireTogether:false});
  await loose.start('adjacency',7);
  await toReview(loose);
  assert.equal(loose.state.status,'review');
});
test('quote and fees drift before checkout refuse commit and preserve the budget',async t=>{
  for(const kind of ['price_change','fees_change']){
    const d=lab(t);await d.start(kind,123);
    await toReview(d);
    assert.equal(d.state.status,'review');
    await d.next({confirm:true});
    assert.equal(d.state.status,'awaiting_user');
    assert.equal(d.state.paymentAttempts,0);
    const id=fs.readdirSync(path.join(d.folder,'runs'))[0];
    const entries=new PaymentAttemptLedger(path.join(d.folder,'runs',id)).journal.read();
    assert.equal(entries.length,0);
  }
});
test('mock 3-D Secure requires human input and verified synthetic receipt',async t=>{
  const d=lab(t);await d.start('bank_3ds',55);await toReview(d);
  await d.next({confirm:true});assert.equal(d.state.paymentAttempts,1);
  await d.next();assert.equal(d.state.status,'awaiting_user');
  assert.equal(d.state.challenge,'3ds');
  await assert.rejects(()=>d.next({confirm:true}),/Only the order review/);
  await d.next({completeChallenge:true});
  assert.equal(d.state.status,'completed');
});
test('timeout, unknown charge and simulated crash lock payment after a single attempt',async t=>{
  for(const kind of ['payment_timeout','unknown_charge','restart']){
    const d=lab(t);await d.start(kind,99);await toReview(d);
    await d.next({confirm:true});
    assert.equal(d.state.status,'payment_unknown');
    assert.equal(d.state.paymentAttempts,1);
    await assert.rejects(()=>d.next({confirm:true}),/No active rehearsal/);
    const id=fs.readdirSync(path.join(d.folder,'runs'))[0];
    assert.equal(new PaymentAttemptLedger(path.join(d.folder,'runs',id)).recovered().length,1);
    await d.simulateRestart();
    assert.equal(d.state.status,'payment_unknown');
    assert.equal(d.state.recovered,true);
    await assert.rejects(()=>d.next(),/No active rehearsal/);
  }
});
test('safe restart during pending mock payment ignores late completion and locks history',async t=>{
  const d=lab(t);await d.start('standard',123);await toReview(d);
  let done;
  const gate=new Promise(resolve=>{done=resolve;});
  d.adapter.pay=async()=>{d.adapter.payments++;await gate;d.adapter.stage='confirmation';};
  const committing=d.next({confirm:true});
  await new Promise(resolve=>setImmediate(resolve));
  const id=fs.readdirSync(path.join(d.folder,'runs'))[0];
  const ledger=new PaymentAttemptLedger(path.join(d.folder,'runs',id));
  assert.equal(ledger.recovered().length,1);
  // A new process sees the durable unknown outcome even if current process is waiting.
  const reloaded=new RehearsalDriver({
    rootDir:path.dirname(path.dirname(path.dirname(d.folder))),plan:PLAN,ownerId:'demo-user'});
  assert.equal(reloaded.state.status,'payment_unknown');
  assert.equal(reloaded.state.active,false);
  // Simulate termination of the in-flight host run before mock gateway reply.
  d.runner.stop();done();await committing;
  await d.simulateRestart();
  assert.equal(d.state.status,'payment_unknown');
});
test('restarting before a commit never restores execution privileges',async t=>{
  const d=lab(t);await d.start('standard',30);await d.next();
  await d.simulateRestart();
  assert.equal(d.state.status,'stopped');
  assert.equal(d.state.active,false);
  await assert.rejects(()=>d.next(),/No active rehearsal/);
  await d.start('standard',30);
  assert.equal(d.state.status,'running');
});
test('scenario mutations reject invalid identifiers and hostile inputs',async t=>{
  const d=lab(t);
  for(const id of ['<script>','unknown','https://example.test','__proto__']){
    await assert.rejects(()=>d.start(id,2027),/Unknown/);
  }
  for(const seed of [-1,1000000,NaN,'123',1.5]){
    await assert.rejects(()=>d.start('standard',seed),/Unknown/);
  }
  assert.equal(d.state.status,'idle');
  await d.start('standard',10);
  await assert.rejects(()=>d.start('standard',10),/Stop/);
  await assert.rejects(()=>d.next({completeChallenge:true}),/No manual challenge/);
  await d.stop();assert.equal(d.state.status,'stopped');
});
test('entire lab runs without provider browser window, cards, fetch, or app sessions',async t=>{
  const d=lab(t);
  const beforeFetch=global.fetch;
  global.fetch=()=>{throw Error('No network ever');};
  try{
    await d.start('standard');await toReview(d);
    await d.next({confirm:true});await d.next();
    assert.equal(d.state.status,'completed');
  }finally{global.fetch=beforeFetch;}
});

test('stale inventory between observation and reservation never creates a cart',async t=>{
  const d=lab(t);await d.start('stale',88);
  await d.next();await d.next();
  assert.equal(d.state.status,'failed');
  assert.equal(d.state.order,null);
  assert.equal(d.state.paymentAttempts,0);
  const id=fs.readdirSync(path.join(d.folder,'runs'))[0];
  assert.equal(new PaymentAttemptLedger(path.join(d.folder,'runs',id)).journal.read().length,0);
});
test('invalid budget and quantity cannot open a mock payment flow',async t=>{
  for(const plan of [{budgetMinor:0},{quantity:0},{currency:'not-a-currency'}]){
    const d=lab(t,plan);
    await assert.rejects(()=>d.start('standard'),/budget and quantity/);
  }
});


test('AB-10 strict rehearsal offer metadata reconciles fees and rejects risky scenarios',async t=>{
  for(const kind of ['standard','standing','automatic']){
    const d=lab(t);
    await d.start(kind,2027);
    await d.next();await d.next();await d.next();
    assert.equal(d.state.status,'review',kind);
    assert.equal(d.adapter.offer.schemaVersion,2);
    assert.equal(d.adapter.offer.totalMinor,
      Object.values(d.adapter.offer.feeBreakdown).reduce((a,b)=>a+b,0));
    assert.equal(d.adapter.offer.totalVerified,true);
  }
  for(const kind of ['restricted_view','unknown_fees','auto_unverified']){
    const d=lab(t);
    await d.start(kind,2027);await d.next();await d.next();
    assert.equal(d.state.status,'awaiting_user',kind);
    assert.equal(d.state.paymentAttempts,0);
    assert.equal(d.adapter.order,null);
  }
});
