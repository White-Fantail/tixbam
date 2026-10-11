'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { BrowserWindow, nativeImage } = require('electron');
const { screenAllowed,pixelPoint,targetRegion,validSnapshot,validObservation,SNAPSHOT_TTL_MS } = require('./core.cjs');
const MAX_JPEG_BYTES = 1500000;
const {normalizeConsent,providerAutomationStatus,canRun,
  DEV_CLICK_KINDS,MAX_AGE_MS,MIN_ANALYSIS_GAP_MS}
  =require('./advance-authorization.cjs');
const {MAX_AUTO_STEPS,actionPermission,chooseStep}=require('./auto-flow.cjs');
const {assessNolScreen}=require('./nol-flow.cjs');
/** Host-owned, bounded opt-in visual execution.
 * Remote pages receive no privileged preload or scripts. Real purchase, payment
 * and official seat holds must be verified by independent provider evidence.
 */
class LiveCopilot {
  constructor({ticketWindows,requireInstalled,developerClickTestEnabled=()=>false}) {
    this.ticketWindows=ticketWindows;this.requireInstalled=requireInstalled;
    this.developerClickTestEnabled=developerClickTestEnabled;
    this.snapshots=new Map();this.overlays=new Map();this.visionProvider=null;
    this.autoSessions=new Map();this.autoPending=new Set();this.autoTimers=new Map();
    this.onAutoUpdate=()=>{};
  }
  developerCapabilities() {
    return {singleClickTest:this.developerClickTestEnabled()===true,
      multiStepTest:this.developerClickTestEnabled()===true,
      maxRealClicksPerSession:MAX_AUTO_STEPS,checkoutAllowed:false};
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
      targets:[],automaticClicks:session.automaticClicks,
      ...(session.providerId==='nol' && session.providerStep
        ? {providerStep:session.providerStep}:{}),...extra};
    session.lastInfo=info;
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
    const developerTest=consent.developmentOverride===true;
    // Only opt-in, unbundled Electron developer mode can request a one-click
    // native input test. A cloud flag or renderer IPC field can never enable it.
    if(developerTest && (this.developerClickTestEnabled()!==true ||
       !['observe','authorized'].includes(consent.mode) ||
       addon.kind!=='ticketing' ||
       !consent.actions.some(kind=>DEV_CLICK_KINDS.includes(kind))))
      throw new Error('Developer click test requires the local development runtime, a ticketing provider and an approved selection action.');
    const permission=providerAutomationStatus(addon,'seat');
    const mode=developerTest ? 'dev_flow' :
      consent.mode==='authorized' && permission.allowed ? 'authorized' : 'observe';
    const session={windowId,planId:entry.planId,providerId:entry.providerId,
      consent,mode,preferences:Object.freeze({...preferences}),expiresAt:Date.now()+MAX_AGE_MS,
      count:0,lastAttemptAt:0,stopped:false,automaticClicks:0,
      lastActionKey:null,lastActionDigest:null,lastAction:null,
      providerStep:null};
    this.autoSessions.set(windowId,session);
    return this.autoInfo(session,'armed',developerTest
      ? 'Developer multi-step test armed. Official login, queue, CAPTCHA and checkout are user-owned.'
      : mode==='observe'&&consent.mode==='authorized'
        ? 'Provider automation unavailable: '+permission.reason+' Visual guidance only.'
        : 'Advance-approved assistance armed. Unsafe steps pause for user control.');
  }
  disarm(windowId,{completed=false}={}) {
    const pendingTimer=this.autoTimers.get(windowId);
    if(pendingTimer){clearTimeout(pendingTimer);this.autoTimers.delete(windowId);}
    const session=this.autoSessions.get(windowId);
    if(!session)return false;
    session.stopped=true;
    this.autoSessions.delete(windowId);
    this.clear(windowId);
    if(!completed)this.autoInfo(session,'stopped','Advance authorization revoked.');
    return true;
  }
  autoStatus(windowId){
    const s=this.autoSessions.get(windowId);
    return s ? s.lastInfo
      : {windowId,mode:'manual',status:'off',reason:'Not armed.',targets:[]};
  }
  /** Infers a narrow, recognizable seat-selection route AFTER an authorized
   * booking-entry action; ambiguous pages remain explicitly user-controlled. */
  inferSelectionStage(windowId) {
    const session=this.autoSessions.get(windowId),entry=this.ticketWindows.get(windowId);
    if(!session || !entry || entry.phase!=='preparing' ||
       session.lastAction!=='continue')return false;
    try {
      this.verify(windowId,{localPreview:true});
      const route=new URL(entry.win.webContents.getURL()).pathname;
      if(!/(?:^|\/)(?:select-seats?|seat-?map|seats|seat|ticket\/select|booking\/select)(?:[\/.?_-]|$)/i.test(route))
        return false;
      entry.phase='selecting';
      this.autoInfo(session,'progress','Recognized official seat-selection route. Continuing approved steps.');
      return true;
    }catch{return false;}
  }
  /** Move one live approval to a new, actually linked official provider popup.
   * NEVER copy it to another provider or create a second active executor.
   * Login and checkout popups remain subject to the normal screen blocklist. */
  handoffPopup(childId) {
    const child=this.ticketWindows.get(childId);
    const parent=child?.popup && this.ticketWindows.get(child.parentId);
    const session=parent && this.autoSessions.get(parent.win.id);
    if(!session || session.stopped || !child || !parent ||
       child.planId!==session.planId || child.providerId!==session.providerId ||
       parent.planId!==session.planId || parent.providerId!==session.providerId ||
       Date.now()>=session.expiresAt)return false;
    try {
      const {isHostAllowed,isSafeWebUrl}=require('../security.cjs');
      const url=child.win.webContents.getURL();
      const hosts=this.requireInstalled(child.providerId)?.allowedHosts;
      if(!isSafeWebUrl(url) || !Array.isArray(hosts) ||
         !isHostAllowed(new URL(url).hostname,hosts))return false;
    }catch{return false;}
    const pending=this.autoTimers.get(parent.win.id);
    if(pending)clearTimeout(pending);
    this.autoTimers.delete(parent.win.id);
    this.autoSessions.delete(parent.win.id);
    this.clear(parent.win.id);
    session.windowId=childId;
    this.autoSessions.set(childId,session);
    this.autoInfo(session,'armed','Continuing on the linked official provider popup. Sensitive stages remain manual.');
    void this.observe(childId);
    return true;
  }
  async observe(windowId) {
    const session=this.autoSessions.get(windowId);
    if(!session || this.autoPending.has(windowId))return;
    const entry=this.ticketWindows.get(windowId);
    if(session.providerId==='nol' && entry){
      const observed=assessNolScreen({
        url:entry.win?.webContents?.getURL?.(),phase:entry.phase});
      // Never carry a previous page's stage label into a new observation.
      session.providerStep=observed;
      if(['human_gate','checkout_unverified'].includes(observed.step)){
        this.autoInfo(session,observed.step==='checkout_unverified'
          ? 'hold_unverified':'awaiting_user',observed.detail);
        return;
      }
    }
    const check=canRun(session,entry);
    if(!check.allowed) {
      if(check.reason==='Automatic AI cooldown.') {
        // Coalesce short-lived navigation changes into one approved AI
        // observation; never bypass the per-session limit or URL/stage checks.
        if(!this.autoTimers.has(windowId)) {
          const delay=Math.max(250,MIN_ANALYSIS_GAP_MS-(Date.now()-session.lastAttemptAt)+50);
          const timer=setTimeout(()=>{
            this.autoTimers.delete(windowId);
            if(!session.stopped && this.autoSessions.get(windowId)===session)
              void this.observe(windowId);
          },delay);
          timer.unref?.();
          this.autoTimers.set(windowId,timer);
        }
      } else {
        // The official checkout/cart may represent a candidate hold, but never
        // assert reservation success from a route or screenshot alone.
        const url=entry?.win?.webContents?.getURL?.()||'';
        const atCheckout=/\/(?:checkout|cart|payment|pay)(?:[\/?#]|$)/i.test(url);
        this.autoInfo(session,atCheckout?'hold_unverified':'awaiting_user',
          atCheckout
            ? 'Checkout/cart reached. Verify the official seat hold and total; no automatic payment.'
            : check.reason);
      }
      return;
    }
    // Screen restrictions are rechecked before EVERY capture and after AI latency.
    try {this.verify(windowId,{localPreview:true});}
    catch(error){
      const url=entry?.win?.webContents?.getURL?.()||'';
      const atCheckout=/\/(?:checkout|cart|payment|pay)(?:[\/?#]|$)/i.test(url);
      this.autoInfo(session,atCheckout?'hold_unverified':'awaiting_user',
        atCheckout
          ? 'Checkout/cart reached. Verify the official seat hold and total; no automatic payment.'
          : error.message);
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
      if(session.providerId==='nol'){
        const observed=assessNolScreen({
          url:entry.win.webContents.getURL(),phase:entry.phase,
          visionStage:response.stageHint?.stage,
          visionConfidence:response.stageHint?.confidence});
        session.providerStep=observed;
        if(['human_gate','checkout_unverified'].includes(observed.step) ||
           observed.evidence==='phase_conflict'){
          this.autoInfo(session,observed.step==='checkout_unverified'
            ? 'hold_unverified':'awaiting_user',observed.detail);
          return;
        }
      }
      const candidates=response.targets.filter(t=>session.consent.actions.includes(t.kind));
      const addon=this.requireInstalled(entry.providerId);
      const decision=chooseStep({session,entry,addon,
        developerEnabled:this.developerClickTestEnabled()},candidates);
      // Every mutation gets a new image, host-level permission check, and
      // a duplicate-target guard. The AI response is merely a proposal.
      if(decision.target) {
        if(session.lastActionDigest && this.snapshots.get(windowId)?.digest===session.lastActionDigest){
          this.autoInfo(session,'awaiting_user',
            'The official page has not changed since the previous click. Check progress manually.',
            {targets:candidates});
          return;
        }
        const observedDigest=this.snapshots.get(windowId)?.digest;
        const result=await this.click(windowId,shot.token,
          {x:decision.target.x,y:decision.target.y},
          {autoSession:session,autoTarget:decision.target});
        session.automaticClicks+=1;
        session.lastActionKey=decision.key;
        session.lastActionDigest=observedDigest || null;
        session.lastAction=decision.target.kind;
        this.autoInfo(session,'progress',
          'Step '+session.automaticClicks+' input sent ('+decision.target.kind+'). Verifying next screen.',
          {targets:[decision.target],clickResult:result});
        if(session.automaticClicks>=MAX_AUTO_STEPS){
          this.autoInfo(session,'awaiting_user',
            'Maximum step budget reached. Review the official page before starting another approved session.');
          return;
        }
        // A click can update a page without navigation (SPA). Schedule a
        // bounded re-observation rather than waiting for a new URL.
        this.scheduleNext(windowId,session,MIN_ANALYSIS_GAP_MS+100);
        return;
      }
      if(candidates.length && session.mode==='observe') {
        await this.highlight(windowId,shot.token,{x:candidates[0].x,y:candidates[0].y});
      }
      this.autoInfo(session,candidates.length?'awaiting_user':'awaiting_user',
        decision.reason+' Make any necessary user action, then resume.',
        {targets:candidates});
    }catch(error){
      if(!session.stopped && this.autoSessions.get(windowId)===session)
        this.autoInfo(session,'paused',error instanceof Error?error.message:String(error));
    }finally {this.autoPending.delete(windowId);}
  }
  scheduleNext(windowId,session,delay=MIN_ANALYSIS_GAP_MS+100) {
    if(this.autoTimers.has(windowId))clearTimeout(this.autoTimers.get(windowId));
    const timer=setTimeout(()=>{
      this.autoTimers.delete(windowId);
      if(!session.stopped && this.autoSessions.get(windowId)===session)
        void this.observe(windowId);
    },delay);
    timer.unref?.();
    this.autoTimers.set(windowId,timer);
  }
  resume(windowId) {
    const session=this.autoSessions.get(windowId);
    if(!session || session.stopped)throw new Error('No active Copilot session to resume.');
    if(Date.now()>=session.expiresAt)throw new Error('Copilot approval expired. Reapprove your plan.');
    this.scheduleNext(windowId,session,25);
    return this.autoInfo(session,'resuming','Checking the official site after your manual action.');
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
  async verifiedTarget(windowId,token,point,{readOnly=false,autoPreparing=false}={}) {
    const options=readOnly || autoPreparing ? {localPreview:true} : {};
    const entry=this.verify(windowId,options),preview=this.snapshots.get(windowId);
    const check=readOnly || autoPreparing ? validObservation : validSnapshot;
    check(preview,entry,token,entry.win.webContents.getURL());
    const bounds=entry.win.getContentBounds();
    if(bounds.width!==preview.width || bounds.height!==preview.height)
      throw new Error('Window dimensions changed. Capture a fresh screen.');
    const target=pixelPoint(point,bounds.width,bounds.height);
    if(readOnly)return {entry,preview,target};
    const current=await this.takeImage(entry);
    this.verify(windowId,options);
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
    // Visual hints are not click authority or reservation evidence.
    const stage=['event','selecting','waiting','queue','checkout','unknown']
      .includes(response.screenStage)?response.screenStage:'unknown';
    const confidence=Number.isFinite(response.stageConfidence) &&
      response.stageConfidence>=0 && response.stageConfidence<=1
        ? response.stageConfidence:0;
    return {status:response.status,targets,advisoryOnly:true,
      humanApprovalRequired:true,snapshotToken:preview.token,
      stageHint:{stage,confidence}};
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
  async click(windowId,token,point,options={}) {
    // Focus can trigger website overlays, layout changes or browser redraws.
    // Always perform the final image comparison AFTER bringing it forward.
    const autoSession=options.autoSession;
    const live=this.verify(windowId,autoSession &&
      this.ticketWindows.get(windowId)?.phase==='preparing'
        ? {localPreview:true} : {});
    if(live.win.isMinimized())live.win.restore();
    live.win.show();live.win.focus();
    const {entry,preview,target}=await this.verifiedTarget(windowId,token,point,
      {autoPreparing:Boolean(autoSession && live.phase==='preparing')});
    if(autoSession){
      if(this.autoSessions.get(windowId)!==autoSession ||
         !actionPermission({session:autoSession,entry,
           addon:this.requireInstalled(entry.providerId),target:options.autoTarget,
           developerEnabled:this.developerClickTestEnabled()}).allowed)
        throw new Error('Approved automatic action expired or provider/plan policy changed.');
    }
    preview.consumed=true;
    this.snapshots.delete(windowId);
    this.clear(windowId);
    entry.win.webContents.sendInputEvent({type:'mouseDown',
      x:target.x,y:target.y,button:'left',clickCount:1});
    entry.win.webContents.sendInputEvent({type:'mouseUp',
      x:target.x,y:target.y,button:'left',clickCount:1});
    return {clicked:true,verifiedPurchase:false,automatic:Boolean(autoSession),
      developerTest:!!autoSession && autoSession.mode==='dev_flow'};
  }
}
module.exports={LiveCopilot};
