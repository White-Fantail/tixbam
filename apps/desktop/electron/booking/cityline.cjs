// Bundled host-owned adapter. No downloaded JavaScript or arbitrary selectors are executed.
// Only the public eventDetail controls below have been observed on Cityline (2026-10-08).
const { isSafeWebUrl, isHostAllowed } = require('../security.cjs');
function schemaFor(addon, page = {}) {
  if (!addon.booking) return null;
  return { ...addon.booking, fields: addon.booking.fields.map(f => ({ ...f, ...(page.options?.[f.id] ? { choices: page.options[f.id] } : {}) })) };
}
function inspectCityline(expectedEvent) {
  const visible = e => Boolean(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const text = e => typeof e?.textContent==='string' ? e.textContent.slice(0,160).replace(/\s+/g, ' ').trim() : '';
  const url = new URL(location.href);
  if (url.protocol !== 'https:' || !['cityline.com.hk','cityline.com'].some(root => url.hostname === root || url.hostname.endsWith('.' + root))) throw new Error('Untrusted booking page.');
  const eventId = url.searchParams.get('event');
  // Observe only fixed route markers and visible controls. Never read form
  // values, credentials, hidden fields, cookies, or embedded frames.
  const challengeType =
    /queue|waitingroom/i.test(url.pathname) ? 'queue' :
    /login/i.test(url.pathname) || Array.from(document.querySelectorAll('input[type=password]')).some(visible) ? 'login' :
    Array.from(document.querySelectorAll('#inputCaptcha,iframe[src*="captcha"],.g-recaptcha')).some(visible) ? 'captcha' :
    /3ds|acs|challenge/i.test(url.pathname) ? '3ds' : 'none';
  const challenge = challengeType === 'login' ? 'Sign in in the provider window, then resume.' :
    challengeType === 'captcha' ? 'Complete CAPTCHA in the provider window, then resume.' :
    challengeType === 'queue' ? 'Wait in the official queue, then resume when admitted.' :
    challengeType === '3ds' ? 'Complete bank authentication in the official window, then resume.' : null;
  const performanceNodes = document.querySelectorAll('button.date-time-position[data-perf-id]');
  const priceNodes = document.querySelectorAll('button.price-btn');
  // Stop before iterating oversized/unexpected documents, without sending
  // raw markup or collecting hidden/payment input values.
  const bounded = performanceNodes.length <= 30 && priceNodes.length <= 30;
  const performances = bounded ? Array.from(performanceNodes).filter(visible)
    .map(e => ({ id: e.getAttribute('data-perf-id'), label: text(e).slice(0,80), available: !e.disabled }))
    .filter(e=>typeof e.id==='string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,79}$/.test(e.id)) : [];
  const prices = bounded ? Array.from(priceNodes).filter(visible)
    .map(e => ({ id: text(e).replace(/,/g, ''), label: 'HK' + String.fromCharCode(36) + text(e).slice(0,80), available: !e.disabled }))
    .filter(e => /^\d{1,8}$/.test(e.id)) : [];
  return { stage: performances.length && prices.length && url.pathname.endsWith('/eventDetail') && (expectedEvent == null || eventId === expectedEvent) && !!eventId ? 'options' : 'unknown',
    challenge, challengeType, providerEventId: eventId || null,
    providerTitle: document.title.slice(0,200), options: { performance: performances, priceTier: prices } };
}
async function selectCityline(values) {
  const visible = e => Boolean(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const text = e => e.textContent.replace(/\s+/g, ' ').trim();
  const url = new URL(location.href);
  if (url.protocol !== 'https:' || !['cityline.com.hk','cityline.com'].some(root => url.hostname === root || url.hostname.endsWith('.' + root)) || !url.pathname.endsWith('/eventDetail') || url.searchParams.get('event') !== values.eventId) return false;
  const performances = Array.from(document.querySelectorAll('button.date-time-position[data-perf-id]')).filter(visible);
  const performance = performances.find(e => e.getAttribute('data-perf-id') === values.performance && !e.disabled);
  const prices = Array.from(document.querySelectorAll('button.price-btn')).filter(visible);
  const permitted = values.fallback ? values.prices : values.prices.slice(0, 1);
  const price = permitted.map(id => prices.find(e => text(e).replace(/,/g, '') === id && !e.disabled)).find(Boolean);
  const next = Array.from(document.querySelectorAll('button.purchase-btn')).filter(e => visible(e) && !e.disabled);
  if (!performance || !price || next.length !== 1) return false;
  // Do not click seats, agreements or payment controls without a verified page profile.
  performance.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  if (location.href !== url.href) return false;
  const refreshedPrices = Array.from(document.querySelectorAll('button.price-btn')).filter(visible);
  const refreshedPrice = permitted.map(id => refreshedPrices.find(e => text(e).replace(/,/g, '') === id && !e.disabled)).find(Boolean);
  if (!refreshedPrice) return false;
  refreshedPrice.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  if (location.href !== url.href) return false;
  const refreshedNext = Array.from(document.querySelectorAll('button.purchase-btn')).filter(e => visible(e) && !e.disabled);
  if (refreshedNext.length !== 1) return false;
  refreshedNext[0].click(); return true;
}
function bounded(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Booking page did not respond.')), 5000); })]).finally(() => clearTimeout(timer));
}
class CitylineAdapter {
  constructor(wc, addon, key, providerEventId) { this.wc = wc; this.addon = addon; this.key = key; this.providerEventId = providerEventId; this.paymentVerified = false; }
  ensureHost() {
    const target = this.wc.getURL();
    if (!isSafeWebUrl(target) || !isHostAllowed(new URL(target).hostname, this.addon.allowedHosts)) throw new Error('Untrusted booking page.');
  }
  async read() {
    this.ensureHost();
    const before = this.wc.getURL();
    const result = await bounded(this.wc.executeJavaScript('(' + inspectCityline.toString() + ')(' + JSON.stringify(this.providerEventId) + ')'));
    this.ensureHost();
    if (this.wc.getURL() !== before) throw new Error('Booking page navigated during observation.');
    return { ...result, eventKey: result.providerEventId === this.providerEventId ? this.key : null };
  }
  async selectOptions(prefs) {
    this.ensureHost();
    const u = new URL(this.wc.getURL());
    if (!u.pathname.endsWith('/eventDetail') || u.searchParams.get('event') !== this.providerEventId) return false;
    return bounded(this.wc.executeJavaScript('(' + selectCityline.toString() + ')(' + JSON.stringify({ eventId: this.providerEventId, performance: prefs.options.performance, prices: prefs.options.priceTier, fallback: prefs.allowFallback }) + ')'));
  }
}
module.exports = { CitylineAdapter, schemaFor, inspectCityline, selectCityline };
