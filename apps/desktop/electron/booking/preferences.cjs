const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function eventKey(providerId, eventUrl) {
  return crypto.createHash('sha256').update(providerId + '\n' + eventUrl).digest('hex');
}
function validatePreferences(input, schema) {
  if (!input || typeof input !== 'object' || !schema) throw new Error('Booking settings are unavailable.');
  const { quantity, maxTotalMinor, currency, requireTogether, allowFallback, checkout } = input;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > schema.maxTickets) throw new Error('Choose a valid ticket quantity.');
  if (!Number.isSafeInteger(maxTotalMinor) || maxTotalMinor <= 0) throw new Error('Enter a positive total budget, including fees.');
  if (currency !== schema.currency) throw new Error('The budget currency does not match this event.');
  if (typeof requireTogether !== 'boolean' || typeof allowFallback !== 'boolean') throw new Error('Invalid seat requirements.');
  if (!['review', 'automatic'].includes(checkout)) throw new Error('Choose a checkout mode.');
  const options = {};
  for (const field of schema.fields) {
    const value = input.options?.[field.id] ?? (field.type === 'ranked' ? [] : '');
    if (field.type === 'ranked') {
      if (!Array.isArray(value) || value.length > 30 || new Set(value).size !== value.length || value.some(v => typeof v !== 'string' || v.length > 160 || !v.trim())) throw new Error('Invalid preference order.');
      if (field.choices && value.some(v => !field.choices.some(c => c.id === v))) throw new Error('Options have changed. Read the event options again.');
      options[field.id] = [...value];
    } else {
      if (typeof value !== 'string' || value.length > 160 || (value && field.choices && !field.choices.some(c => c.id === value))) throw new Error('Invalid booking option.');
      options[field.id] = value;
    }
    if (field.required && (!value || (Array.isArray(value) && !value.length))) throw new Error('Select ' + field.label + '.');
  }
  // Construct an allowlisted record. Secret/unknown properties never reach disk.
  return { schemaVersion: 1, quantity, maxTotalMinor, currency, requireTogether, allowFallback, checkout, options };
}
function chooseOffer(offers, prefs) {
  const ranked = ['priceTier', 'section', 'floor'];
  const valid = offers.filter(o => {
    if (!o.available || o.quantity !== prefs.quantity || o.currency !== prefs.currency ||
      !Number.isSafeInteger(o.totalMinor) || o.totalMinor <= 0 || o.totalMinor > prefs.maxTotalMinor || o.feesIncluded !== true) return false;
    if (prefs.requireTogether && prefs.quantity > 1 && o.adjacent !== true) return false;
    if (prefs.options.performance && o.performance !== prefs.options.performance) return false;
    if (prefs.options.seatMode && o.seatMode !== prefs.options.seatMode) return false;
    if (prefs.options.fulfillment && o.fulfillment !== prefs.options.fulfillment) return false;
    return ranked.every(key => {
      const values = prefs.options[key] || [];
      return !values.length || (prefs.allowFallback ? values.includes(o[key]) : o[key] === values[0]);
    });
  });
  const score = o => ranked.map(key => {
    const values = prefs.options[key] || [];
    return values.length ? values.indexOf(o[key]) : 0;
  });
  return valid.sort((a, b) => {
    const left = score(a), right = score(b);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] - right[i];
    return a.totalMinor - b.totalMinor;
  })[0] || null;
}
function validOrder(order, prefs, expected) {
  // Exact immutable order identity and all hard requirements must still match at payment.
  const chosen = chooseOffer([{ ...order, available: true }], prefs);
  return Boolean(chosen && Array.isArray(order.seats) && order.seats.length === prefs.quantity && order.seats.every(s => typeof s === 'string' && s.length > 0) && new Set(order.seats).size === order.seats.length && order.id && order.id === expected.id && order.eventKey === expected.eventKey &&
    order.totalMinor === expected.totalMinor && JSON.stringify(order.seats) === JSON.stringify(expected.seats));
}
class PreferenceStore {
  constructor(file) { this.file = file; }
  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return {}; throw new Error('Could not read local booking preferences.'); }
  }
  get(key, schema) { const v = this.read()[key]; return v ? validatePreferences(v, schema) : null; }
  set(key, input, schema) {
    const value = validatePreferences(input, schema), all = this.read(); all[key] = value;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(all), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file); return value;
  }
}
module.exports = { eventKey, validatePreferences, chooseOffer, validOrder, PreferenceStore };
