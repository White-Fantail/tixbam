'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cases=require('./copilot/fixtures/nol-step-cases.json').cases;
const {scoreNolFixtures,NolValidationTimeline,evaluateNolRelease,classifyLabel}=
  require('./copilot/nol-validation.cjs');

test('NOL-05: synthetic taxonomy replays with independently named fixture labels',()=>{
  const score=scoreNolFixtures(cases);
  assert.equal(score.samples,18);
  assert.equal(score.syntheticCount,18);
  assert.equal(score.realReviewedCount,0);
  assert.equal(score.matched,18);
  assert.equal(score.unsafeMisclassifications,0);
  assert.equal(score.falseHoldClaims,0);
  assert.equal(score.measuredLiveRecognition,false);
  assert.equal(score.liveBookingSuccessRate,null);
  assert.equal(score.perLabel.seat_map.recall,1);
  assert.equal(score.perLabel.seat_map.precision,1);
});

test('NOL-05: sensitive-screen misclassification produces a hard warning',()=>{
  const altered=structuredClone(cases.find(x=>x.id==='auth-challenge'));
  altered.id='simulated-unsafe-queue';
  altered.input.visionStep='seat_map';
  altered.input.visionStage='selecting';
  const score=scoreNolFixtures([altered]);
  assert.equal(score.matched,0);
  assert.equal(score.unsafeMisclassifications,1);
  const release=evaluateNolRelease({classification:score});
  assert.equal(release.status,'HOLD');
  assert.ok(release.blockers.some(x=>x.includes('sensitive')));
});

test('NOL-05: stage confusion matrix counts predicted unknown without inventing success',()=>{
  const fixture=structuredClone(cases.find(x=>x.id==='seat-map'));
  fixture.input.visionConfidence=.90;
  const score=scoreNolFixtures([fixture]);
  assert.equal(score.confusion.seat_map.unknown,1);
  assert.equal(score.perLabel.seat_map.recall,0);
  assert.equal(score.perLabel.seat_map.precision,null);
  assert.equal(score.matchRate,0);
  assert.equal(score.liveBookingSuccessRate,null);
});

test('NOL-05: arbitrary model outputs, user labels and claimed screenshots cannot unlock production',()=>{
  const counterfeit={
    ...cases[0],id:'fake-real',
    fixtureType:'redacted_human_labeled_screen',
    humanReviewed:true,containsScreenshot:false,modelOutputFromActualScreen:true,
    claimedAccuracy:1,officialVendorConsent:true,releaseApproval:true
  };
  const scored=scoreNolFixtures([counterfeit]);
  assert.equal(scored.realReviewedCount,1);
  assert.equal(scored.measuredLiveRecognition,false);
  const result=evaluateNolRelease({classification:scored});
  assert.equal(result.productionAutomationAllowed,false);
  assert.equal(result.checkoutAutomationAllowed,false);
  assert.equal(result.officialHoldVerified,false);
});

test('NOL-05: P50/P95 observation latency is deterministic and no URL or personal data retained',()=>{
  const timeline=new NolValidationTimeline();
  timeline.record('observe_start',1000);
  timeline.record('observe_end',1100);
  timeline.record('observe_start',2000);
  timeline.record('observe_end',2400);
  timeline.record('observe_start',3000);
  timeline.record('observe_end',3900);
  const m=timeline.snapshot();
  assert.equal(m.observationCount,3);
  assert.deepEqual(m.observationLatencyMs,{p50:400,p95:900,max:900});
  assert.equal(m.officialHoldVerified,false);
  assert.equal(m.recordedEvents,6);
  const serialized=JSON.stringify(m);
  assert.ok(!serialized.includes('nol.yanolja.com'));
  assert.ok(!serialized.includes('accountId'));
});

test('NOL-05: a queue remains user-controlled and continuity is observation, never proof of queue position',()=>{
  const t=new NolValidationTimeline();
  t.record('queue_enter',100);
  t.record('queue_enter',101);
  t.record('manual_pause',102);
  assert.equal(t.snapshot().queueEntries,1);
  assert.equal(t.snapshot().queuePending,true);
  t.record('queue_resume',200);
  assert.equal(t.snapshot().queueResumptions,1);
  assert.equal(t.snapshot().queuePending,false);
  assert.equal(t.snapshot().officialHoldVerified,false);
});

test('NOL-05: no observation, forged provider claim or unusual timestamp grants authorization',()=>{
  const t=new NolValidationTimeline();
  assert.throws(()=>t.record('payment_authorized',100),/Invalid NOL diagnostic event/);
  assert.throws(()=>t.record('queue_enter',NaN),/Invalid NOL diagnostic event/);
  t.record('observe_start',100);
  assert.throws(()=>t.record('observe_end',99),/Out-of-order/);
  t.record('provider_hold_verified',101);
  const result=evaluateNolRelease({telemetry:t.snapshot()});
  assert.equal(result.status,'HOLD');
  assert.equal(result.liveSuccessRate,null);
  assert.ok(result.blockers.some(x=>x.includes('hold claim')));
});

test('NOL-05: timeline capacity is limited and screens never become hold evidence',()=>{
  const t=new NolValidationTimeline();
  for(let i=0;i<256;i++)t.record('manual_pause',i);
  assert.throws(()=>t.record('manual_pause',256),/event cap/);
  assert.equal(t.snapshot().manualPauses,256);
  assert.equal(t.snapshot().officialHoldVerified,false);
  const result=evaluateNolRelease({classification:scoreNolFixtures(cases),telemetry:t.snapshot()});
  assert.equal(result.status,'HOLD');
  assert.ok(result.blockers.length>=6);
});

test('NOL-05: refuse malformed fixture sources or unexpected label values',()=>{
  for(const invalid of [
    {id:'bad',input:{},expected:{step:'seat_map'},fixtureType:'unsafe'},
    {...cases[0],expected:{step:'privileged_system'}},
    {...cases[0],fixtureType:'new_unrecognized_source'}
  ])assert.throws(()=>scoreNolFixtures([invalid]),/Invalid|Unknown/);
  assert.equal(classifyLabel('selection_unknown','seat_conflict'),'seat_conflict');
});


test('NOL-05 local scorer accepts only fixed-origin reviewed metadata, never uploaded images',()=>{
  const {scoreLocalScreens}=require('../../../scripts/nol-score-screens.cjs');
  const original=cases.find(x=>x.id==='seat-map');
  const verified={
    id:'seatmap-reviewed-01',fixtureType:'redacted_human_labeled_screen',
    containsScreenshot:false,humanReviewed:true,modelOutputFromActualScreen:true,
    input:original.input,
    expected:{step:original.expected.step,substep:original.expected.substep}
  };
  const good=scoreLocalScreens({schemaVersion:1,cases:[verified]});
  assert.equal(good.samples,1);
  assert.equal(good.matched,1);
  assert.equal(good.release.status,'HOLD');
  assert.equal(good.release.productionAutomationAllowed,false);
  assert.throws(()=>scoreLocalScreens({schemaVersion:1,cases:[
    {...verified,input:{...verified.input,url:'https://nol.yanolja.com/account/?token=secret'}}
  ]}),/fixed NOL test origin/);
  assert.throws(()=>scoreLocalScreens({schemaVersion:1,cases:[
    {...verified,base64Screenshot:'secret'}
  ]}),/private media/);
  assert.throws(()=>scoreLocalScreens({schemaVersion:1,cases:[
    {...verified,humanReviewed:false}
  ]}),/unreviewed/);
});


test('NOL-05 CI report passes synthetic replay but ALWAYS keeps live release on HOLD',async()=>{
  const {report}=require('../../../scripts/nol-validation-report.cjs');
  const data=await report();
  assert.equal(data.ciResult,'PASS');
  assert.equal(data.offlineScenarioCount,18);
  assert.equal(data.syntheticFixtureAccuracy,1);
  assert.equal(data.actualVisualAccuracy,null);
  assert.equal(data.actualTicketHoldSuccessRate,null);
  assert.equal(data.release.status,'HOLD');
  assert.equal(data.release.productionAutomationAllowed,false);
  assert.equal(data.release.checkoutAutomationAllowed,false);
});
