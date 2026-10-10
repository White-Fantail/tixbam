'use strict';
const crypto = require('node:crypto');
const { chooseOffer } = require('./preferences.cjs');
const {normalizedOffer} = require('./offer-policy.cjs');
const { evaluateEffectiveCapability } = require('./capability-policy.cjs');

/** AB-03: Never use a model-provided selector, script, URL, coordinate or payment command.
 * Host-only snapshot tokens are resolved in this process; no IPC entry point is exposed.
 * AB-04 will provide a provider-neutral, redacted observation producer.
 */
const STAGES = new Set(['unknown','landing','queue','login','options','offers',
  'cart','checkout','bank_challenge','receipt','access_blocked']);
const ACTION_TARGETS = Object.freeze({
  WAIT: null, REOBSERVE: null, ASK_USER: null, STOP: null,
  SELECT_PERFORMANCE:'performance', SELECT_PRICE_TIER:'price_tier',
  SELECT_APPROVED_OFFER:'offer', CHOOSE_VERIFIED_DELIVERY:'delivery',
  RETURN_TO_VERIFIED_STEP:'navigation',
});
const ACTION_CAPABILITIES = Object.freeze({
  SELECT_PERFORMANCE:'SELECT_PERFORMANCE',
  SELECT_PRICE_TIER:'SELECT_PRICE_TIER',
  SELECT_APPROVED_OFFER:'SELECT_OFFER',
  CHOOSE_VERIFIED_DELIVERY:'PREPARE_CHECKOUT',
  RETURN_TO_VERIFIED_STEP:'PREPARE_CHECKOUT',
});
const PASSIVE = new Set(['WAIT','REOBSERVE','ASK_USER','STOP']);
const MUTATING_STAGES = Object.freeze({
  SELECT_PERFORMANCE:'options', SELECT_PRICE_TIER:'options',
  SELECT_APPROVED_OFFER:'offers', CHOOSE_VERIFIED_DELIVERY:'cart',
  RETURN_TO_VERIFIED_STEP:'options',
});
const PROPOSAL_FIELDS = Object.freeze(['schemaVersion','requestId','runId','snapshotId',
  'expectedPageGeneration','expectedStage','action','targetRef','rationaleCode','expiresAtMs']);
const MAX_TTL_MS = 15000;
const MAX_TARGETS = 30;
const IDENTIFIER = /^[a-zA-Z0-9_-]{8,100}$/;
const REASON = /^[A-Z][A-Z0-9_]{1,47}$/;
const isRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype ||
                            Object.getPrototypeOf(value) === null);
const isId = value => typeof value === 'string' && IDENTIFIER.test(value);
const isProvider = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{1,59}$/.test(value);
const isVersion = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,59}$/.test(value);
const isInt = value => Number.isSafeInteger(value) && value >= 0;
const decision = (code, now) => Object.freeze({allowed:code === 'ALLOW',code,checkedAtMs:now});
const BAD = 'UNKNOWN_ACTION';
const fixedOffer = value => {
  const safe=normalizedOffer(value);
  if(!safe)return null;
  // All identity / risk / fee fields are copied; never drop a restrictive
  // condition when moving into host-only AB-03 action handles.
  const copy={id:safe.id,eventKey:safe.eventKey,quantity:safe.quantity,
    currency:safe.currency,totalMinor:safe.totalMinor,feesIncluded:true,
    available:true,adjacent:safe.raw.adjacent,
    priceTier:safe.raw.priceTier,performance:safe.raw.performance,
    section:safe.raw.section,floor:safe.raw.floor,
    seatMode:safe.raw.seatMode,fulfillment:safe.raw.fulfillment,
    seats:[...safe.seats]};
  for(const k of ['schemaVersion','ticketMode','providerId','areaId',
    'feeBreakdown','restrictedView','realNameRequired','ageRestricted',
    'accessibilityRestricted','maxPerOrder','verifiedAllocation',
    'extras','totalVerified','availabilityVerified','identityVerified']){
    if(Object.hasOwn(safe.raw,k))copy[k]=structuredClone(safe.raw[k]);
  }
  Object.freeze(copy.seats);
  if(copy.feeBreakdown)Object.freeze(copy.feeBreakdown);
  if(copy.extras){for(const e of copy.extras)Object.freeze(e);Object.freeze(copy.extras);}
  return Object.freeze(copy);
};

function strictProposal(raw) {
  if (!isRecord(raw) ||
      Reflect.ownKeys(raw).length!==PROPOSAL_FIELDS.length ||
      Reflect.ownKeys(raw).some(k=>typeof k!=='string' || !PROPOSAL_FIELDS.includes(k)) ||
      Object.keys(raw).length!==PROPOSAL_FIELDS.length ||
      !PROPOSAL_FIELDS.every(k=>Object.hasOwn(raw,k) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(raw,k),'value'))) return null;
  const p=raw;
  if (p.schemaVersion!==1 || !isId(p.requestId) || !isId(p.runId) ||
      !isId(p.snapshotId) || !isInt(p.expectedPageGeneration) ||
      !STAGES.has(p.expectedStage) || !Object.hasOwn(ACTION_TARGETS,p.action) ||
      !REASON.test(p.rationaleCode) || !isInt(p.expiresAtMs)) return null;
  if (ACTION_TARGETS[p.action]===null ? p.targetRef!==null : !isId(p.targetRef))return null;
  return Object.freeze({...p});
}
const matches = (a,b) => typeof a === 'string' && a.length>0 && a===b;

/**
 * Host issues snapshot IDs and opaque targets. Values are never included in
 * model-facing output. Store is process-local and capped; no secrets allowed.
 */
class ActionValidator {
  #snapshots = new Map();
  #consumed = new Set();
  #clock;
  constructor({clock=Date.now} = {}) {
    if(typeof clock!=='function')throw new TypeError('Clock required');
    this.#clock=clock;
  }
  issueSnapshot({run,providerId,country,addonVersion,accountId,planId,
    stage,challenge='none',pageGeneration,policyRevision,targets=[],
    ttlMs=5000} = {}) {
    const now=this.#clock();
    if (!isRecord(run) || !isId(run.id) || typeof run.eventKey!=='string' || !run.eventKey ||
        !isInt(run.revision) || (run.windowId!==undefined && !isInt(run.windowId)) || !isInt(run.generation) ||
        !isProvider(providerId) || typeof country!=='string' || !/^[A-Z]{2}$/.test(country) ||
        !isVersion(addonVersion) || !isId(accountId) || !isId(planId) ||
        !isInt(policyRevision) ||
        !STAGES.has(stage) || !isInt(pageGeneration) ||
        !['none','captcha','queue','login','3ds','consent','unknown'].includes(challenge) ||
        !Array.isArray(targets) || targets.length>MAX_TARGETS ||
        !isInt(now) || !Number.isSafeInteger(ttlMs) || ttlMs<100 || ttlMs>MAX_TTL_MS)
      throw new TypeError('Invalid host snapshot input');
    if(this.#snapshots.size>=100) {
      const key=this.#snapshots.keys().next().value;
      this.#snapshots.delete(key);
    }
    const handles=new Map();
    for(const target of targets) {
      if(!isRecord(target) || !['performance','price_tier','offer','delivery','navigation'].includes(target.kind) ||
         target.available!==true)throw new TypeError('Invalid host action target');
      let value;
      if (target.kind==='offer') value=fixedOffer(target.value);
      else if(typeof target.value==='string' && target.value.length>0 &&
              target.value.length<=160 && !/https?:\/\/|[<>]/i.test(target.value))value=target.value;
      if(!value)throw new TypeError('Unsafe target value');
      const ref=crypto.randomUUID();
      handles.set(ref,Object.freeze({kind:target.kind,value}));
    }
    const snapshotId=crypto.randomUUID();
    const expiresAtMs=now+ttlMs;
    const record=Object.freeze({
      runId:run.id,eventKey:run.eventKey,windowId:run.windowId??null,
      revision:run.revision,generation:run.generation,
      providerId,country,addonVersion,accountId,planId,stage,challenge,
      pageGeneration,policyRevision,observedAtMs:now,expiresAtMs,handles,
    });
    this.#snapshots.set(snapshotId,record);
    return Object.freeze({
      schemaVersion:1,snapshotId,observedAtMs:now,expiresAtMs,stage,challenge,
      pageGeneration,handles:Object.freeze([...handles].map(([ref,v])=>Object.freeze({ref,kind:v.kind}))),
    });
  }
  invalidate(snapshotId) { this.#snapshots.delete(snapshotId); }
  invalidateRun(runId) {
    for(const [id,s] of this.#snapshots)if(s.runId===runId)this.#snapshots.delete(id);
  }
  inspect(proposal,scope={}, {consume=false}={}) {
    const now=this.#clock();
    const p=strictProposal(proposal);
    if(!p)return {decision:decision(BAD,now),target:null};
    const s=this.#snapshots.get(p.snapshotId);
    if(!s || s.runId!==p.runId || !isRecord(scope.run) ||
       scope.run.id!==s.runId || scope.run.eventKey!==s.eventKey ||
       (scope.run.windowId??null)!==s.windowId || scope.run.revision!==s.revision ||
       scope.run.generation!==s.generation ||
       !['OBSERVING','DECIDING','WAITING_FOR_USER'].includes(scope.run.phase) ||
       ['completed','failed','payment_unknown','stopped'].includes(scope.run.status) ||
       p.expectedPageGeneration!==s.pageGeneration || p.expectedStage!==s.stage ||
       scope.pageGeneration!==s.pageGeneration ||
       s.observedAtMs>now || s.expiresAtMs<=now || p.expiresAtMs<=now ||
       p.expiresAtMs>s.expiresAtMs)
      return {decision:decision('STALE_OBSERVATION',now),target:null};
    if(scope.providerId!==s.providerId || scope.country!==s.country ||
       scope.addonVersion!==s.addonVersion ||
       scope.accountId!==s.accountId || scope.planId!==s.planId ||
       (scope.windowId??null)!==s.windowId || scope.eventKey!==s.eventKey)
      return {decision:decision('WRONG_OWNER',now),target:null};
    if(scope.revoked===true || scope.policyRevision!==s.policyRevision)
      return {decision:decision('POLICY_DENY',now),target:null};
    if (this.#consumed.has(p.requestId) || this.#consumed.has(p.snapshotId))
      return {decision:decision('LIMIT_EXCEEDED',now),target:null};
    const kind=ACTION_TARGETS[p.action];
    const target=kind ? s.handles.get(p.targetRef) : null;
    if(kind && (!target || target.kind!==kind))
      return {decision:decision('WRONG_OWNER',now),target:null};
    if(!PASSIVE.has(p.action) && s.challenge!=='none')
      return {decision:decision('CHALLENGE_REQUIRED',now),target:null};
    if(!PASSIVE.has(p.action) && s.stage!==MUTATING_STAGES[p.action])
      return {decision:decision('STALE_OBSERVATION',now),target:null};
    if(!PASSIVE.has(p.action)) {
      const permit=scope.consent;
      const capability=ACTION_CAPABILITIES[p.action];
      if(!isRecord(permit) || !matches(permit.runId,s.runId) ||
         !matches(permit.accountId,s.accountId) || !matches(permit.planId,s.planId) ||
         !matches(permit.providerId,s.providerId) || !matches(permit.country,s.country) ||
         !matches(permit.addonVersion,s.addonVersion) ||
         permit.eventKey!==s.eventKey || (permit.windowId??null)!==s.windowId ||
         permit.expiresAtMs<=now ||
         !Array.isArray(permit.permittedActions) || !permit.permittedActions.includes(capability) ||
         !isInt(permit.maxAllInMinor) || !isInt(permit.quantity) ||
         !/^[A-Z]{3}$/.test(permit.currency||'') ||
         permit.policyRevision!==scope.policyRevision ||
         !scope.preferences || scope.preferences.quantity!==permit.quantity ||
         scope.preferences.currency!==permit.currency ||
         scope.preferences.maxTotalMinor!==permit.maxAllInMinor)
        return {decision:decision('CONSENT_MISSING',now),target:null};
      // AB-03 only dispatches fake rehearsal actions; normal live actions
      // require AB-01 authorization, still intentionally disabled.
      if(scope.run.rehearsal===true) {
        if(scope.rehearsalPermission!==true)return {decision:decision('CAPABILITY_MISSING',now),target:null};
      } else {
        const policyDecision=evaluateEffectiveCapability({
          providerId:s.providerId,addonVersion:s.addonVersion,country:s.country,
          capability,server:scope.serverPolicy,consent:permit,
        });
        if(!policyDecision.allowed)return {decision:decision('POLICY_DENY',now),target:null};
      }
      if(p.action==='SELECT_APPROVED_OFFER') {
        if(!scope.preferences || target.value.eventKey!==s.eventKey ||
           target.value.currency!==permit.currency ||
           target.value.quantity!==permit.quantity ||
           target.value.totalMinor>permit.maxAllInMinor ||
           !chooseOffer([target.value],scope.preferences,{eventKey:s.eventKey}))
          return {decision:decision('UNKNOWN_PRICE',now),target:null};
      }
      if(p.action==='SELECT_PERFORMANCE' &&
         target.value!==scope.preferences?.options?.performance)
        return {decision:decision('PLAN_MISMATCH',now),target:null};
      if(p.action==='SELECT_PRICE_TIER') {
        const tiers=scope.preferences?.options?.priceTier;
        if(!Array.isArray(tiers) || !tiers.includes(target.value) ||
           (!scope.preferences?.allowFallback && target.value!==tiers[0]))
          return {decision:decision('PLAN_MISMATCH',now),target:null};
      }
    }
    const result=decision('ALLOW',now);
    if(consume) {
      // Claim before any await or remote side effect. No duplicate request,
      // snapshot replay, or concurrent model proposal can execute again.
      this.#consumed.add(p.requestId);
      this.#consumed.add(p.snapshotId);
      this.#snapshots.delete(p.snapshotId);
      if(this.#consumed.size>2000) {
        // Snapshot registry itself has a short TTL; old replay tokens expire.
        this.#consumed.clear();
        this.#consumed.add(p.requestId);this.#consumed.add(p.snapshotId);
      }
    }
    return {decision:result,target};
  }
  validate(proposal,scope={}) {return this.inspect(proposal,scope).decision;}
  claim(proposal,scope={}) {return this.inspect(proposal,scope,{consume:true});}
}

module.exports={ ActionValidator, ACTION_TARGETS, ACTION_CAPABILITIES, PASSIVE,
  strictProposal, MAX_TTL_MS };
