'use strict';
// Pure field-journal contract tests: compiled locally from source with the
// repository's pinned TypeScript devDependency, no provider traffic.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../src/booking/nol-field-validation.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022
}}).outputText;
const m={exports:{}};
vm.runInNewContext(js,{module:m,exports:m.exports,Date,Math,Number},
  {filename:'nol-field-validation.transpiled.cjs',timeout:1000});
const {beginNolFieldSession,recordNolFieldEvent,stopNolFieldSession,
  exportNolFieldReport,safeNolAggregate}=m.exports;

test('NOL live session is human-reported and never attests to a hold or purchase',()=>{
  let s=beginNolFieldSession(1000,22,'sensitive-plan-identifier');
  s=recordNolFieldEvent(s,'step','seat_selection',2500);
  s=recordNolFieldEvent(s,'step','cart_review',4000);
  s=recordNolFieldEvent(s,'issue','seat_conflict',4500);
  s=stopNolFieldSession(s,5000);
  assert.equal(s.events.length,4);
  const report=exportNolFieldReport(s,{
    classification:'diagnostic_only',
    observationCount:4,queueEntries:1,queueResumptions:1,manualPauses:1,
    clickAttempts:0,clickRejections:0,seatConflicts:1,soldOut:0,holdUnverified:1,
    officialHoldVerified:true,
    observationLatencyMs:{p50:330,p95:1200,max:1400},
    secret:'never export a URL or screenshot'
  });
  assert.equal(report.result,'unverified');
  assert.equal(report.releaseDecision,'HOLD');
  assert.equal(report.officialHoldVerified,false);
  assert.equal(report.purchaseVerified,false);
  assert.equal(report.copilotAggregate.officialHoldVerified,false);
  assert.equal(report.copilotAggregate.observationLatencyMs.p95,1200);
  const serialized=JSON.stringify(report);
  assert.equal(serialized.includes('sensitive-plan-identifier'),false);
  assert.equal(serialized.includes('never export'),false);
  assert.equal(Object.hasOwn(report,'windowId'),false);
  assert.equal(Object.hasOwn(report,'planId'),false);
  assert.equal(Object.hasOwn(report,'url'),false);
  assert.equal(report.humanReportedStage,'cart_review');
  assert.equal(report.elapsedMs,4000);
});
test('NOL field journal rejects backwards, duplicate, premature cart, overflow and writes after stop',()=>{
  const init=beginNolFieldSession(100,1,'plan');
  assert.strictEqual(recordNolFieldEvent(init,'step','cart_review',120),init);
  const seat=recordNolFieldEvent(init,'step','seat_selection',200);
  assert.strictEqual(recordNolFieldEvent(seat,'step','seat_selection',210),seat);
  assert.strictEqual(recordNolFieldEvent(seat,'step','login_complete',220),seat);
  assert.strictEqual(recordNolFieldEvent(seat,'issue','forged',230),seat);
  const stopped=stopNolFieldSession(seat,300);
  assert.strictEqual(recordNolFieldEvent(stopped,'issue','sold_out',500),stopped);
  assert.equal(exportNolFieldReport(stopped).humanReportedSteps,2);
});
test('invalid diagnostic payload never becomes official evidence',()=>{
  assert.equal(safeNolAggregate({classification:'official_proof'}),null);
  const a=safeNolAggregate({classification:'diagnostic_only',
    observationCount:-10,
    officialHoldVerified:true,
    observationLatencyMs:{p50:-100,p95:Infinity,max:10}
  });
  assert.equal(a.observationCount,0);
  assert.equal(a.observationLatencyMs.p50,null);
  assert.equal(a.observationLatencyMs.p95,null);
  assert.equal(a.officialHoldVerified,false);
});
