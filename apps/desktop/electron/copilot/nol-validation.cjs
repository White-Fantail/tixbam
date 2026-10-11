'use strict';
/**
 * NOL-05 validation-only telemetry and fixture scoring.
 * Only predetermined stage/status codes and durations are accepted.
 * No URL, user ID, session cookie, screenshot, seat coordinates or tokens.
 */
const {assessNolScreen}=require('./nol-flow.cjs');
const {NOL_STEPS}=require('./nol-taxonomy.cjs');
const SENSITIVE=new Set(['human_gate','checkout_unverified','seat_conflict','sold_out']);
const EVENTS=new Set(['observe_start','observe_end','manual_pause',
  'queue_enter','queue_resume','hold_unverified','click_attempt',
  'click_rejected','seat_conflict','sold_out','stop','provider_hold_verified']);
const MAX_EVENTS=256;
const MAX_OBSERVATION_MS=120000;
function percentile(values,p){
  if(!values.length)return null;
  const s=[...values].sort((a,b)=>a-b);
  return s[Math.max(0,Math.ceil(p*s.length)-1)];
}
function classifyLabel(step,substep){
  if(['seat_conflict','sold_out'].includes(substep))return substep;
  if(step==='human_gate'||substep==='human_gate')return 'human_gate';
  if(step==='checkout_unverified'||substep==='cart_review')return 'checkout_unverified';
  return substep&&substep!=='unknown'&&NOL_STEPS.includes(substep)?substep:step||'unknown';
}
function scoreNolFixtures(fixtures){
  if(!Array.isArray(fixtures)||fixtures.length>500)throw Error('Invalid NOL validation fixtures');
  const labels=new Set(['event_detail','performance_date','seat_map',
    'price_quantity','seat_conflict','sold_out','checkout_unverified',
    'human_gate','selection_unknown','unknown']);
  const confusion={}, per={};let matched=0,unknown=0,falseSafe=0,falseHold=0;
  let syntheticCount=0,realReviewedCount=0;
  for(const item of fixtures){
    if(!item||typeof item!=='object'||!item.input||!item.expected||
       typeof item.id!=='string'||item.id.length>80||
       !['synthetic_vision_metadata_only','redacted_human_labeled_screen'].includes(item.fixtureType))
      throw Error('Invalid NOL fixture record');
    const truth=classifyLabel(item.expected.step,item.expected.substep);
    if(!labels.has(truth))throw Error('Unknown NOL truth label');
    const result=assessNolScreen(item.input);
    const predicted=classifyLabel(result.step,result.substep);
    if(!labels.has(predicted))throw Error('Unexpected NOL classifier label');
    const correct=truth===predicted;
    if(correct)matched++;
    if(predicted==='unknown')unknown++;
    if(SENSITIVE.has(truth)&&!SENSITIVE.has(predicted))falseSafe++;
    if(result.holdVerified===true)falseHold++;
    if(item.fixtureType==='synthetic_vision_metadata_only')syntheticCount++;
    else if(item.humanReviewed===true && item.containsScreenshot===false &&
      item.modelOutputFromActualScreen===true)realReviewedCount++;
    confusion[truth]??={};confusion[truth][predicted]=(confusion[truth][predicted]||0)+1;
  }
  const perLabel={};
  for(const label of labels){
    let tp=confusion[label]?.[label]||0,fp=0,fn=0;
    for(const [truth,predictions] of Object.entries(confusion)){
      for(const [predicted,n] of Object.entries(predictions)){
        if(truth!==label&&predicted===label)fp+=n;
        if(truth===label&&predicted!==label)fn+=n;
      }
    }
    if(tp+fp+fn)perLabel[label]={
      precision:tp+fp?tp/(tp+fp):null,
      recall:tp+fn?tp/(tp+fn):null,
      support:tp+fn
    };
  }
  return Object.freeze({
    samples:fixtures.length,matched,matchRate:fixtures.length?matched/fixtures.length:null,
    abstentions:unknown,unsafeMisclassifications:falseSafe,falseHoldClaims:falseHold,
    syntheticCount,realReviewedCount,
    // Dataset declarations are not proof of authenticity or external vendor permission.
    measuredLiveRecognition:false,liveBookingSuccessRate:null,
    confusion,perLabel,
  });
}
class NolValidationTimeline {
  #events=[];#started=null;#queueActive=false;#durations=[];
  #obsStart=null;#queueStarts=0;#queueResumes=0;#paused=0;#clicks=0;
  #rejected=0;#conflicts=0;#soldOut=0;#holdClaims=0;#holdUnverified=0;
  record(type,atMs){
    if(!EVENTS.has(type)||!Number.isSafeInteger(atMs)||atMs<0)
      throw Error('Invalid NOL diagnostic event');
    if(this.#events.length>=MAX_EVENTS)throw Error('NOL diagnostic event cap reached');
    if(this.#started!==null && atMs<this.#events.at(-1).at)
      throw Error('Out-of-order NOL diagnostic timestamp');
    if(this.#started===null)this.#started=atMs;
    this.#events.push({type,at:atMs});
    if(type==='observe_start'){
      if(this.#obsStart===null)this.#obsStart=atMs;
    }else if(type==='observe_end'){
      if(this.#obsStart!==null){
        const delay=atMs-this.#obsStart;
        if(delay<=MAX_OBSERVATION_MS)this.#durations.push(delay);
        this.#obsStart=null;
      }
    }else if(type==='queue_enter'){
      if(!this.#queueActive){this.#queueActive=true;this.#queueStarts++;}
    }else if(type==='queue_resume'){
      if(this.#queueActive){this.#queueActive=false;this.#queueResumes++;}
    }else if(type==='manual_pause')this.#paused++;
    else if(type==='click_attempt')this.#clicks++;
    else if(type==='click_rejected')this.#rejected++;
    else if(type==='seat_conflict')this.#conflicts++;
    else if(type==='sold_out')this.#soldOut++;
    else if(type==='hold_unverified')this.#holdUnverified++;
    else if(type==='provider_hold_verified')this.#holdClaims++;
    return this.snapshot();
  }
  snapshot(){
    return Object.freeze({
      classification:'diagnostic_only',
      observationCount:this.#durations.length,
      observationLatencyMs:Object.freeze({
        p50:percentile(this.#durations,.5),
        p95:percentile(this.#durations,.95),
        max:this.#durations.length?Math.max(...this.#durations):null
      }),
      queueEntries:this.#queueStarts,queueResumptions:this.#queueResumes,
      queuePending:this.#queueActive,manualPauses:this.#paused,
      clickAttempts:this.#clicks,clickRejections:this.#rejected,
      seatConflicts:this.#conflicts,soldOut:this.#soldOut,
      holdUnverified:this.#holdUnverified,
      // A local diagnostic cannot establish an official live hold.
      providerHoldClaims:this.#holdClaims,officialHoldVerified:false,
      recordedEvents:this.#events.length,
    });
  }
}
/** Offline release audit is informative ONLY. No input can authorize NOL clicks. */
function evaluateNolRelease({classification=null,telemetry=null}={}){
  const critical=['Written NOL permission for each automated action is unverified',
    'Current real NOL screens and variants have not been independently validated',
    'No audited provider-owned live seat/price/hold observer',
    'No NOL-specific durable reservation fence with crash-recovery proof',
    'No authorized live E2E results or verified hold-success rate',
    'Packaged native auto-selection remains restricted'];
  if(classification?.unsafeMisclassifications>0)
    critical.push('Fixture classifier missed a sensitive or failure stage');
  if(classification?.falseHoldClaims>0)
    critical.push('Fixture classifier falsely claimed an official hold');
  if(telemetry?.providerHoldClaims>0)
    critical.push('Unverified local telemetry contains an official hold claim');
  return Object.freeze({schemaVersion:1,provider:'nol',stage:'NOL-05',
    status:'HOLD',productionAutomationAllowed:false,
    checkoutAutomationAllowed:false,officialHoldVerified:false,
    liveAccuracyMeasured:false,liveSuccessRate:null,
    blockers:critical,
    offlineFixtureResult:classification?{
      samples:classification.samples,matched:classification.matched,
      syntheticCount:classification.syntheticCount,
      unsafeMisclassifications:classification.unsafeMisclassifications,
      falseHoldClaims:classification.falseHoldClaims}:null,
    diagnostic:telemetry?{
      observationLatencyMs:telemetry.observationLatencyMs,
      queueEntries:telemetry.queueEntries,manualPauses:telemetry.manualPauses}:null
  });
}
module.exports={scoreNolFixtures,NolValidationTimeline,evaluateNolRelease,classifyLabel};
