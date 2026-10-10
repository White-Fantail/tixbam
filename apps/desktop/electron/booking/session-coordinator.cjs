'use strict';
const crypto=require('node:crypto');

/** AB-06: one execution owner per window and registered sale/performance.
 * A lease is not merchant authorization, and has no raw browser/session data.
 * Rehearsals are local only. Real automation requires authenticated server.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validateText=s=>typeof s==='string'&&s.length>0&&s.length<=160;
class SessionOwnershipError extends Error {
  constructor(code){super('Booking session coordination unavailable ('+code+'). Use the provider window manually.');this.code=code;this.name='SessionOwnershipError';}
}
class SessionCoordinator {
  #byScope=new Map();#byRun=new Map();#windowOwners=new Map();
  constructor({remote=null,clock=Date.now}={}){
    this.remote=remote;this.clock=clock;
  }
  #scope({accountId,providerId,saleId,performanceId,eventKey}){
    if(![accountId,providerId,saleId,performanceId,eventKey].every(validateText))
      throw new SessionOwnershipError('unverified_purchase_scope');
    return JSON.stringify([accountId,providerId,saleId,performanceId,eventKey]);
  }
  /** Reserve *before* async network requests, preventing timer/IPC race. */
  async acquire({runId,windowId,accountId,providerId,saleId,
    performanceId,eventKey,planId,rehearsal=false}={}){
    if(!UUID.test(runId||'') || !Number.isSafeInteger(windowId)||windowId<0||
       !validateText(planId))throw new SessionOwnershipError('invalid_owner');
    const scope=this.#scope({accountId,providerId,saleId,performanceId,eventKey});
    if(this.#byRun.has(runId)||this.#byScope.has(scope)||this.#windowOwners.has(windowId))
      throw new SessionOwnershipError('already_owned');
    const owner=crypto.randomUUID();
    const state={runId,windowId,scope,owner,accountId,providerId,
      saleId,performanceId,eventKey,planId,rehearsal,
      generation:0,token:null,fence:null,leaseId:null,expiresAtMs:0,
      phase:'acquiring',invalidated:false,claimed:false};
    this.#byRun.set(runId,state);
    this.#byScope.set(scope,state);
    this.#windowOwners.set(windowId,state);
    if(rehearsal){state.phase='leased';state.expiresAtMs=Number.MAX_SAFE_INTEGER;return this.#view(state);}
    if(!this.remote){
      this.#invalidate(state);
      throw new SessionOwnershipError('server_required');
    }
    try {
      const value=await this.remote('acquire',{
        planId,providerId,saleId,performanceId,ownerId:owner,
      });
      if(state.invalidated||this.#byRun.get(runId)!==state){
        // Request completed after Stop/signout: precommit release best-effort.
        if(value?.leaseToken)void this.remote('release',{
          leaseId:value.leaseId,ownerId:owner,
          fencingToken:value.fencingToken,leaseToken:value.leaseToken,
        }).catch(()=>{});
        throw new SessionOwnershipError('cancelled');
      }
      if(value?.status!=='leased'||!UUID.test(value.leaseId||'')||
         !/^[0-9a-f]{64}$/.test(value.leaseToken||'')||
         !Number.isSafeInteger(value.fencingToken)||
         value.fencingToken<1||value.autonomousCheckoutAvailable!==false){
        throw new SessionOwnershipError('invalid_server_lease');
      }
      const expiry=Date.parse(value.expiresAt);
      if(!Number.isFinite(expiry)||expiry<=this.clock()+1000)
        throw new SessionOwnershipError('expired_server_lease');
      state.leaseId=value.leaseId;state.token=value.leaseToken;
      state.fence=value.fencingToken;state.expiresAtMs=expiry;state.phase='leased';
      return this.#view(state);
    }catch(error){
      this.#invalidate(state);
      if(error instanceof SessionOwnershipError)throw error;
      throw new SessionOwnershipError('server_unreachable_or_denied');
    }
  }
  #view(s){
    return Object.freeze({runId:s.runId,windowId:s.windowId,
      leaseId:s.leaseId,fencingToken:s.fence,
      status:s.claimed?'claimed':s.phase,
      expiresAtMs:s.expiresAtMs});
  }
  #invalidate(s){
    s.invalidated=true;s.phase='invalid';
    s.generation++;
    if(this.#byScope.get(s.scope)===s)this.#byScope.delete(s.scope);
    if(this.#byRun.get(s.runId)===s)this.#byRun.delete(s.runId);
    if(this.#windowOwners.get(s.windowId)===s)this.#windowOwners.delete(s.windowId);
  }
  assertOwner(runId,windowId,eventKey){
    const s=this.#byRun.get(runId);
    if(!s||s.invalidated||s.windowId!==windowId||s.eventKey!==eventKey||
       this.#windowOwners.get(windowId)!==s||
       this.#byScope.get(s.scope)!==s)
      throw new SessionOwnershipError('lost_owner');
    if(!s.rehearsal&&!s.claimed && (
      !['leased','renewing'].includes(s.phase)||s.expiresAtMs<=this.clock()+1000
    )){
      this.#invalidate(s);
      throw new SessionOwnershipError('lease_expired');
    }
    return this.#view(s);
  }
  async renew(runId){
    const s=this.#byRun.get(runId);
    if(!s)throw new SessionOwnershipError('lost_owner');
    this.assertOwner(runId,s.windowId,s.eventKey);
    if(s.rehearsal||s.claimed)return this.#view(s);
    if(s.phase!=='leased')throw new SessionOwnershipError('renew_in_progress');
    s.phase='renewing';
    try{
      const r=await this.remote('renew',this.#operation(s));
      if(s.invalidated||this.#byRun.get(runId)!==s||
         r.status!=='leased'||r.fencingToken!==s.fence||
         r.leaseId!==s.leaseId||Date.parse(r.expiresAt)<=this.clock()+1000)
        throw new SessionOwnershipError('renew_not_verified');
      s.expiresAtMs=Date.parse(r.expiresAt);s.phase='leased';
      return this.#view(s);
    }catch{
      this.#invalidate(s);
      throw new SessionOwnershipError('renew_failed');
    }
  }
  #operation(s){return {leaseId:s.leaseId,ownerId:s.owner,
    fencingToken:s.fence,leaseToken:s.token};}
  /**
   * Must happen BEFORE AB-05 local COMMIT_INTENT + fsync. If claim response
   * is lost, server stays permanently claimed; do not retry checkout.
   */
  async claimBeforeCommit(runId,windowId,eventKey){
    const s=this.#byRun.get(runId);
    this.assertOwner(runId,windowId,eventKey);
    if(s.rehearsal)return this.#view(s);
    if(s.claimed||s.phase!=='leased')throw new SessionOwnershipError('already_claimed');
    s.phase='claiming';
    try {
      const r=await this.remote('claim',this.#operation(s));
      if(s.invalidated||this.#byRun.get(runId)!==s ||
         r?.status!=='claimed'||r.fencingToken!==s.fence||r.leaseId!==s.leaseId)
        throw new SessionOwnershipError('claim_not_verified');
      s.claimed=true;s.phase='claimed';
      return this.#view(s);
    }catch {
      // Ambiguous POST: NEVER reacquire or retry a possibly accepted claim.
      this.#invalidate(s);
      throw new SessionOwnershipError('claim_outcome_unknown');
    }
  }
  async release(runId,{mayHaveCommitted=false}={}){
    const s=this.#byRun.get(runId);
    if(!s)return;
    this.#invalidate(s);
    if(s.rehearsal||s.claimed||mayHaveCommitted||!s.leaseId||!s.token)return;
    // Best effort; if release cannot be confirmed, timeout/fencing is safe.
    try{await this.remote('release',this.#operation(s));}catch{}
  }
  invalidateWindow(windowId){
    const s=this.#windowOwners.get(windowId);
    if(s)void this.release(s.runId,{mayHaveCommitted:s.claimed});
  }
  invalidateAll(){
    for(const s of [...this.#byRun.values()])
      void this.release(s.runId,{mayHaveCommitted:s.claimed});
  }
  get activeCount(){return this.#byRun.size;}
}
module.exports={SessionCoordinator,SessionOwnershipError};
