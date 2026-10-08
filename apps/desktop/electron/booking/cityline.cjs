// Bundled host-owned adapter. No downloaded JavaScript or arbitrary selectors are executed.
// Only the public eventDetail controls below have been observed on Cityline (2026-10-08).
const { isSafeWebUrl, isHostAllowed } = require('../security.cjs');
function schemaFor(addon, page = {}) {
  if (!addon.booking) return null;
  return { ...addon.booking, fields: addon.booking.fields.map(f => ({ ...f, ...(page.options?.[f.id] ? { choices: page.options[f.id] } : {}) })) };
}
function inspectCityline(expectedEvent) {
  const visible = e => Boolean(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const text = e => e?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const url = new URL(location.href);
  if (url.protocol !== 'https:' || !['cityline.com.hk','cityline.com'].some(root => url.hostname === root || url.hostname.endsWith('.' + root))) throw new Error('Untrusted booking page.');
  const eventId = url.searchParams.get('event');
  const challenge = /login/i.test(url.pathname) || Array.from(document.querySelectorAll('input[type=password]')).some(visible) ? 'Sign in in the provider window, then resume.' :
    Array.from(document.querySelectorAll('#inputCaptcha,iframe[src*="captcha"],.g-recaptcha')).some(visible) ? 'Complete CAPTCHA in the provider window, then resume.' :
    /queue|waitingroom/i.test(url.pathname) ? 'Wait in the official queue, then resume when admitted.' : null;
  const performances = Array.from(document.querySelectorAll('button.date-time-position[data-perf-id]')).filter(visible).map(e => ({ id: e.getAttribute('data-perf-id'), label: text(e), available: !e.disabled }));
  const prices = Array.from(document.querySelectorAll('button.price-btn')).filter(visible).map(e => ({ id: text(e).replace(/,/g, ''), label: 'HK$' + text(e), available: !e.disabled }));
  return { stage: performances.length && prices.length ? 'options' : 'unknown', challenge, providerEventId: eventId || expectedEvent,
    providerTitle: document.title.slice(0,200), options: { performance: performances, priceTier: prices } };
}
function selectCityline(values) {
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
  performance.click(); price.click(); next[0].click(); return true;
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
    const result = await bounded(this.wc.executeJavaScript('(' + inspectCityline.toString() + ')(' + JSON.stringify(this.providerEventId) + ')'));
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
