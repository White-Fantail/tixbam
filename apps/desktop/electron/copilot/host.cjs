'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { BrowserWindow } = require('electron');
const { screenAllowed,pixelPoint,validSnapshot,SNAPSHOT_TTL_MS } = require('./core.cjs');
const MAX_JPEG_BYTES = 1500000;
/** Host-only, opt-in local screenshot preview and human-directed pointer.
 * No website code injection, remote vision uploads, auto-click loops or payments.
 * Live unattended actions require a SEPARATE verified provider executor.
 */
class LiveCopilot {
  constructor({ticketWindows,requireInstalled}) {
    this.ticketWindows=ticketWindows;this.requireInstalled=requireInstalled;
    this.snapshots=new Map();this.overlays=new Map();this.visionProvider=null;
  }
  setVisionProvider(provider) {
    if(typeof provider!=='function')throw new TypeError('Trusted Vision service required');
    this.visionProvider=provider;
  }
  verify(windowId, options = {}) {
    if(!Number.isInteger(windowId))throw new Error('Invalid Copilot window.');
    const entry=this.ticketWindows.get(windowId);
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
  clearAll() {for(const id of [...this.overlays.keys(),...this.snapshots.keys()])this.clear(id);}
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
      width:bounds.width,height:bounds.height,consumed:false});
    return {token,windowId,expiresAt:issuedAt+SNAPSHOT_TTL_MS,
      image:'data:image/jpeg;base64,'+bytes.toString('base64'),
      width:bounds.width,height:bounds.height,
      mode,automaticClickAvailable:false};
  }
  async verifiedTarget(windowId,token,point) {
    const entry=this.verify(windowId),preview=this.snapshots.get(windowId);
    validSnapshot(preview,entry,token,entry.win.webContents.getURL());
    const bounds=entry.win.getContentBounds();
    if(bounds.width!==preview.width || bounds.height!==preview.height)
      throw new Error('Window dimensions changed. Capture a fresh screen.');
    const target=pixelPoint(point,bounds.width,bounds.height);
    const current=await this.takeImage(entry);
    this.verify(windowId);
    validSnapshot(preview,entry,token,entry.win.webContents.getURL());
    if(crypto.createHash('sha256').update(current).digest('hex')!==preview.digest)
      throw new Error('The visible screen changed. Take a new preview before clicking.');
    return {entry,preview,target,current};
  }
  /** AI proposals remain advisory. A signed-in user must opt in for EACH
   * screenshot upload and still explicitly choose and approve a target.
   */
  async analyze(windowId,token,preferences) {
    if(!this.visionProvider)throw new Error('Copilot Vision is unavailable.');
    const {entry,preview,current}=await this.verifiedTarget(windowId,token,{x:0.5,y:0.5});
    if(!preferences || !Number.isInteger(preferences.quantity) || preferences.quantity<1 ||
       preferences.quantity>20 || !Number.isSafeInteger(preferences.budgetMinor) ||
       preferences.budgetMinor<0 || preferences.budgetMinor>10000000000 ||
       !/^[A-Z]{3}$/.test(preferences.currency||'') ||
       !['ko','en'].includes(preferences.locale))
      throw new Error('Invalid Copilot ticket conditions.');
    const response=await this.visionProvider({
      providerId:entry.providerId,quantity:preferences.quantity,
      currency:preferences.currency,budgetMinor:preferences.budgetMinor,
      locale:preferences.locale,imageBase64:current.toString('base64')
    });
    await this.verifiedTarget(windowId,token,{x:0.5,y:0.5});
    if(response?.advisoryOnly!==true || response.humanApprovalRequired!==true ||
       !Array.isArray(response.targets) || response.targets.length>5)
      throw new Error('Invalid read-only Copilot Vision response.');
    const {validPoint}=require('./core.cjs');
    const targets=response.targets.filter(t=>validPoint(t) &&
      typeof t.label==='string'&&t.label.length<=60 &&
      typeof t.reason==='string'&&t.reason.length<=160 &&
      typeof t.confidence==='number'&&t.confidence>=0.85 &&
      ['seat','price_tier','performance','quantity','continue'].includes(t.kind));
    return {status:response.status,targets,advisoryOnly:true,
      humanApprovalRequired:true,snapshotToken:preview.token};
  }
  async highlight(windowId,token,point) {
    const {entry,target}=await this.verifiedTarget(windowId,token,point);
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
    const {entry,preview,target}=await this.verifiedTarget(windowId,token,point);
    preview.consumed=true;
    this.snapshots.delete(windowId);
    this.clear(windowId);
    if(entry.win.isMinimized())entry.win.restore();
    entry.win.show();entry.win.focus();
    entry.win.webContents.sendInputEvent({type:'mouseDown',
      x:target.x,y:target.y,button:'left',clickCount:1});
    entry.win.webContents.sendInputEvent({type:'mouseUp',
      x:target.x,y:target.y,button:'left',clickCount:1});
    return {clicked:true,verifiedPurchase:false,automatic:false};
  }
}
module.exports={LiveCopilot};
