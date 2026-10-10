'use strict';
/** AB-08 host-only PlannerV1. AI can propose; it cannot execute.
 * Converts AB-04 synthetic HostObservation into AIObservationV1, resolves task
 * tokens inside Electron, and validates AB-03 ProposalV1 before display.
 */
const crypto=require('node:crypto');
const {ObservationPipeline}=require('./observation.cjs');
const {strictProposal,ACTION_TARGETS,PASSIVE}=require('./action-validator.cjs');

const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord=o=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const allowedFields=new Set(['schemaVersion','requestId','snapshotId','expectedPageGeneration','expectedStage',
  'action','targetToken','rationaleCode','expiresAtMs','advisoryOnly','model']);
const RATIONALE_CODES=new Set(["WAIT_FOR_OBSERVATION","REHEARSAL_WAIT","REQUIRES_REVIEW","APPROVED_OPTION","CHALLENGE_PRESENT","NEED_REOBSERVATION","MATCHING_OFFER","USER_HANDOFF","SAFETY_STOP","INVENTORY_UNCERTAIN","PRICE_UNVERIFIED","NO_OPTIONS","OPTION_AVAILABLE","PAGE_READY"]);
const stageForAction={
  SELECT_PERFORMANCE:'options',SELECT_PRICE_TIER:'options',
  SELECT_APPROVED_OFFER:'offers',CHOOSE_VERIFIED_DELIVERY:'cart',
  RETURN_TO_VERIFIED_STEP:'options'
};
class RehearsalPlanner{
  #pipeline;#clock;#epoch=0;#runNonce=new Map();#used=new Set();
  constructor({clock=Date.now}={}){
    this.#clock=clock;
    this.#pipeline=new ObservationPipeline({clock});
    this.#pipeline.watchWindow({windowId:0,providerId:'rehearsal',rehearsal:true});
  }
  invalidate(){
    this.#epoch++;
    this.#pipeline.invalidateAll();
    this.#pipeline.watchWindow({windowId:0,providerId:'rehearsal',rehearsal:true});
    this.#runNonce.clear();
    this.lastHostProposal=null;
    this.lastRecoveryContext=null;
  }
  takeRecoveryContext(){
    const value=this.lastRecoveryContext;
    this.lastRecoveryContext=null;
    return value||null;
  }
  async propose({driver,providerId,locale='ko',send}={}){
    // A newer planning request invalidates the previous executable candidate.
    this.lastHostProposal=null;
    this.lastRecoveryContext=null;
    const runner=driver?.runner, adapter=driver?.adapter;
    const state=runner?.state;
    if(!runner||!adapter||runner.busy||runner.orchestrator.machine.terminal||
       typeof send!=='function'||!['ko','en'].includes(locale)||
       typeof providerId!=='string'||!/^[a-z0-9_-]{2,60}$/.test(providerId))
      throw new Error('Planner requires an idle active rehearsal run.');
    const epoch=this.#epoch,revision=state.revision,runId=state.id;
    let nonce=this.#runNonce.get(runId);
    if(!nonce){nonce=crypto.randomUUID();this.#runNonce.set(runId,nonce);}
    const page=adapter.peek();
    // The synthetic userData/plan/run binding is local and NEVER sent to the model.
    const host=await this.#pipeline.capture({
      windowId:0,run:{...state,windowId:0},
      accountId:'offline-rehearsal',planId:driver.plan.id,
      providerId:'rehearsal',country:'HK',addonVersion:'1.0.0',
      policyRevision:0,source:'rehearsal',page,ttlMs:15000
    });
    const observation=this.#pipeline.projectForAI(host.snapshotId,{rehearsal:true});
    const requestId=crypto.randomUUID();
    const isCurrent=()=>this.#epoch===epoch&&driver.runner===runner &&
      runner.state.id===runId&&runner.state.revision===revision &&
      !runner.busy && !runner.orchestrator.machine.terminal &&
      this.#clock()<host.expiresAtMs;
    let result;
    try{
      result=await send({
        requestId,runNonce:nonce,snapshotId:host.snapshotId,
        pageGeneration:host.pageGeneration,providerId,locale,
        rehearsal:true,observation,
      });
    }catch{
      if(!isCurrent())return {action:'ASK_USER',rationaleCode:'STALE_REHEARSAL',advisoryOnly:true,source:'fallback'};
      return {action:'ASK_USER',rationaleCode:'MODEL_UNAVAILABLE',advisoryOnly:true,source:'fallback'};
    }
    if(!isCurrent())return {action:'ASK_USER',rationaleCode:'STALE_REHEARSAL',advisoryOnly:true,source:'fallback'};
    try {this.#pipeline.projectForAI(host.snapshotId,{rehearsal:true});}
    catch {return {action:'ASK_USER',rationaleCode:'STALE_REHEARSAL',advisoryOnly:true,source:'fallback'};}
    const invalid=()=>({action:'ASK_USER',rationaleCode:'PROPOSAL_REJECTED',advisoryOnly:true,source:'fallback'});
    if(!isRecord(result)||Object.keys(result).length!==allowedFields.size ||
       Object.keys(result).some(k=>!allowedFields.has(k)) ||
       result.advisoryOnly!==true||result.schemaVersion!==1||
       result.requestId!==requestId||result.snapshotId!==host.snapshotId||
       result.expectedPageGeneration!==host.pageGeneration||
       result.expectedStage!==host.stage||
       !ID.test(result.requestId)||!ID.test(result.snapshotId)||
       !Number.isSafeInteger(result.expiresAtMs)||
       result.expiresAtMs<=this.#clock()||
       typeof result.model!=='string'||result.model.length>160||
       this.#used.has(requestId))return invalid();
    const targetRef=result.targetToken===null?null:
      this.#pipeline.resolveTarget(host.snapshotId,result.targetToken);
    if(result.targetToken!==null && (!ID.test(result.targetToken)||!targetRef))
      return invalid();
    const local={
      schemaVersion:1,requestId,runId,snapshotId:host.snapshotId,
      expectedPageGeneration:host.pageGeneration,expectedStage:host.stage,
      action:result.action,targetRef,rationaleCode:result.rationaleCode,
      expiresAtMs:Math.min(result.expiresAtMs,host.expiresAtMs)
    };
    const proposal=strictProposal(local);
    if(!proposal||!RATIONALE_CODES.has(proposal.rationaleCode))return invalid();
    const actionKind=ACTION_TARGETS[proposal.action];
    if(actionKind){
      if(host.challenge!=='none'||stageForAction[proposal.action]!==host.stage||
         !host.handles.some(h=>h.ref===targetRef&&h.kind===actionKind))
        return invalid();
    }else if(!PASSIVE.has(proposal.action))return invalid();
    this.#used.add(requestId);
    // Kept only in host memory for a future AB-09 review; NEVER send
    // ActionProposalV1 (with run IDs and targetRef) to renderer/AI.
    this.lastHostProposal=proposal;
    // Private context is never transferred to renderer or to OpenRouter.
    // AB-09 takes it once after an explicit user action and revalidates it.
    this.lastRecoveryContext=Object.freeze({proposal,host,validator:this.#pipeline.validator,
      pipeline:this.#pipeline,
      epoch,runner,driver,runRevision:revision});
    return Object.freeze({
      action:proposal.action,rationaleCode:proposal.rationaleCode,
      advisoryOnly:true,source:'openrouter',model:result.model
    });
  }
}
module.exports={RehearsalPlanner};
