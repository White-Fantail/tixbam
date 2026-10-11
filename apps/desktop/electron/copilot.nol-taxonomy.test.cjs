'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fixtures=require('./copilot/fixtures/nol-step-cases.json');
const {NOL_STEPS,readNolSubstep}=require('./copilot/nol-taxonomy.cjs');
const {assessNolScreen}=require('./copilot/nol-flow.cjs');

test('NOL-02 taxonomy fixtures have traceable synthetic metadata, not real screenshots',()=>{
  assert.ok(fixtures.cases.length>=15);
  assert.ok(fixtures.sources.length>0);
  const ids=new Set();
  for(const item of fixtures.cases){
    assert.equal(item.fixtureType,'synthetic_vision_metadata_only');
    assert.equal(item.containsScreenshot,false);
    assert.equal(item.provider,'nol');
    assert.ok(!ids.has(item.id),'duplicate case id');
    ids.add(item.id);
  }
});

test('NOL-02 stage classifier matches all annotated offline metadata fixtures',()=>{
  for(const fixture of fixtures.cases){
    const got=assessNolScreen(fixture.input);
    for(const [field,expected] of Object.entries(fixture.expected))
      assert.equal(got[field],expected,fixture.id+' / '+field);
    assert.equal(got.holdVerified,false,'unverified hold: '+fixture.id);
  }
});

test('NOL-02 no model-reported hold, price or order fields can certify purchase',()=>{
  const item=fixtures.cases.find(x=>x.id==='seat-map');
  const observed=assessNolScreen({...item.input,holdVerified:true,quantity:1,
    totalMinor:100000,purchaseVerified:true,proof:'fake'});
  assert.equal(observed.holdVerified,false);
  assert.ok(!Object.hasOwn(observed,'proof'));
  assert.ok(!Object.hasOwn(observed,'totalMinor'));
  assert.ok(!Object.hasOwn(observed,'purchaseVerified'));
});

test('NOL-02 rejects incoherent or low-confidence substeps without enabling actions',()=>{
  assert.ok(NOL_STEPS.includes('seat_conflict'));
  const basis={screenStage:'selecting',screenConfidence:.99,
    screenStep:'seat_map',stepConfidence:.99};
  assert.equal(readNolSubstep(basis).substep,'seat_map');
  for(const opts of [
    {...basis,screenStep:'cart_review'},
    {...basis,screenStep:'unknown'},
    {...basis,screenStep:'not_a_nol_step'},
    {...basis,stepConfidence:.96},
    {...basis,screenConfidence:.96},
    {...basis,stepConfidence:NaN},
    {...basis,stepConfidence:2},
    {...basis,screenStage:'unknown'},
  ]){
    assert.equal(readNolSubstep(opts).substep,'unknown');
  }
  assert.equal(readNolSubstep({...basis,screenStep:'human_gate'}).requiresUser,true);
});

test('NOL-02 synthetic fixture coverage has zero false official hold claims',()=>{
  const results=fixtures.cases.map(x=>assessNolScreen(x.input));
  const matched=results.filter((got,i)=>
    Object.entries(fixtures.cases[i].expected).every(([k,v])=>got[k]===v)).length;
  assert.equal(matched,fixtures.cases.length);
  assert.equal(results.filter(x=>x.holdVerified).length,0);
  // This is a *synthetic metadata regression metric*, NOT image recognition accuracy.
  assert.equal(matched/results.length,1);
});
