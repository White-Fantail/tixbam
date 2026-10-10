'use strict';
const { isSafeWebUrl, isHostAllowed } = require('../security.cjs');
const SENSITIVE_ROUTE = /(?:^|[\/._-])(checkout|payment|pay|3ds|3dsecure|captcha|login|signin|sign-in|auth|queue|waiting|verify|bank|otp)(?:[\/._-]|$)/i;
const SNAPSHOT_TTL_MS = 8000;
function screenAllowed(entry, allowedHosts, windowId) {
  if (!entry || entry.popup || !entry.planId || entry.win?.isDestroyed?.() ||
      entry.win?.webContents?.isDestroyed?.() || entry.win?.webContents?.isLoading?.() ||
      (windowId !== undefined && entry.win?.id !== windowId))
    return {allowed:false,reason:'No active, fully loaded Booking Plan browser.'};
  if (entry.phase !== 'selecting')
    return {allowed:false,reason:'Screenshot guidance is available only at the ticket-selection step. Login, queues, checkout and payment remain manual.'};
  const url = entry.win.webContents.getURL();
  if (!isSafeWebUrl(url)) return {allowed:false,reason:'Untrusted browser URL.'};
  const parsed = new URL(url);
  if (!Array.isArray(allowedHosts) || !isHostAllowed(parsed.hostname,allowedHosts))
    return {allowed:false,reason:'The browser left the installed provider domain.'};
  if (SENSITIVE_ROUTE.test(parsed.pathname))
    return {allowed:false,reason:'This page may contain authentication, a queue or payment. Copilot capture is blocked.'};
  return {allowed:true,reason:'selection_only'};
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
function validSnapshot(snapshot, entry, token, currentUrl, now = Date.now()) {
  if (!snapshot || typeof token !== 'string' || snapshot.token !== token ||
      !entry || entry.win.id !== snapshot.windowId ||
      entry.planId !== snapshot.planId || entry.providerId !== snapshot.providerId ||
      entry.phase !== 'selecting' || currentUrl !== snapshot.url ||
      now > snapshot.expiresAt || now < snapshot.issuedAt ||
      snapshot.consumed)
    throw new Error('Copilot preview expired or the booking page changed. Capture a fresh screen.');
}
module.exports={screenAllowed,validPoint,pixelPoint,validSnapshot,SNAPSHOT_TTL_MS};
