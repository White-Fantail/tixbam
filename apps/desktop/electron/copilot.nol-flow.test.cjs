'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessNolScreen,HIGH_CONFIDENCE}=require('./copilot/nol-flow.cjs');
const examine=(changes={})=>assessNolScreen({
  url:'https://nol.yanolja.com/product/123',phase:'preparing',
  visionStage:'event',visionConfidence:.99,...changes
});

test('NOL-01: event and selection stage are hints, never hold authority',()=>{
  const event=examine();
  assert.equal(event.step,'event_detail');
  assert.equal(event.needsUser,false);
  assert.equal(event.holdVerified,false);
  const selection=examine({url:'https://world.nol.com/en/seats',
    phase:'selecting',visionStage:'selecting'});
  assert.equal(selection.step,'selection_unknown');
  assert.equal(selection.holdVerified,false);
  assert.equal(HIGH_CONFIDENCE,.97);
});

test('NOL-01: domain and URL are trusted by exact official host only',()=>{
  for(const url of [
    'http://nol.yanolja.com/event',
    'https://nol.yanolja.com.evil.example/event',
    'https://my-nol.yanolja.com/event',
    'https://user:pass@nol.yanolja.com/event',
    'javascript:alert(1)',
    '',
  ]){
    const state=examine({url});
    assert.equal(state.step,'unknown',url);
    assert.equal(state.needsUser,true);
    assert.equal(state.holdVerified,false);
  }
});

test('NOL-01: user-gated routes always trump confident model output',()=>{
  for(const path of ['login','queue','auth','captcha','verification','otp','waiting']){
    const state=examine({url:'https://nol.yanolja.com/en/'+path,
      phase:'selecting',visionStage:'selecting'});
    assert.equal(state.step,'human_gate',path);
    assert.equal(state.needsUser,true);
  }
  for(const phase of ['queue','waiting','verification'])
    assert.equal(examine({phase}).step,'human_gate');
});

test('NOL-01: cart/checkout can never be labeled as secured ticket',()=>{
  for(const path of ['checkout','cart','payment']){
    const state=examine({url:'https://nol.yanolja.com/en/'+path,
      visionStage:'selecting'});
    assert.equal(state.step,'checkout_unverified',path);
    assert.equal(state.holdVerified,false);
    assert.equal(state.needsUser,true);
  }
  assert.equal(examine({visionStage:'checkout'}).step,'checkout_unverified');
  assert.equal(examine({phase:'checkout'}).holdVerified,false);
});

test('NOL-01: stale/low/conflicting/unknown vision does not promote steps',()=>{
  for(const stage of ['selecting','event','unknown']){
    const state=examine({visionStage:stage,visionConfidence:.96});
    assert.equal(state.step,'unknown');
  }
  assert.equal(examine({phase:'preparing',visionStage:'selecting'}).evidence,'phase_conflict');
  assert.equal(examine({phase:'selecting',visionStage:'event'}).evidence,'phase_conflict');
  assert.equal(examine({visionConfidence:NaN}).step,'unknown');
  assert.equal(examine({visionConfidence:1.1}).step,'unknown');
  assert.equal(assessNolScreen(null).step,'unknown');
});

test('NOL-01: no read-only observation ever certifies a hold',()=>{
  for(const phase of ['preparing','selecting','checkout','queue','waiting','verification']){
    for(const stage of ['event','selecting','checkout','queue','unknown']){
      const result=examine({phase,visionStage:stage});
      assert.equal(result.holdVerified,false);
      assert.equal(typeof result.step,'string');
    }
  }
});
