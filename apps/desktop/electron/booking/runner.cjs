const crypto = require('node:crypto');
const { chooseOffer, validOrder } = require('./preferences.cjs');
const TERMINAL = new Set(['completed', 'stopped', 'failed', 'payment_unknown']);
class BookingRunner {
  constructor({ adapter, preferences, eventKey, windowId, secret, notify, payment = null, rehearsal = false }) {
    this.adapter = adapter; this.payment = payment; this.preferences = structuredClone(preferences); this.secret = secret; this.notify = notify;
    this.state = { id: crypto.randomUUID(), windowId, eventKey, status: 'running', message: 'Reading booking page…', rehearsal, startedAt: Date.now() };
    this.busy = false; this.cancelled = false; this.submitted = false; this.selectionMade = false;
  }
  update(status, message, extra = {}) { this.state = { ...this.state, ...extra, status, message }; if (TERMINAL.has(status)) this.secret?.clear(); this.notify(this.state); }
  stop() { this.cancelled = true; this.secret?.clear(); this.update('stopped', this.submitted ? 'Stopped and cleared payment preparation. Payment was already submitted; check provider order history.' : 'Stopped. Payment preparation cleared.'); }
  async step(confirm = false) {
    if (this.busy || this.cancelled || TERMINAL.has(this.state.status)) return;
    if (this.state.status === 'review' && !confirm) return;
    this.busy = true;
    try {
      const page = await this.adapter.read();
      if (this.cancelled) return;
      if (page.eventKey !== this.state.eventKey) { this.update('awaiting_user', 'The page is for another event. Return to the saved event.'); return; }
      if (page.challenge) { this.update('awaiting_user', page.challenge); return; }
      if (page.stage === 'confirmation') {
        if (!this.submitted || !page.order || !validOrder(page.order, this.preferences, this.expected) || !page.receipt) {
          this.update('awaiting_user', 'Completion could not be verified. Check the provider order history.'); return;
        }
        this.update('completed', 'Booking confirmed by the provider.', { receipt: page.receipt }); return;
      }
      if (this.submitted) { this.update('payment_unknown', 'Payment was submitted once. Check the provider order history before trying again.'); return; }
      if (page.stage === 'options') {
        if (this.selectionMade) { this.update('awaiting_user', 'The booking page has not advanced. Check the selected options before resuming.'); return; }
        const chosen = await this.adapter.selectOptions(this.preferences);
        if (this.cancelled) return;
        if (!chosen) { this.update('awaiting_user', 'No available option matches your preferences. No alternative was selected.'); return; }
        this.selectionMade = true;
        this.update('running', 'Preferred performance and price selected. Waiting for the next step.'); return;
      }
      if (page.stage === 'offers') {
        const offer = chooseOffer(page.offers, this.preferences);
        if (!offer) { this.update('awaiting_user', 'No seats satisfy the quantity, adjacency, preferences and budget including fees.'); return; }
        await this.adapter.reserve(offer);
        if (!this.cancelled) this.update('running', 'Selected seats. Checking the final order.'); return;
      }
      if (page.stage === 'payment') {
        const order = page.order;
        if (!order || !validOrder(order, this.preferences, order)) {
          this.update('awaiting_user', 'The final order does not satisfy your requirements, or its total including fees is unknown.'); return;
        }
        if (!this.expected) this.expected = structuredClone(order);
        if (!validOrder(order, this.preferences, this.expected)) { this.update('awaiting_user', 'The order changed. Stop and review before starting again.'); return; }
        if (!this.payment?.verified) { this.update('awaiting_user', 'This payment page has not been verified for automatic entry. Complete payment in the provider window.'); return; }
        if (this.preferences.checkout === 'review' && !confirm) { this.update('review', 'Check the final order, then confirm payment.', { order }); return; }
        // Re-read immediately before the irreversible operation, then latch before calling it.
        const fresh = await this.adapter.read();
        if (this.cancelled) return;
        if (fresh.eventKey !== this.state.eventKey || fresh.challenge || fresh.stage !== 'payment' || !validOrder(fresh.order, this.preferences, this.expected)) { this.update('awaiting_user', 'The payment page changed. Review the provider window.'); return; }
        if (!this.secret) throw new Error('Payment preparation unavailable.');
        // Secrets go only to the host-owned payment service, never the add-on adapter.
        await this.secret.use(card => {
          this.submitted = true;
          this.update('submitting', 'Submitting payment once.');
          return this.payment.submit(card, this.expected);
        });
        if (!this.cancelled) this.update('running', 'Waiting for provider confirmation.'); return;
      }
      this.update('awaiting_user', 'This page needs your attention. Continue in the provider window, then resume.');
    } catch {
      if (!this.cancelled) this.update(this.submitted ? 'payment_unknown' : 'failed', this.submitted ? 'Payment outcome is unknown. Check the provider order history; automatic retry is disabled.' : 'Booking could not continue. Payment preparation cleared. Stop and start again.');
    } finally { this.busy = false; }
  }
}
module.exports = { BookingRunner, TERMINAL };
