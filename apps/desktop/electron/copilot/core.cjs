'use strict';
const { isSafeWebUrl, isHostAllowed } = require('../security.cjs');
const SENSITIVE_ROUTE = /(?:^|[\/._-])(checkout|cart|payment|pay|3ds|3dsecure|captcha|login|signin|sign-in|auth|queue|waiting|verify|bank|otp)(?:[\/._-]|$)/i;
const SNAPSHOT_TTL_MS = 90000;
function screenAllowed(entry, allowedHosts, windowId, options = {}) {
  if (!entry || (entry.popup && !Number.isInteger(entry.parentId)) ||
      !entry.planId || entry.win?.isDestroyed?.() ||
      entry.win?.webContents?.isDestroyed?.() || entry.win?.webContents?.isLoading?.() ||
      (windowId !== undefined && entry.win?.id !== windowId))
    return {allowed:false,reason:'No active, fully loaded Booking Plan browser.'};
  // A preparation-stage image is only a LOCAL, read-only connection check.
  // Never extend this exemption to AI, overlays or click execution.
  if (entry.phase !== 'selecting' && !(options.localPreview === true && entry.phase === 'preparing'))
    return {allowed:false,reason:'Interactive guidance is available only at ticket selection. Queue, login, checkout and payment remain manual.'};
  const url = entry.win.webContents.getURL();
  if (!isSafeWebUrl(url)) return {allowed:false,reason:'Untrusted browser URL.'};
  const parsed = new URL(url);
  if (!Array.isArray(allowedHosts) || !isHostAllowed(parsed.hostname,allowedHosts))
    return {allowed:false,reason:'The browser left the installed provider domain.'};
  if (SENSITIVE_ROUTE.test(parsed.pathname))
    return {allowed:false,reason:'This page may contain authentication, a queue or payment. Copilot capture is blocked.'};
  return {allowed:true,reason:entry.phase === 'preparing' ? 'preparation_preview_only' : 'selection_only'};
}
function validPoint(point) {
  return point && typeof point === 'object' &&
    Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1;
}
function pixelPoint(point,width,height) {
  if (!validPoint(point) || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 200 || height < 200 || width > 10000 || height > 10000)
    throw new Error('Invalid or out-of-bounds Copilot target.');
  return {x:Math.floor(point.x*width),y:Math.floor(point.y*height)};
}
// Compare the originally observed TARGET neighbourhood rather than every
// pixel of an otherwise live site. A countdown elsewhere must not invalidate
// a safe user-directed click; a moved or redrawn target still fails closed.
function targetRegion(point,width,height) {
  const centre=pixelPoint(point,width,height);
  const halfWidth=Math.max(42,Math.min(100,Math.floor(width*0.065)));
  const halfHeight=Math.max(32,Math.min(70,Math.floor(height*0.075)));
  const regionWidth=Math.min(width,halfWidth*2);
  const regionHeight=Math.min(height,halfHeight*2);
  return {x:Math.min(width-regionWidth,Math.max(0,centre.x-halfWidth)),
    y:Math.min(height-regionHeight,Math.max(0,centre.y-halfHeight)),
    width:regionWidth,height:regionHeight};
}
function validObservation(snapshot, entry, token, currentUrl, now = Date.now()) {
  if (!snapshot || typeof token !== 'string' || snapshot.token !== token ||
      !entry || entry.win.id !== snapshot.windowId ||
      entry.planId !== snapshot.planId || entry.providerId !== snapshot.providerId ||
      !['selecting','preparing'].includes(snapshot.phase) || entry.phase !== snapshot.phase ||
      currentUrl !== snapshot.url || now > snapshot.expiresAt ||
      now < snapshot.issuedAt || snapshot.consumed)
    throw new Error('Copilot preview expired or the booking page changed. Capture a fresh screen.');
}
function validSnapshot(snapshot, entry, token, currentUrl, now = Date.now()) {
  validObservation(snapshot,entry,token,currentUrl,now);
  if (snapshot.phase !== 'selecting')
    throw new Error('Clicking is available only at actual ticket selection.');
}
module.exports={screenAllowed,validPoint,pixelPoint,targetRegion,validSnapshot,validObservation,SNAPSHOT_TTL_MS};
