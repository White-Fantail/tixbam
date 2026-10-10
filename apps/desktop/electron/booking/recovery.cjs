'use strict';
/**
 * AB-09 Host Recovery Engine.
 * Never runs in a provider window. Executes ONLY one explicitly approved
 * offline fixture action with a current AB-03 snapshot. No AI-generated
 * selectors, scripts, URLs, navigation, challenge solving or payment.
 */
const {executeReviewedProposal}=require('./action-registry.cjs');
const {PASSIVE}=require('./action-validator.cjs');
const {ScenarioAdapter}=require('./rehearsal-driver.cjs');
const {chooseOffer}=require('./preferences.cjs');
const MAX_STEPS=3,MAX_FAILURES=2,MAX_MUTATIONS=1,STEP_DEADLINE_MS=2000;
const ALLOWED=new Set(['REOBSERVE','SELECT_APPROVED_OFFER']);
const TERMINAL=new Set(['completed','stopped','failed','payment_unknown']);
const fail=(code)=>Object.freeze({executed:false,code,manualTakeover:true});
class RecoveryEngine {
  #planner;#clock;#deadlineMs;#runs=new Map();#invalidated=false;
  constructor({planner,clock=Date.now,stepDeadlineMs=STEP_DEADLINE_MS}={}){
    if(!planner||typeof planner.takeRecoveryContext!=='function'||
       typeof clock!=='function'||!Number.isSafeInteger(stepDeadlineMs)||
       stepDeadlineMs<25||stepDeadlineMs>STEP_DEADLINE_MS)
      throw new TypeError('Trusted host recovery limits required');
    this.#planner=planner;this.#clock=clock;this.#deadlineMs=stepDeadlineMs;
  }
  invalidate(){
    this.#invalidated=true;
    this.#runs.clear();
    this.#planner.invalidate();
  }
  /** A new signed-in rehearsal window owns a fresh engine. */
  get status(){return Object.freeze({disabled:this.#invalidated,mode:'rehearsal_only'});}
  async executeApproved({driver,approve=false}={}){
    if(this.#invalidated||approve!==true||!driver||typeof driver.withRecoveryTask!=='function')
      return fail('APPROVAL_REQUIRED');
    // Take once synchronously: two button events cannot reuse an AI proposal.
    const ctx=this.#planner.takeRecoveryContext();
    if(!ctx||!ctx.proposal||!ctx.host)return fail('NO_CURRENT_PROPOSAL');
    const {proposal,host,runner,runRevision,validator,pipeline}=ctx;
    const now=this.#clock(),recoveryEpoch=driver.recoveryEpoch;
    const current=runner?.state;
    if(driver.runner!==runner||!current||current.id!==proposal.runId||
       current.rehearsal!==true||!(driver.adapter instanceof ScenarioAdapter)||
       runner.busy||TERMINAL.has(current.status)||runner.cancelled||
       current.revision!==runRevision||proposal.expiresAtMs<=now||
       host.expiresAtMs<=now||host.stage!==proposal.expectedStage||
       host.pageGeneration!==proposal.expectedPageGeneration)
      return fail('STALE_OBSERVATION');
    // Abort all challenges and checkout even for a forged, valid-looking
    // model proposal. No renderer IPC can choose its own scope or target.
    if(host.challenge!=='none'||['queue','login','bank_challenge','checkout',
       'cart','receipt','access_blocked','unknown'].includes(host.stage))
      return fail('CHALLENGE_REQUIRED');
    const counters=this.#runs.get(current.id)||{
      attempts:0,failures:0,mutations:0,last:new Set(),locked:false,busy:false
    };
    this.#runs.set(current.id,counters);
    if(counters.busy)return fail('EXECUTION_IN_PROGRESS');
    if(counters.locked||counters.attempts>=MAX_STEPS||
       counters.failures>=MAX_FAILURES||counters.mutations>=MAX_MUTATIONS&&
       proposal.action==='SELECT_APPROVED_OFFER') {
      counters.locked=true;
      return fail('LIMIT_EXCEEDED');
    }
    const fingerprint=[proposal.action,host.stage,host.pageGeneration,
      proposal.targetRef||'-'].join('|');
    if(counters.last.has(fingerprint))return fail('REPEATED_ACTION');
    counters.last.add(fingerprint);
    counters.attempts++;
    counters.busy=true;
    const deadline=now+this.#deadlineMs;
    const controller=new AbortController();
    let live=true;
    const assertOwner=()=>{
      if(!live||this.#invalidated||this.#clock()>=deadline||
         driver.runner!==runner||driver.adapter!==adapter||
         driver.recoveryEpoch!==recoveryEpoch||runner.busy||
         runner.cancelled||runner.submitted||
         runner.state.id!==current.id||
         runner.state.revision!==runRevision||
         TERMINAL.has(runner.state.status))
        throw new Error('Recovery no longer owns this rehearsal');
    };
    const adapter=driver.adapter;
    const attemptedMutation=proposal.action==='SELECT_APPROVED_OFFER';
    const complete=(outcome)=>{
      if(outcome.executed&&attemptedMutation)counters.mutations++;
      if(outcome.manualTakeover===true ||
         outcome.code==='POSTCONDITION_FAILED') {
        counters.failures++;
        if(counters.failures>=MAX_FAILURES||attemptedMutation)counters.locked=true;
      }
      return Object.freeze({executed:outcome.executed===true,
        code:outcome.code,manualTakeover:outcome.manualTakeover===true,
        action:proposal.action,attempts:counters.attempts,
        remaining:Math.max(0,MAX_STEPS-counters.attempts)});
    };
    const work=async()=>{
      assertOwner();
      if(PASSIVE.has(proposal.action)&&proposal.action!=='REOBSERVE')
        return Object.freeze({executed:false,code:'ADVISORY_ONLY',manualTakeover:false});
      if(!ALLOWED.has(proposal.action))return fail('MANUAL_HANDOFF_REQUIRED');
      const prefs=runner.preferences;
      if(!prefs||!Number.isSafeInteger(prefs.quantity)||
         !Number.isSafeInteger(prefs.maxTotalMinor)||prefs.maxTotalMinor<=0||
         prefs.currency!==driver.plan.currency||prefs.quantity!==driver.plan.quantity)
        return fail('PLAN_MISMATCH');
      // Explicit, short-lived rehearsal-only consent is created by HOST only.
      // It cannot be supplied from AI, renderer or provider add-on.
      const consent={
        runId:current.id,accountId:host.accountId,
        planId:driver.plan.id,providerId:'rehearsal',
        country:'HK',addonVersion:'1.0.0',eventKey:current.eventKey,
        windowId:0,expiresAtMs:Math.min(deadline,host.expiresAtMs),
        permittedActions:['SELECT_OFFER'],maxAllInMinor:prefs.maxTotalMinor,
        quantity:prefs.quantity,currency:prefs.currency,policyRevision:0
      };
      const scope={run:{...runner.state,windowId:0},windowId:0,
        eventKey:current.eventKey,providerId:'rehearsal',country:'HK',
        addonVersion:'1.0.0',accountId:host.accountId,planId:driver.plan.id,
        pageGeneration:host.pageGeneration,policyRevision:0,
        revoked:false,consent,preferences:prefs,rehearsalPermission:true,
        signal:controller.signal};
      const before=validator.inspect(proposal,scope);
      if(!before.decision.allowed)return fail(before.decision.code);
      assertOwner();
      if(proposal.action==='REOBSERVE'){
        // REOBSERVE is a host-only synthetic read, never a reload/navigation.
        const latest=adapter.peek();
        if(latest.eventKey!==runner.state.eventKey)return fail('WRONG_OWNER');
        const observed=pipeline.noteRead({windowId:0,providerId:'rehearsal',
          page:latest,runId:current.id});
        if(observed.challenge!=='none')return fail('CHALLENGE_REQUIRED');
        assertOwner();
        const claim=validator.claim(proposal,scope);
        if(!claim.decision.allowed)return fail(claim.decision.code);
        // Issuing a new observation invalidates the consumed old snapshot.
        const fresh=await pipeline.capture({
          windowId:0,run:{...runner.state,windowId:0},
          accountId:host.accountId,planId:driver.plan.id,
          providerId:'rehearsal',country:'HK',addonVersion:'1.0.0',
          policyRevision:0,source:'rehearsal',page:latest,ttlMs:5000});
        assertOwner();
        return Object.freeze({executed:true,code:'REOBSERVED',
          stage:fresh.stage,manualTakeover:false});
      }
      if(proposal.action==='SELECT_APPROVED_OFFER'){
        if(host.stage!=='offers'||!before.target ||
           chooseOffer([before.target.value],prefs)!==before.target.value)
          return fail('UNKNOWN_PRICE');
        // Use the existing AB-03 executor: it checks both the page and exact
        // offer/fees/seat constraints again immediately before mutation and
        // verifies the synthetic postcondition after the action.
        const result=await executeReviewedProposal({
          validator,proposal,scope,adapter,assertOwner,
          readCurrent:async()=>{
            assertOwner();
            const latest=adapter.peek();
            const freshness=pipeline.noteRead({windowId:0,
              providerId:'rehearsal',page:latest,runId:current.id});
            if(freshness.challenge!=='none' ||
               freshness.pageGeneration!==host.pageGeneration)
              throw new Error('Changed rehearsal page');
            return {...latest,pageGeneration:freshness.pageGeneration};
          }
        });
        assertOwner();
        if(!result.executed)return fail(result.code);
        if(adapter.stage!=='payment'||!adapter.order ||
           !chooseOffer([adapter.order],prefs))
          return fail('POSTCONDITION_FAILED');
        return Object.freeze({executed:true,code:'EXECUTED_REHEARSAL',
          manualTakeover:false});
      }
      return fail('CAPABILITY_MISSING');
    };
    // Serialize with normal Driver.next/stop/start so a user step cannot
    // race the AI precondition and underlying fake adapter mutation.
    const guarded=driver.withRecoveryTask(work);
    let timer;
    const timeout=new Promise(resolve=>{
      timer=setTimeout(()=>resolve(fail('STEP_DEADLINE_EXCEEDED')),this.#deadlineMs);
      // Keep deadline observable even during an isolated offline test.
    });
    try{
      const result=await Promise.race([guarded,timeout]);
      if(result.code==='STEP_DEADLINE_EXCEEDED'){
        live=false;controller.abort();counters.locked=true;
      }
      return complete(result);
    }catch{
      live=false;controller.abort();return complete(fail('EXECUTION_FAILED'));
    }finally{
      live=false;controller.abort();clearTimeout(timer);counters.busy=false;
    }
  }
}
module.exports={RecoveryEngine,MAX_STEPS,MAX_FAILURES,MAX_MUTATIONS,STEP_DEADLINE_MS};
