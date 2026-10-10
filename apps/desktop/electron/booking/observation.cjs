'use strict';
const crypto=require('node:crypto');
const {ActionValidator}=require('./action-validator.cjs');
const {isSafeWebUrl,isHostAllowed}=require('../security.cjs');
const {classifyPage,normalizeOptions,normalizeOfferTargets,safeOrderSummary,
  projectAIObservation,isObject,integer}=require('./observation-redaction.cjs');

const EVENTS=['did-start-navigation','did-navigate','did-navigate-in-page',
  'did-frame-navigate','render-process-gone','destroyed'];
const EVENT_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

function identityMatches(w,url){
  if(w.rehearsal)return true;
  if(!isSafeWebUrl(url))return false;
  const u=new URL(url);
  return isHostAllowed(u.hostname,w.allowedHosts) &&
    (!w.pathSuffix||u.pathname.endsWith(w.pathSuffix)) &&
    (!w.eventQueryParam||u.searchParams.get(w.eventQueryParam)===w.expectedEventId);
}

/** Host-private read-only observation pipeline. No screenshot capture,
 * browser mutations, arbitrary injected JS, public IPC or remote AI call.
 */
class ObservationPipeline{
  #watches=new Map();#issued=new Map();#validator;#clock;
  constructor({validator=new ActionValidator(),clock=Date.now}={}){
    if(!(validator instanceof ActionValidator)||typeof clock!=='function')
      throw new TypeError('Trusted observation dependencies required');
    this.#validator=validator;this.#clock=clock;
  }

  watchWindow({windowId,webContents=null,providerId,planId=null,expectedEventId=null,
    allowedHosts=[],eventQueryParam=null,pathSuffix=null,rehearsal=false}={}){
    if(!integer(windowId)||!(/^[a-z0-9_-]{2,60}$/).test(providerId||'') ||
       (planId!==null&&(typeof planId!=='string'||!planId)) ||
       (!rehearsal&&(!webContents||typeof webContents.getURL!=='function'||
         typeof webContents.on!=='function'||!EVENT_ID.test(expectedEventId||'')||
         !Array.isArray(allowedHosts)||!allowedHosts.length||
         allowedHosts.some(s=>typeof s!=='string'||!s||s.length>150))) ||
       (rehearsal&&webContents!==null) ||
       (eventQueryParam!==null&&!/^[a-zA-Z0-9_-]{1,40}$/.test(eventQueryParam)) ||
       (pathSuffix!==null&&(typeof pathSuffix!=='string'||!pathSuffix.startsWith('/')||
         pathSuffix.length>150)))throw new TypeError('Invalid observation window binding');
    const old=this.#watches.get(windowId);
    if(old&&old.webContents===webContents&&old.providerId===providerId&&
       old.planId===planId&&old.expectedEventId===expectedEventId&&
       old.pathSuffix===pathSuffix&&old.eventQueryParam===eventQueryParam)return;
    if(old)this.unwatchWindow(windowId);
    if(this.#watches.size>=24)throw new Error('Too many observation windows');
    const w={windowId,webContents,providerId,planId,expectedEventId,
      allowedHosts:[...allowedHosts],eventQueryParam,pathSuffix,rehearsal,
      pageGeneration:0,fingerprint:null,runIds:new Set(),listeners:[]};
    if(!identityMatches(w,rehearsal?'':webContents.getURL()))
      throw new Error('Wrong provider or booking event');
    for(const name of EVENTS){
      if(!webContents)break;
      const listener=()=>{
        w.pageGeneration++;
        w.fingerprint=null;
        for(const runId of w.runIds)this.invalidateRun(runId);
      };
      webContents.on(name,listener);w.listeners.push([name,listener]);
    }
    this.#watches.set(windowId,w);
  }

  unwatchWindow(id){
    const w=this.#watches.get(id);if(!w)return;
    for(const [event,listener] of w.listeners){
      if(typeof w.webContents.off==='function')w.webContents.off(event,listener);
      else w.webContents.removeListener?.(event,listener);
    }
    for(const runId of w.runIds)this.invalidateRun(runId);
    this.#watches.delete(id);
  }
  invalidateRun(runId){
    this.#validator.invalidateRun(runId);
    for(const [id,s] of this.#issued)if(s.runId===runId)this.#issued.delete(id);
  }
  invalidateAll(){for(const id of [...this.#watches.keys()])this.unwatchWindow(id);this.#issued.clear();}

  #verify(w,providerId,page){
    if(!w||w.providerId!==providerId)throw new Error('Observation owner mismatch');
    if(!identityMatches(w,w.rehearsal?'':w.webContents.getURL()) ||
       !isObject(page) ||
       (w.expectedEventId!==null&&page.providerEventId!==w.expectedEventId)){
      for(const id of w.runIds)this.invalidateRun(id);
      throw new Error('Observation origin or event changed');
    }
  }

  /** Called by existing BookingRunner after its ordinary adapter.read().
   * No additional page loads or DOM requests on the critical booking path.
   */
  noteRead({windowId,providerId,page,runId=null}={}){
    const w=this.#watches.get(windowId);
    const cls=classifyPage(page);
    try { this.#verify(w,providerId,page); }
    catch (error) {
      // Official login/queue pages can temporarily lose the event query
      // parameter. Treat them as human handoff without any action handles.
      // Never trust off-domain pages or let a challenge become a new event.
      const url=w?.webContents?.getURL?.();
      if(w?.providerId!==providerId || !w?.webContents ||
         !isSafeWebUrl(url) ||
         !isHostAllowed(new URL(url).hostname,w.allowedHosts) ||
         !['captcha','queue','login','3ds'].includes(cls.challenge))
        throw error;
      if(runId)w.runIds.add(runId);
      w.pageGeneration++;
      w.fingerprint=null;
      for(const id of w.runIds)this.invalidateRun(id);
      return Object.freeze({...cls,pageGeneration:w.pageGeneration});
    }
    if(runId)w.runIds.add(runId);
    const summary={stage:cls.stage,challenge:cls.challenge,
      options:normalizeOptions(page,'verified_adapter').map(t=>[t.kind,t.value])};
    const digest=crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex');
    if(w.fingerprint!==null&&w.fingerprint!==digest){
      w.pageGeneration++;
      for(const id of w.runIds)this.invalidateRun(id);
    }
    w.fingerprint=digest;
    return Object.freeze({...cls,pageGeneration:w.pageGeneration});
  }

  /** Real contexts require host-owned window/event identity and account/plan
   * binding. Fake rehearsals use only synthetic fixtures and fake permits.
   */
  async capture({windowId,run,accountId,planId,providerId,country,addonVersion,
    policyRevision,adapter,page:given,source='verified_adapter',ttlMs=5000}={}){
    const w=this.#watches.get(windowId);
    if(!w||w.providerId!==providerId||run?.windowId!==windowId||
       !run?.id||!run.eventKey||!integer(run.revision)||!integer(run.generation)||
       (w.planId!==null&&w.planId!==planId)||
       (w.rehearsal?source!=='rehearsal':source!=='verified_adapter'))
      throw new Error('Observation capture binding invalid');
    const generation=w.pageGeneration;
    this.#verify(w,providerId,{providerEventId:w.expectedEventId});
    const page=given!==undefined?given:
      (typeof adapter?.read==='function'?await adapter.read():null);
    if(this.#watches.get(windowId)!==w||generation!==w.pageGeneration)
      throw new Error('Navigation during observation');
    this.#verify(w,providerId,page);
    if(page.eventKey!==run.eventKey)throw new Error('Observation run event mismatch');
    const status=this.noteRead({windowId,providerId,page,runId:run.id});
    const targets=status.challenge==='none'&&['options','offers'].includes(status.stage)
      ? (source==='rehearsal'?normalizeOfferTargets(page,source):
          normalizeOptions(page,source)):[];
    this.invalidateRun(run.id); // supersede old snapshot on each observation
    const issued=this.#validator.issueSnapshot({
      run,providerId,country,addonVersion,accountId,planId,
      stage:status.stage,challenge:status.challenge,
      pageGeneration:status.pageGeneration,policyRevision,targets,ttlMs,
    });
    const handles=issued.handles.map((h,i)=>Object.freeze({
      ref:h.ref,kind:h.kind,label:h.kind.replace(/_/g,' ')+' '+(i+1),
      available:true,
    }));
    const host=Object.freeze({
      schemaVersion:1,snapshotId:issued.snapshotId,runId:run.id,
      accountId,planId,windowId,providerId,providerEventId:w.expectedEventId,
      pageGeneration:status.pageGeneration,stage:status.stage,
      challenge:status.challenge,observedAtMs:issued.observedAtMs,
      expiresAtMs:issued.expiresAtMs,
      trustedSource:source==='rehearsal'?'observed_only':'verified_adapter',
      confidence:status.stage==='unknown'||status.challenge!=='none'?'unknown':'partial',
      handles:Object.freeze(handles),orderSummary:safeOrderSummary(page),
    });
    const tokens=new Map(issued.handles.map(h=>[crypto.randomUUID(),h.ref]));
    if(this.#issued.size>=100)this.#issued.delete(this.#issued.keys().next().value);
    this.#issued.set(issued.snapshotId,{runId:run.id,windowId,
      pageGeneration:status.pageGeneration,expiresAtMs:issued.expiresAtMs,
      tokens,host});
    return host;
  }

  /** Explicit opt-in to deriving a no-ID AI projection. This method never
   * transmits it; AB-01 live sharing permission has not been enabled.
   */
  projectForAI(id,{rehearsal=false,externalSharingPermitted=false}={}){
    const s=this.#issued.get(id),w=s&&this.#watches.get(s.windowId);
    if(!s||!w||this.#clock()>=s.expiresAtMs||
       w.pageGeneration!==s.pageGeneration)
      throw new Error('Expired or invalidated observation');
    if((w.rehearsal&&rehearsal!==true)||
       (!w.rehearsal&&externalSharingPermitted!==true))
      throw new Error('Third-party AI data sharing not authorized');
    const taskTargets=[...s.tokens].map(([token,ref])=>{
      const h=s.host.handles.find(item=>item.ref===ref);
      return {token,kind:h.kind};
    });
    return projectAIObservation(s.host,taskTargets);
  }

  /** Token resolution is host-only and does NOT approve/execute anything. */
  resolveTarget(id,token){
    const s=this.#issued.get(id),w=s&&this.#watches.get(s.windowId);
    if(!s||!w||typeof token!=='string'||this.#clock()>=s.expiresAtMs||
       w.pageGeneration!==s.pageGeneration)return null;
    return s.tokens.get(token)||null;
  }
  get validator(){return this.#validator;}
}
module.exports={ObservationPipeline,identityMatches,EVENTS};
