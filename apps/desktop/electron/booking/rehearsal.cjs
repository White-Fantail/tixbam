// Deterministic rehearsal: no website requests, no cards, no charges.
class RehearsalAdapter {
  constructor(key, prefs) { this.key = key; this.prefs = prefs; this.stage = 'options'; this.paymentVerified = true; this.challenge = null; }
  async read() {
    return { eventKey: this.key, stage: this.stage, challenge: this.challenge, offers: this.offers, order: this.order, receipt: this.stage === 'confirmation' ? 'REHEARSAL-NO-CHARGE' : undefined };
  }
  async selectOptions(prefs) {
    const totalMinor = Number(prefs.options.priceTier[0]) * 100 * prefs.quantity + 3500 * prefs.quantity;
    this.offers = [{ id: 'rehearsal-order', eventKey: this.key, available: true, quantity: prefs.quantity, currency: 'HKD', totalMinor, feesIncluded: true, adjacent: true,
      priceTier: prefs.options.priceTier[0], performance: prefs.options.performance, section: prefs.options.section[0] || 'A', floor: prefs.options.floor[0] || 'Stalls',
      seatMode: prefs.options.seatMode || 'assigned', fulfillment: prefs.options.fulfillment || 'eticket', seats: Array.from({length:prefs.quantity}, (_,i) => 'A-' + (i + 1)) }];
    this.stage = 'offers'; return true;
  }
  async reserve(offer) { this.order = { ...offer }; this.stage = 'payment'; }
  async pay() { this.challenge = 'Rehearsal: simulate completing 3-D Secure, then resume. No payment was made.'; this.stage = 'confirmation'; }
  completeChallenge() { this.challenge = null; }
}
const rehearsalOptions = { options: { performance: [{ id: 'demo-evening', label: 'Rehearsal · Evening performance' }], priceTier: [{ id: '800', label: 'HK$800 (demo)' }, { id: '500', label: 'HK$500 (demo)' }] } };
module.exports = { RehearsalAdapter, rehearsalOptions };
