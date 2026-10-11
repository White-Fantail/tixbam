'use strict';
/**
 * NOL-02: conservative *read-only* classification of model stage proposals.
 * This is NOT recognition of live UI from selectors, a reservation verifier,
 * or permission to automate NOL's restricted purchase flow.
 */
const NOL_STEPS=Object.freeze([
  'event_detail','performance_date','seat_map','price_quantity',
  'seat_conflict','sold_out','cart_review','human_gate','unknown'
]);
const MIN_STEP_CONFIDENCE=.97;
const STAGES=Object.freeze({
  event_detail:'event',
  performance_date:'selecting',
  seat_map:'selecting',
  price_quantity:'selecting',
  seat_conflict:'selecting',
  sold_out:'selecting',
  cart_review:'checkout'
});
function readNolSubstep({screenStage,screenConfidence,screenStep,stepConfidence}={}){
  const unknown=Object.freeze({substep:'unknown',confidence:0,
    evidence:'no_consistent_stage',requiresUser:false,holdVerified:false});
  if(!NOL_STEPS.includes(screenStep) || screenStep==='unknown' ||
     !Number.isFinite(stepConfidence) || stepConfidence<MIN_STEP_CONFIDENCE ||
     stepConfidence>1 || !Number.isFinite(screenConfidence) ||
     screenConfidence<MIN_STEP_CONFIDENCE || screenConfidence>1)return unknown;
  // Treat a suspected authentication/queue/security challenge as a user gate.
  // It can appear in a SPA without a corresponding URL or general stage.
  if(screenStep==='human_gate')
    return Object.freeze({substep:'human_gate',confidence:stepConfidence,
      evidence:'visual_hint',requiresUser:true,holdVerified:false});
  if(STAGES[screenStep]!==screenStage)return unknown;
  return Object.freeze({substep:screenStep,confidence:stepConfidence,
    evidence:'visual_hint',
    requiresUser:['seat_conflict','sold_out','cart_review'].includes(screenStep),
    holdVerified:false});
}
module.exports={NOL_STEPS,MIN_STEP_CONFIDENCE,readNolSubstep};
