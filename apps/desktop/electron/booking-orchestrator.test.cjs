'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BookingStateMachine, InvalidTransition, PHASES, PUBLIC_STATUS, TERMINAL_PHASES
} = require('./booking/state-machine.cjs');
const { BookingOrchestrator } = require('./booking/orchestrator.cjs');
const { BookingRunner } = require('./booking/runner.cjs');
const { RehearsalAdapter } = require('./booking/rehearsal.cjs');

const prefs = {
  schemaVersion:1,quantity:1,maxTotalMinor:100000,currency:'HKD',
  requireTogether:false,allowFallback:false,checkout:'automatic',
  options:{performance:'p1',priceTier:['800'],section:[],floor:[],seatMode:'',fulfillment:''}
};
const offer = {
  id:'order-1',eventKey:'event-1',quantity:1,currency:'HKD',
  totalMinor:90000,feesIncluded:true,adjacent:true,available:true,
  priceTier:'800',performance:'p1',seats:['A1'],
};
function make(adapter, overrides = {}) {
  return new BookingRunner({
    adapter, preferences:prefs, eventKey:'event-1', windowId:7, rehearsal:true,
    notify:()=>{}, payment:adapter.paymentVerified
      ? {verified:true,submit:()=>adapter.pay()} : null,
    secret:{use:fn=>fn({testCard:true}),clear(){}}, ...overrides
  });
}
function deferred() {
  let resolve, reject;
  const promise=new Promise((res, rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}
function move(machine, event, evidence) {
  return machine.transition(machine.runId,machine.revision,event,evidence);
}

test('state machine is total, has unambiguous legacy status and starts by explicit events',()=> {
  assert.equal(new Set(PHASES).size,PHASES.length);
  assert.ok(PHASES.every(phase=>Object.hasOwn(PUBLIC_STATUS,phase)));
  const m=new BookingStateMachine('r1');
  assert.equal(m.phase,'CREATED');
  assert.equal(m.revision,0);
  assert.equal(move(m,'START').phase,'WAITING_FOR_SESSION');
  assert.equal(move(m,'SESSION_READY').phase,'OBSERVING');
  assert.equal(move(m,'OBSERVED').phase,'DECIDING');
  assert.equal(m.revision,3);
  assert.throws(()=>move(m,'SUBMIT_RETURNED'), InvalidTransition);
  assert.throws(()=>m.transition('wrong-id',m.revision,'NEED_USER'), /identity/);
  assert.throws(()=>m.transition(m.runId,1,'NEED_USER'), /Stale/);
  assert.equal(m.phase,'DECIDING');
  assert.equal(move(m,'NEED_USER').status,'awaiting_user');
  assert.equal(move(m,'USER_RESUMED').status,'running');
  assert.equal(move(m,'OBSERVED').phase,'DECIDING');
  assert.equal(move(m,'REVIEW_ORDER').status,'review');
  assert.equal(move(m,'REVIEW_REQUIRED').phase,'ORDER_REVIEW');
  assert.equal(move(m,'USER_CONFIRMED').phase,'OBSERVING');
  assert.equal(move(m,'OBSERVED').phase,'DECIDING');
  assert.equal(move(m,'REVIEW_ORDER').phase,'ORDER_REVIEW');
  assert.equal(move(m,'COMMIT_READY').phase,'READY_TO_COMMIT');
  assert.throws(()=>move(m,'COMMIT_STARTED'), /Verified payment/);
  assert.equal(m.commitStarted,false);
  assert.equal(move(m,'COMMIT_STARTED',{paymentProfileVerified:true}).status,'submitting');
  assert.equal(m.commitStarted,true);
  assert.throws(()=>move(m,'COMMIT_STARTED',{paymentProfileVerified:true}),InvalidTransition);
  assert.equal(move(m,'SUBMIT_RETURNED').phase,'VERIFYING');
  assert.equal(move(m,'CONTINUE').phase,'OBSERVING');
  assert.equal(move(m,'OBSERVED').phase,'DECIDING');
  assert.throws(()=>move(m,'VERIFIED_RECEIPT'), /receipt verification/);
  assert.equal(move(m,'VERIFIED_RECEIPT',{verifiedReceipt:true}).phase,'CONFIRMED');
  assert.ok(m.terminal);
  for (const action of ['STOP','FAIL','START','USER_RESUMED','SUBMIT_RETURNED']) {
    assert.throws(()=>move(m,action),/Terminal/);
  }
});

test('precommit stop/fail differs from postcommit unknown; no client event can reset latch',()=> {
  const m=new BookingStateMachine('r2');
  move(m,'START');move(m,'SESSION_READY');
  const rev=m.revision;
  assert.throws(()=>move(m,'UNKNOWN_PAYMENT'),/No attempted payment/);
  assert.equal(m.revision,rev);
  assert.equal(move(m,'STOP').phase,'STOPPED');
  assert.equal(m.publicStatus,'stopped');
  const m2=new BookingStateMachine('r3');
  move(m2,'START');move(m2,'SESSION_READY');move(m2,'OBSERVED');
  assert.equal(move(m2,'FAIL').phase,'FAILED');
  assert.ok(TERMINAL_PHASES.has(m2.phase));
  const m3=new BookingStateMachine('r4');
  move(m3,'START');move(m3,'SESSION_READY');move(m3,'OBSERVED');move(m3,'REVIEW_ORDER');
  move(m3,'COMMIT_READY');move(m3,'COMMIT_STARTED',{paymentProfileVerified:true});
  assert.equal(move(m3,'STOP').phase,'PAYMENT_UNKNOWN');
  assert.throws(()=>move(m3,'USER_RESUMED'), /Terminal/);
  const m4=new BookingStateMachine('r5');
  move(m4,'START');move(m4,'SESSION_READY');move(m4,'OBSERVED');move(m4,'REVIEW_ORDER');
  move(m4,'COMMIT_READY');move(m4,'COMMIT_STARTED',{paymentProfileVerified:true});
  assert.equal(move(m4,'FAIL').phase,'PAYMENT_UNKNOWN');
  assert.equal(BookingStateMachine.recoveryPhase({phase:'VERIFYING',commitStarted:false}),'PAYMENT_UNKNOWN');
  assert.equal(BookingStateMachine.recoveryPhase({status:'submitting'}),'PAYMENT_UNKNOWN');
  assert.equal(BookingStateMachine.recoveryPhase({status:'completed'}),'STOPPED');
  assert.equal(BookingStateMachine.recoveryPhase({phase:'OBSERVING'}),'STOPPED');
});

test('an orchestrator rejects stale handles/revisions and does not permit timer overlap',()=> {
  const notifications=[];
  let owner=true;
  const o=new BookingOrchestrator({
    runId:'orchestrator-1', eventKey:'event-1', windowId:42,
    rehearsal:true, notify:state=>notifications.push(state),
    assertWindow:()=>{if (!owner) throw new Error('wrong window');}
  });
  assert.equal(o.state.phase,'OBSERVING');
  assert.equal(o.state.status,'running');
  const first=o.begin();
  assert.ok(first);
  assert.equal(o.begin(),null);
  assert.equal(o.check(first),true);
  const oldRev=o.machine.revision;
  o.transition('OBSERVED','Reading');
  assert.throws(()=>o.machine.transition(o.state.id,oldRev,'NEED_USER'),/Stale/);
  o.transition('NEED_USER','Manual action');
  assert.equal(o.state.status,'awaiting_user');
  o.end(first);
  const second=o.begin();
  assert.equal(o.state.phase,'OBSERVING');
  assert.equal(o.check(first),false);
  assert.equal(o.check(second),true);
  owner=false;
  assert.throws(()=>o.check(second),/wrong window/);
  owner=true;
  o.interrupt('Stopped','Unknown');
  assert.equal(o.state.status,'stopped');
  assert.equal(o.check(second),false);
  assert.equal(second.signal.aborted,true);
  assert.equal(o.begin(),null);
  assert.equal(notifications.at(-1).status,'stopped');
  assert.ok(notifications.every((n,i)=>i===0 || n.revision>=notifications[i-1].revision));
});

test('stop during slow inspection prevents any provider action and never emits running again',async()=> {
  const gate=deferred(),events=[];
  let selected=0,cleared=0;
  const r=make({
    read:()=>gate.promise,
    selectOptions:()=>{selected++;return true;}
  },{notify:s=>events.push(s),secret:{use:()=>{},clear(){cleared++;}}});
  const job=r.step();
  assert.equal(r.busy,true);
  assert.equal(r.state.phase,'OBSERVING');
  r.stop();
  gate.resolve({eventKey:'event-1',stage:'options'});
  await job;
  assert.equal(r.busy,false);
  assert.equal(r.state.status,'stopped');
  assert.equal(selected,0);
  assert.ok(cleared>=1);
  assert.equal(events.at(-1).status,'stopped');
  await r.step();
  assert.equal(events.at(-1).status,'stopped');
});

test('stop during asynchronous reserve does not commit later states',async()=> {
  const reserved=deferred(),events=[];
  let count=0;
  const r=make({
    read:async()=>({eventKey:'event-1',stage:'offers',offers:[offer]}),
    reserve:async()=>{count++;await reserved.promise;}
  },{notify:s=>events.push(s)});
  const step=r.step();
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(count,1);
  assert.equal(r.state.phase,'EXECUTING_ACTION');
  r.stop();
  reserved.resolve();
  await step;
  assert.equal(r.state.status,'stopped');
  assert.equal(events.at(-1).status,'stopped');
});

test('slow payment after stop is UNKNOWN and never resumed or retried',async()=> {
  const payment=deferred();let paid=0;const events=[];
  const adapter={paymentVerified:true,read:async()=>({eventKey:'event-1',stage:'payment',order:offer}),pay:async()=>{paid++;return payment.promise;}};
  const r=make(adapter,{notify:s=>events.push(s)});
  const job=r.step();
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(paid,1);
  assert.equal(r.state.phase,'PAYMENT_COMMITTING');
  r.stop();
  assert.equal(r.state.status,'payment_unknown');
  payment.resolve();
  await job;
  assert.equal(r.state.status,'payment_unknown');
  assert.equal(events.at(-1).status,'payment_unknown');
  await r.step();await r.step(true);
  assert.equal(paid,1);
});

test('failed payment submit maps to UNKNOWN, bad read before submit maps to FAILED',async()=> {
  let attempts=0;
  const paid=make({paymentVerified:true,
    read:async()=>({eventKey:'event-1',stage:'payment',order:offer}),
    pay:async()=>{attempts++;throw Error('card numbers must not leak');}
  });
  await paid.step();
  assert.equal(paid.state.status,'payment_unknown');
  assert.equal(paid.state.message.includes('card numbers'),false);
  assert.equal(attempts,1);
  const invalid=make({paymentVerified:false,read:async()=>{throw Error('secret');}});
  await invalid.step();
  assert.equal(invalid.state.status,'failed');
  assert.equal(invalid.state.message.includes('secret'),false);
});

test('aborted run at host payment notification boundary does not call payment provider',async()=> {
  let runner,paid=0;
  const events=[];
  const adapter={paymentVerified:true,read:async()=>({eventKey:'event-1',stage:'payment',order:offer}),
    pay:async()=>{paid++;}};
  runner=make(adapter,{notify:s=>{
    events.push(s);
    if (s.phase==='PAYMENT_COMMITTING') runner.stop();
  }});
  await runner.step();
  assert.equal(paid,0);
  assert.equal(runner.submitted,true);
  assert.equal(runner.state.phase,'PAYMENT_UNKNOWN');
  assert.equal(events.at(-1).status,'payment_unknown');
});

test('rehearsal review, 3DS manual handoff, and receipt stay backwards-compatible',async()=> {
  const reviewPrefs={...prefs,checkout:'review'};
  const adapter=new RehearsalAdapter('event-1',reviewPrefs);
  const r=make(adapter,{preferences:reviewPrefs});
  await r.step();await r.step();await r.step();
  assert.equal(r.state.phase,'ORDER_REVIEW');
  assert.equal(r.state.status,'review');
  const before=r.state.revision;
  await r.step();
  assert.equal(r.state.revision,before);
  await r.step(true);
  assert.equal(r.submitted,true);
  assert.equal(r.state.phase,'OBSERVING');
  await r.step();
  assert.equal(r.state.status,'awaiting_user');
  adapter.completeChallenge();
  await r.step();
  assert.equal(r.state.phase,'CONFIRMED');
  assert.equal(r.state.status,'completed');
  assert.equal(r.state.receipt,'REHEARSAL-NO-CHARGE');
});

test('mid-read window ownership drift blocks selection and fails closed',async()=> {
  let owner=true,chosen=0;
  const gate=deferred();
  const r=make({read:()=>gate.promise,selectOptions:async()=>{chosen++;return true;}},
    {assertWindow:()=>{if(!owner) throw Error('owner changed');}});
  const work=r.step();owner=false;gate.resolve({eventKey:'event-1',stage:'options'});await work;
  assert.equal(chosen,0);
  assert.equal(r.state.phase,'FAILED');
  assert.equal(r.busy,false);
});


test('synchronous Stop from a resume notification cancels before re-observation',async()=> {
  let runner;let reads=0;
  const adapter={read:async()=>{
    reads++;
    return {eventKey:'event-1',stage:'unknown'};
  }};
  runner=make(adapter,{notify:state=>{
    if (state.message==='Resuming…') runner.stop();
  }});
  await runner.step();
  assert.equal(runner.state.status,'awaiting_user');
  await runner.step();
  assert.equal(runner.state.status,'stopped');
  assert.equal(reads,1);
  assert.equal(runner.busy,false);
});

test('all invalid transitions preserve revision and phase; no terminal can be revived',()=> {
  for(const phase of ['OBSERVING','DECIDING','VALIDATING_ACTION','EXECUTING_ACTION',
                       'OFFER_SELECTED','ORDER_REVIEW','WAITING_FOR_USER']) {
    const m=new BookingStateMachine('invariant-'+phase);
    move(m,'START'); move(m,'SESSION_READY');
    if(phase!=='OBSERVING') move(m,'OBSERVED');
    if(phase==='VALIDATING_ACTION') move(m,'VALIDATE_ACTION');
    else if(phase==='EXECUTING_ACTION'){move(m,'VALIDATE_ACTION');move(m,'ACTION_VALIDATED');}
    else if(phase==='OFFER_SELECTED') move(m,'OFFER_CHOSEN');
    else if(phase==='ORDER_REVIEW') move(m,'REVIEW_ORDER');
    else if(phase==='WAITING_FOR_USER') move(m,'NEED_USER');
    assert.equal(m.phase,phase);
    const revision=m.revision;
    assert.throws(()=>m.transition(m.runId,revision,'ARBITRARY_EXECUTE'),InvalidTransition);
    assert.equal(m.revision,revision);
    assert.equal(m.phase,phase);
    assert.equal(move(m,'STOP').phase,'STOPPED');
    assert.throws(()=>move(m,'START'),InvalidTransition);
  }
});
