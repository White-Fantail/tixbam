const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function normalizeCard(input, now = new Date()) {
  const number = String(input?.number || '').replace(/[ -]/g, '');
  if (!/^\d{13,19}$/.test(number)) throw new Error('Enter a valid card number.');
  let sum = 0;
  [...number].reverse().forEach((c, i) => { let n = Number(c); if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; });
  if (sum % 10) throw new Error('Enter a valid card number.');
  const month = Number(input.expiryMonth), year = Number(input.expiryYear);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < now.getFullYear() || year > now.getFullYear() + 30 || (year === now.getFullYear() && month < now.getMonth() + 1)) throw new Error('Enter a valid expiry date.');
  const name = String(input.name || '').trim(), label = String(input.label || '').trim();
  if (!name || name.length > 100 || !label || label.length > 60) throw new Error('Enter a card name and nickname.');
  // CVV is deliberately not part of the persisted shape.
  return { number, expiryMonth: month, expiryYear: year, name, label };
}
class CardVault {
  constructor(file, safeStorage) { this.file = file; this.safeStorage = safeStorage; }
  available() {
    return this.safeStorage.isEncryptionAvailable() && (!this.safeStorage.getSelectedStorageBackend || this.safeStorage.getSelectedStorageBackend() !== 'basic_text');
  }
  ensure() { if (!this.available()) throw new Error('Secure operating-system storage is unavailable. Card saving is disabled.'); }
  read() {
    this.ensure();
    try { return JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file))); }
    catch (e) { if (e.code === 'ENOENT') return []; throw new Error('Could not unlock the local card vault.'); }
  }
  write(cards) {
    this.ensure(); fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', this.safeStorage.encryptString(JSON.stringify(cards)), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  list() { return this.read().map(({ id, label, number, expiryMonth, expiryYear }) => ({ id, label, last4: number.slice(-4), expiryMonth, expiryYear })); }
  save(input) { const card = { id: crypto.randomUUID(), ...normalizeCard(input) }; const cards = this.read(); if (cards.length >= 10) throw new Error('Remove a card before saving another.'); this.write([...cards, card]); return this.list(); }
  remove(id) { this.write(this.read().filter(c => c.id !== id)); return this.list(); }
  unlock(id) { const card = this.read().find(c => c.id === id); if (!card) throw new Error('Card not found.'); normalizeCard(card); return card; }
}
class RunSecret {
  constructor(card, cvv, ttlMs = 30 * 60 * 1000) {
    if (!/^\d{3,4}$/.test(cvv)) throw new Error('Enter a valid security code for this run.');
    this.card = Buffer.from(JSON.stringify(card)); this.cvv = Buffer.from(cvv); this.expiresAt = Date.now() + ttlMs;
    this.timer = setTimeout(() => this.clear(), ttlMs); this.timer.unref?.();
  }
  use(fn) {
    if (!this.card || Date.now() >= this.expiresAt) { this.clear(); throw new Error('Payment preparation expired. Stop and start again.'); }
    return fn({ ...JSON.parse(this.card.toString()), cvv: this.cvv.toString() });
  }
  clear() { clearTimeout(this.timer); this.card?.fill(0); this.cvv?.fill(0); this.card = null; this.cvv = null; }
}
module.exports = { CardVault, RunSecret, normalizeCard };
