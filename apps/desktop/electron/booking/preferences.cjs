const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {rankOffers,verifyFinalOrder,termsAllow} = require('./offer-policy.cjs');

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
  // Advanced seat/age/identity/extras consents are explicit, opt-in only.
  // Never infer any opt-in from an offer, add-on, model or price label.
  if (input.terms !== undefined && !termsAllow({terms:input.terms}))
    throw new Error('Invalid booking restriction consent.');
  return { schemaVersion: 1, quantity, maxTotalMinor, currency, requireTogether,
    allowFallback, checkout, options,
    ...(input.terms!==undefined?{terms:structuredClone(input.terms)}:{}) };
}
function chooseOffer(offers, prefs, scope = null) {
  // Preserve original object identity for existing runners and AB-03 targets.
  return rankOffers(offers,prefs,scope)[0] || null;
}
function validOrder(order, prefs, expected, scope = null) {
  return verifyFinalOrder(order,prefs,expected,scope).ok;
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
