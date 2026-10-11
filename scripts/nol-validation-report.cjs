'use strict';
/**
 * NOL-05 offline CI report. A PASS means the mock classifier stayed safe,
 * NOT that NOL has granted permission or that live seats can be held.
 */
const path=require('node:path');
const {scoreNolFixtures,NolValidationTimeline,evaluateNolRelease}=
  require('../apps/desktop/electron/copilot/nol-validation.cjs');
const fixtures=require('../apps/desktop/electron/copilot/fixtures/nol-step-cases.json');
const {NolSandboxProvider,NolSandboxJournal,NolSandboxExecutor}=
  require('../apps/desktop/electron/copilot/nol-execution.cjs');
const {readFileSync}=require('node:fs');
const root=path.resolve(__dirname,'..');
async function report(){
  const scored=scoreNolFixtures(fixtures.cases);
  const timeline=new NolValidationTimeline();
  // Deterministic diagnostic replay, not real network/browser timing.
  for(const [event,at] of [
    ['observe_start',1000],['observe_end',1200],
    ['queue_enter',1300],['manual_pause',1350],['queue_resume',2000],
    ['observe_start',2100],['observe_end',2600],
    ['seat_conflict',2650],['manual_pause',2700],
    ['hold_unverified',2900]
  ])timeline.record(event,at);
  const metrics=timeline.snapshot();
  const release=evaluateNolRelease({classification:scored,telemetry:metrics});
  const addon=JSON.parse(readFileSync(
    path.join(root,'apps/desktop/addons/catalog.json'),'utf8'))
    .find(x=>x.id==='nol');
  const restricted=addon?.automation?.level2?.status==='restricted' &&
    addon?.automation?.level3?.status==='restricted';
  const safeSandbox=typeof NolSandboxExecutor==='function' &&
    typeof NolSandboxJournal==='function' &&
    typeof NolSandboxProvider==='function';
  const ciPass=scored.syntheticCount===fixtures.cases.length&&
    scored.samples>=18&&scored.matched===scored.samples &&
    scored.unsafeMisclassifications===0&&scored.falseHoldClaims===0&&
    scored.realReviewedCount===0&&release.status==='HOLD'&&
    release.productionAutomationAllowed===false&&restricted&&safeSandbox;
  return {
    schemaVersion:1,provider:'nol',environment:'offline_synthetic_only',
    ciResult:ciPass?'PASS':'FAIL',
    syntheticFixtureAccuracy:scored.matchRate,
    actualVisualAccuracy:null,actualTicketHoldSuccessRate:null,
    offlineScenarioCount:scored.samples,
    humanReviewedRealScreenCount:scored.realReviewedCount,
    confusionMatrix:scored.confusion,
    offlineReplayLatencyMs:metrics.observationLatencyMs,
    latencyProvenance:'deterministic_simulation_not_live_performance',
    queueContinuity:'transition_count_only_not_provider_queue_proof',
    release
  };
}
if(require.main===module){
  report().then(result=>{
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result.ciResult!=='PASS')process.exitCode=1;
  }).catch(error=>{
    process.stderr.write('NOL-05 offline validation failed: '+String(error)+'\n');
    process.exitCode=1;
  });
}
module.exports={report};
