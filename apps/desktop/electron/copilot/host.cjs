'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { BrowserWindow, nativeImage } = require('electron');
const { screenAllowed,pixelPoint,targetRegion,validSnapshot,validObservation,SNAPSHOT_TTL_MS } = require('./core.cjs');
const MAX_JPEG_BYTES = 1500000;
const {normalizeConsent,providerAutomationStatus,canRun,MAX_AGE_MS}
  =require('./advance-authorization.cjs');
/** Host-only, opt-in local screenshot preview and human-directed pointer.
 * No website code injection, remote vision uploads, auto-click loops or payments.
 * Live unattended actions require a SEPARATE verified provider executor.
 */
class LiveCopilot {
  constructor({ticketWindows,requireInstalled}) {
    this.ticketWindows=ticketWindows;this.requireInstalled=requireInstalled;
    this.snapshots=new Map();this.overlays=new Map();this.visionProvider=null;
    this.autoSessions=new Map();this.autoPending=new Set();
    this.onAutoUpdate=()=>{};
  }
  setVisionProvider(provider) {
    if(typeof provider!=='function')throw new TypeError('Trusted Vision service required');
    this.visionProvider=provider;
  }
  verify(windowId, options = {}) {
    if(!Number.isInteger(windowId))throw new Error('Invalid Copilot window.');
    const entry=this.ticketWindows.get(windowId);
    if (entry?.popup) {
      const parent=this.ticketWindows.get(entry.parentId);
      if (!parent || parent.planId !== entry.planId || parent.providerId !== entry.providerId)
        throw new Error('This popup is not linked to an active booking plan browser.');
    }
    const provider=entry&&this.requireInstalled(entry.providerId);
    const result=screenAllowed(entry,provider?.allowedHosts,windowId,options);
    if(!result.allowed)throw new Error(result.reason);
    return entry;
  }
  clear(windowId) {
    this.snapshots.delete(windowId);
    const overlay=this.overlays.get(windowId);
    this.overlays.delete(windowId);
    if(overlay && !overlay.isDestroyed())overlay.destroy();
  }
  clearAll() {
    for(const id of [...this.overlays.keys(),...this.snapshots.keys()])this.clear(id);
    for(const id of [...this.autoSessions.keys()])this.disarm(id);
  }
  autoInfo(session,status,reason,extra={}) {
    const info={windowId:session.windowId,planId:session.planId,providerId:session.providerId,
      requestedMode:session.consent.mode,mode:session.mode,status,reason,
      attempts:session.count,expiresAt:session.expiresAt,
      targets:[],automaticClicks:session.automaticClicks,...extra};
    this.onAutoUpdate(info);
    return info;
  }
  arm(windowId,preferences,consentInput) {
    const consent=normalizeConsent(consentInput);
    this.disarm(windowId);
    if(consent.mode==='manual')return {windowId,mode:'manual',status:'off',
      reason:'Advance assistance not enabled.',targets:[]};
    const entry=this.ticketWindows.get(windowId);
    if(!entry?.planId || entry.popup)throw new Error('Arm only a main Booking Plan browser.');
    this.requireInstalled(entry.providerId);
    if(!preferences || preferences.planId!==entry.planId ||
       !Number.isInteger(preferences.quantity) || preferences.quantity<1 || preferences.quantity>20 ||
       !Number.isSafeInteger(preferences.budgetMinor) || preferences.budgetMinor<0 ||
       preferences.budgetMinor>10000000000 ||
       !/^[A-Z]{3}$/.test(preferences.currency||'') ||
       !['ko','en'].includes(preferences.locale))
      throw new Error('Invalid or mismatched advance-authorized booking conditions.');
    const addon=this.requireInstalled(entry.providerId);
    // Never treat a user-granted preference as the vendor's automation permission.
    const permission=providerAutomationStatus(addon,'seat');
    const mode=consent.mode==='authorized' && permission.allowed ? 'authorized' : 'observe';
    const session={windowId,planId:entry.planId,providerId:entry.providerId,
      consent,mode,preferences:Object.freeze({...preferences}),expiresAt:Date.now()+MAX_AGE_MS,
      count:0,lastAttemptAt:0,stopped:false,automaticClicks:0};
    this.autoSessions.set(windowId,session);
    return this.autoInfo(session,'armed',mode==='observe'&&consent.mode==='authorized'
      ? 'Provider automation unavailable: '+permission.reason+' Visual guidance only.'
      : 'Advance-approved visual guidance armed. Login, queues and checkout are manual.');
  }
  disarm(windowId) {
    const session=this.autoSessions.get(windowId);
    if(!session)return false;
    session.stopped=true;
    this.autoSessions.delete(windowId);
    this.clear(windowId);
    this.autoInfo(session,'stopped','Advance authorization revoked.');
    return true;
  }
  autoStatus(windowId){
    const s=this.autoSessions.get(windowId);
    return s ? this.autoInfo(s,'armed','Active until stopped or expired.')
      : {windowId,mode:'manual',status:'off',reason:'Not armed.',targets:[]};
  }
  async observe(windowId) {
    const session=this.autoSessions.get(windowId);
    if(!session || this.autoPending.has(windowId))return;
    const entry=this.ticketWindows.get(windowId);
    const check=canRun(session,entry);
    if(!check.allowed) {
      if(check.reason!=='Automatic AI cooldown.')
        this.autoInfo(session,'paused',check.reason);
      return;
    }
    // Screen restrictions are rechecked before EVERY capture and after AI latency.
    try {this.verify(windowId,{localPreview:true});}
    catch(error){
      this.autoInfo(session,'paused',error.message);
      return;
    }
    session.lastAttemptAt=Date.now();
    session.count+=1;
    this.autoPending.add(windowId);
    this.autoInfo(session,'observing','Reviewing the current official screen.');
    try {
      const shot=await this.snapshot(windowId);
      if(session.stopped || this.autoSessions.get(windowId)!==session)return;
      const response=await this.analyze(windowId,shot.token,session.preferences);
      if(session.stopped || this.autoSessions.get(windowId)!==session)return;
      const candidates=response.targets.filter(t=>session.consent.actions.includes(t.kind));
      if(candidates.length) {
        // Highlight the first candidate without clicking or changing provider state.
        await this.highlight(windowId,shot.token,{x:candidates[0].x,y:candidates[0].y});
      }
      const reason=candidates.length ? 'Candidate highlighted; inspect the official site.' :
        'No confident approved action found. Continue manually.';
      this.autoInfo(session,'guiding',reason,{targets:candidates});
      // Auto coordinate clicks are intentionally not sent without a trusted,
      // vendor-specific target verifier. AI pixel guesses are not such a verifier.
    }catch(error){
      if(!session.stopped && this.autoSessions.get(windowId)===session)
        this.autoInfo(session,'paused',error instanceof Error?error.message:String(error));
    }finally {this.autoPending.delete(windowId);}
  }
  async takeImage(entry) {
    const image=await entry.win.webContents.capturePage();
    if(image.isEmpty())throw new Error('The provider screen could not be captured.');
    const bytes=image.toJPEG(68);
    if(bytes.length>MAX_JPEG_BYTES)throw new Error('The preview exceeds the local screenshot limit.');
    return bytes;
  }
  async snapshot(windowId) {
    const entry=this.verify(windowId,{localPreview:true});
    this.snapshots.delete(windowId);
    const {win}=entry, url=win.webContents.getURL(), bounds=win.getContentBounds();
    if(bounds.width<200 || bounds.height<200)throw new Error('Booking browser is too small.');
    const bytes=await this.takeImage(entry);
    this.verify(windowId,{localPreview:true});
    if(win.webContents.getURL()!==url || win.getContentBounds().width!==bounds.width ||
       win.getContentBounds().height!==bounds.height)
      throw new Error('Provider screen changed during capture.');
    const issuedAt=Date.now(),token=crypto.randomUUID();
    const mode=entry.phase === 'preparing' ? 'diagnostic_preview' : 'human_guidance';
    this.snapshots.set(windowId,{token,windowId,planId:entry.planId,
      providerId:entry.providerId,phase:entry.phase,url,issuedAt,expiresAt:issuedAt+SNAPSHOT_TTL_MS,
      digest:crypto.createHash('sha256').update(bytes).digest('hex'),
      width:bounds.width,height:bounds.height,bytes,consumed:false});
    // Never retain expired captured browser pixels in memory indefinitely.
    setTimeout(() => {
      if(this.snapshots.get(windowId)?.token===token)this.clear(windowId);
    },SNAPSHOT_TTL_MS).unref?.();
    return {token,windowId,expiresAt:issuedAt+SNAPSHOT_TTL_MS,
      image:'data:image/jpeg;base64,'+bytes.toString('base64'),
      width:bounds.width,height:bounds.height,
      mode,automaticClickAvailable:false};
  }
  async verifiedTarget(windowId,token,point,{readOnly=false}={}) {
    const options=readOnly ? {localPreview:true} : {};
    const entry=this.verify(windowId,options),preview=this.snapshots.get(windowId);
    const check=readOnly ? validObservation : validSnapshot;
    check(preview,entry,token,entry.win.webContents.getURL());
    const bounds=entry.win.getContentBounds();
    if(bounds.width!==preview.width || bounds.height!==preview.height)
      throw new Error('Window dimensions changed. Capture a fresh screen.');
    const target=pixelPoint(point,bounds.width,bounds.height);
    if(readOnly)return {entry,preview,target};
    const current=await this.takeImage(entry);
    this.verify(windowId);
    check(preview,entry,token,entry.win.webContents.getURL());
    // Check the exact proposed target neighbourhood, not unrelated moving
    // countdowns, advertising or seat-availability animations elsewhere.
    // Still fail closed if the click target itself changes in any way.
    const observed=nativeImage.createFromBuffer(preview.bytes);
    const live=nativeImage.createFromBuffer(current);
    const observedSize=observed.getSize(),liveSize=live.getSize();
    if(observed.isEmpty() || live.isEmpty() ||
      observedSize.width!==liveSize.width || observedSize.height!==liveSize.height)
      throw new Error('The browser image dimensions changed. Capture again.');
    const region=targetRegion(point,observedSize.width,observedSize.height);
    if(!observed.crop(region).toBitmap().equals(live.crop(region).toBitmap()))
      throw new Error('The selected button or seat changed. Capture again before clicking.');
    return {entry,preview,target};
  }
  /** AI proposals remain advisory. A signed-in user must opt in for EACH
   * screenshot upload and still explicitly choose and approve a target.
   */
  async analyze(windowId,token,preferences) {
    if(!this.visionProvider)throw new Error('Copilot Vision is unavailable.');
    const {entry,preview}=await this.verifiedTarget(windowId,token,{x:0.5,y:0.5},{readOnly:true});
    if(!preferences || !Number.isInteger(preferences.quantity) || preferences.quantity<1 ||
       preferences.quantity>20 || !Number.isSafeInteger(preferences.budgetMinor) ||
       preferences.budgetMinor<0 || preferences.budgetMinor>10000000000 ||
       !/^[A-Z]{3}$/.test(preferences.currency||'') ||
       !['ko','en'].includes(preferences.locale))
      throw new Error('Invalid Copilot ticket conditions.');
    let response;
    try {
      response=await this.visionProvider({
        providerId:entry.providerId,quantity:preferences.quantity,
        currency:preferences.currency,budgetMinor:preferences.budgetMinor,
        locale:preferences.locale,
        // Older production APIs only accept selection-stage requests.
        // Omitting the default stage keeps existing deployments compatible.
        ...(preview.phase==='preparing' ? {stage:'preparing'} : {}),
        imageBase64:preview.bytes.toString('base64')
      });
    } catch(error) {
      if(preview.phase==='preparing' && error?.status===422)
        throw new Error('Preparation-stage AI requires the updated TIXBAM API. Manual target highlighting still works.');
      throw error;
    }
    await this.verifiedTarget(windowId,token,{x:0.5,y:0.5},{readOnly:true});
    if(response?.advisoryOnly!==true || response.humanApprovalRequired!==true ||
       !Array.isArray(response.targets) || response.targets.length>5)
      throw new Error('Invalid read-only Copilot Vision response.');
    const {validPoint}=require('./core.cjs');
    const targets=response.targets.filter(t=>validPoint(t) &&
      typeof t.label==='string'&&t.label.length<=60 &&
      typeof t.reason==='string'&&t.reason.length<=160 &&
      typeof t.confidence==='number'&&t.confidence>=0.85 &&
      ['seat','price_tier','performance','quantity','continue'].includes(t.kind) &&
      (preview.phase === 'selecting' || t.kind === 'continue'));
    return {status:response.status,targets,advisoryOnly:true,
      humanApprovalRequired:true,snapshotToken:preview.token};
  }
  async highlight(windowId,token,point) {
    const {entry,target}=await this.verifiedTarget(windowId,token,point,{readOnly:true});
    let overlay=this.overlays.get(windowId);
    if(!overlay || overlay.isDestroyed()) {
      overlay=new BrowserWindow({
        parent:entry.win,frame:false,transparent:true,show:false,
        focusable:false,skipTaskbar:true,hasShadow:false,
        webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,
          webSecurity:true}
      });
      overlay.setIgnoreMouseEvents(true,{forward:true});
      overlay.setMenuBarVisibility(false);
      overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      overlay.webContents.on('will-navigate',e=>e.preventDefault());
      await overlay.loadFile(path.join(__dirname,'overlay.html'));
      this.overlays.set(windowId,overlay);
    }
    overlay.setBounds(entry.win.getContentBounds());
    await overlay.webContents.executeJavaScript('window.setCopilotHighlight('+JSON.stringify(target)+')');
    overlay.showInactive();
    const activeOverlay=overlay;
    setTimeout(()=>{
      if(this.overlays.get(windowId)===activeOverlay){
        this.overlays.delete(windowId);
        if(!activeOverlay.isDestroyed())activeOverlay.destroy();
      }
    },5000).unref?.();
    return {highlighted:true,expiresAt:Date.now()+5000};
  }
  /** One real click per FRESH screenshot, with a separate explicit user
   * confirmation in the dashboard. Deliberately no unattended call path. */
  async click(windowId,token,point) {
    // Focus can trigger website overlays, layout changes or browser redraws.
    // Always perform the final image comparison AFTER bringing it forward.
    const live=this.verify(windowId);
    if(live.win.isMinimized())live.win.restore();
    live.win.show();live.win.focus();
    const {entry,preview,target}=await this.verifiedTarget(windowId,token,point);
    preview.consumed=true;
    this.snapshots.delete(windowId);
    this.clear(windowId);
    entry.win.webContents.sendInputEvent({type:'mouseDown',
      x:target.x,y:target.y,button:'left',clickCount:1});
    entry.win.webContents.sendInputEvent({type:'mouseUp',
      x:target.x,y:target.y,button:'left',clickCount:1});
    return {clicked:true,verifiedPurchase:false,automatic:false};
  }
}
module.exports={LiveCopilot};
