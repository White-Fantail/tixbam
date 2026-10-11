'use strict';
/** NOL-01: bounded, read-only step assessment. Never authorizes a click or hold. */
const NOL_HOSTS=Object.freeze(['nol.yanolja.com','world.nol.com']);
const PHASES=new Set(['preparing','waiting','queue','selecting','checkout','verification']);
const VISION_STAGES=new Set(['event','selecting','waiting','queue','checkout','unknown']);
const HIGH_CONFIDENCE=.97;
const SENSITIVE_PATH=/(?:^|[\/._-])(login|sign-?in|auth|captcha|verify|verification|otp|queue|waiting|waitroom|bank|3ds|3dsecure)(?:[\/._-]|$)/i;
const CHECKOUT_PATH=/(?:^|[\/._-])(checkout|payment|pay|cart)(?:[\/._-]|$)/i;

function result(step,evidence,confidence,detail,needsUser=true){
  return Object.freeze({step,evidence,confidence,detail,needsUser,holdVerified:false});
}
function assessNolScreen(input){
  if(!input || typeof input!=='object')
    return result('unknown','invalid',0,'Missing NOL observation.');
  let uri;
  try {uri=new URL(input.url);}catch {
    return result('unknown','invalid_url',0,'Invalid NOL URL.');
  }
  if(uri.protocol!=='https:' || uri.username || uri.password ||
     !NOL_HOSTS.includes(uri.hostname.toLowerCase()))
    return result('unknown','untrusted_host',0,'Not a verified NOL booking origin.');
  const phase=PHASES.has(input.phase)?input.phase:'unknown';
  // URL and user-marked sensitive stages take precedence over model guesses.
  if(SENSITIVE_PATH.test(uri.pathname) ||
     ['waiting','queue','verification'].includes(phase))
    return result('human_gate','official_route_or_phase',1,
      'Login, identity verification, CAPTCHA or queue needs user control.');
  if(CHECKOUT_PATH.test(uri.pathname) || phase==='checkout')
    return result('checkout_unverified','official_route_or_phase',1,
      'Possible cart or checkout: provider hold and payment remain unverified.');
  const confidence=typeof input.visionConfidence==='number' &&
    Number.isFinite(input.visionConfidence) &&
    input.visionConfidence>=0 && input.visionConfidence<=1
      ? input.visionConfidence:0;
  const stage=VISION_STAGES.has(input.visionStage)?input.visionStage:'unknown';
  if(confidence<HIGH_CONFIDENCE)
    return result('unknown','low_or_missing_confidence',confidence,
      'Visual stage cannot be established reliably.');
  if(['waiting','queue'].includes(stage))
    return result('human_gate','visual_hint',confidence,
      'Possible queue or waiting room: human inspection required.');
  if(stage==='checkout')
    return result('checkout_unverified','visual_hint',confidence,
      'Possible checkout: provider hold must be verified independently.');
  if(stage==='event' && phase==='preparing')
    return result('event_detail','visual_hint',confidence,
      'NOL event detail appears visible.',false);
  if(stage==='selecting' && phase==='selecting')
    return result('selection_unknown','visual_hint',confidence,
      'Selection flow appears visible; date/seat/price substep unverified.',false);
  if(stage==='selecting' && phase==='preparing')
    return result('unknown','phase_conflict',confidence,
      'Selection may have opened without navigation. Verify stage before continuing.');
  if(stage==='event' && phase==='selecting')
    return result('unknown','phase_conflict',confidence,
      'The browser may have returned to event detail. Verify stage.');
  return result('unknown','unresolved',confidence,
    'No reliable NOL stage recognized.');
}
module.exports={NOL_HOSTS,HIGH_CONFIDENCE,assessNolScreen};
