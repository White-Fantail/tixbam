'use strict';
/**
 * NOL-05 locally scored, human-labelled screen metadata.
 * Never opens images, makes network requests or enables live automation.
 * Labels are not a substitute for independent QA or provider authorization.
 */
const fs=require('node:fs');
const {scoreNolFixtures,evaluateNolRelease}=
  require('../apps/desktop/electron/copilot/nol-validation.cjs');
const ROOT_KEYS=new Set(['id','fixtureType','containsScreenshot','humanReviewed',
  'modelOutputFromActualScreen','input','expected']);
const INPUT_KEYS=new Set(['url','phase','visionStage','visionConfidence',
  'visionStep','visionStepConfidence']);
const EXPECTED_KEYS=new Set(['step','substep']);
function onlyKeys(obj,keys){
  return obj!==null && typeof obj==='object' && !Array.isArray(obj) &&
    Object.keys(obj).every(k=>keys.has(k));
}
function scoreLocalScreens(data){
  if(!data||data.schemaVersion!==1||!Array.isArray(data.cases)||
     data.cases.length===0||data.cases.length>250)
    throw Error('Invalid NOL screen metadata dataset');
  const rows=[];
  const ids=new Set();
  for(const item of data.cases){
    if(!onlyKeys(item,ROOT_KEYS)||!onlyKeys(item.input,INPUT_KEYS)||
       !onlyKeys(item.expected,EXPECTED_KEYS)||
       item.fixtureType!=='redacted_human_labeled_screen'||
       item.containsScreenshot!==false||item.humanReviewed!==true||
       item.modelOutputFromActualScreen!==true||
       typeof item.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(item.id)||
       ids.has(item.id))
      throw Error('Invalid or unreviewed NOL fixture; remove all private media and identifiers');
    ids.add(item.id);
    // Do not capture actual NOL account/session URLs or sensitive route values:
    // the classifier gets a fixed, safe NOL origin/path; model metadata only.
    if(!['https://nol.yanolja.com/product/offline-fixture',
      'https://world.nol.com/product/offline-fixture'].includes(item.input.url))
      throw Error('Use fixed NOL test origin; no real URLs, queries, cookies or tokens');
    const input=item.input;
    if(!['preparing','selecting','waiting','queue','checkout','verification'].includes(input.phase)||
       !['event','selecting','waiting','queue','checkout','unknown'].includes(input.visionStage)||
       typeof input.visionConfidence!=='number'||
       typeof input.visionStepConfidence!=='number'||
       !Number.isFinite(input.visionConfidence)||
       !Number.isFinite(input.visionStepConfidence)||
       input.visionConfidence<0||input.visionConfidence>1||
       input.visionStepConfidence<0||input.visionStepConfidence>1||
       !['event_detail','performance_date','seat_map','price_quantity',
         'seat_conflict','sold_out','cart_review','human_gate','unknown'].includes(input.visionStep))
      throw Error('Invalid NOL model metadata');
    rows.push(item);
  }
  const scored=scoreNolFixtures(rows);
  return {
    provider:'nol',source:'user_supplied_reviewed_metadata',
    samples:scored.samples,matched:scored.matched,matchRate:scored.matchRate,
    abstentions:scored.abstentions,
    unsafeMisclassifications:scored.unsafeMisclassifications,
    perLabel:scored.perLabel,confusion:scored.confusion,
    note:'Reported accuracy for supplied screen annotations only; not an independently verified live model benchmark.',
    release:evaluateNolRelease({classification:scored})
  };
}
if(require.main===module){
  try{
    const pathname=process.argv[2];
    if(typeof pathname!=='string')throw Error('Pass a local reviewed metadata JSON file');
    const stat=fs.statSync(pathname);
    if(!stat.isFile()||stat.size>512000)throw Error('Invalid metadata file size');
    const result=scoreLocalScreens(JSON.parse(fs.readFileSync(pathname,'utf8')));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(error){
    process.stderr.write('NOL screen scoring refused: '+String(error.message||error)+'\n');
    process.exitCode=1;
  }
}
module.exports={scoreLocalScreens};
