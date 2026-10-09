const test = require('node:test');
const assert = require('node:assert/strict');
const {ACTIONS,localReview,evaluateEffectiveCapability} = require('./booking/capability-policy.cjs');

test('bundled capabilities are version pinned and never read from a remote add-on', () => {
  assert.equal(localReview('cityline','1.1.0').capabilities.OBSERVE,'verified');
  assert.equal(localReview('cityline','1.1.0').capabilities.PAYMENT_EXECUTOR,'disabled');
  assert.equal(localReview('cityline','9.9.9'),null);
  assert.equal(localReview('livenation','1.0.0'),null);
  assert.equal(localReview('unknown','1.0.0'),null);
  assert.equal(ACTIONS.has('EVAL_JS'),false);
});

test('AB-01 cannot be tricked into enabling live autonomy', () => {
  const policy = {schemaVersion:1,globalKillSwitch:false,items:[{
    providerId:'cityline',country:'HK',published:true,
    ticketAgentRequired:false,autonomousCheckoutAvailable:true,
    policies:[{capability:'OBSERVE',country:'HK',permissionState:'permitted',permitted:true}],
  }]};
  const consent={providerId:'cityline',country:'HK',addonVersion:'1.1.0',
                 capability:'OBSERVE',expiresAtMs:Date.now()+100000};
  for(const changed of [
    {}, {released:true},{released:true,server:policy},
    {released:true,server:policy,consent},
    {released:true,server:policy,consent,capability:'PAYMENT_EXECUTOR'}
  ]) {
    const result = evaluateEffectiveCapability({
      providerId:'cityline',addonVersion:'1.1.0',country:'HK',
      capability:'OBSERVE',server:policy,consent,...changed
    });
    assert.equal(result.allowed,false);
  }
  assert.equal(evaluateEffectiveCapability({capability:'EVAL_JS'}).reason,'unknown_capability');
  assert.equal(evaluateEffectiveCapability().allowed,false);
});
