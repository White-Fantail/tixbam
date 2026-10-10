'use strict';
const crypto = require('node:crypto');
const { chooseOffer, validOrder } = require('./preferences.cjs');
const { BookingOrchestrator } = require('./orchestrator.cjs');
const { assertDeterministicHostAction } = require('./action-registry.cjs');
const {ReservationTransaction}=require('./reservation.cjs');

const TERMINAL = new Set(['completed', 'stopped', 'failed', 'payment_unknown']);
const STOP_PRE = 'Stopped. Payment preparation cleared.';
const STOP_POST = 'Payment submission may have occurred. Check the provider order history. Automatic retry is disabled.';
const FAIL_PRE = 'Booking could not continue. Payment preparation cleared. Stop and start again.';
const FAIL_POST = 'Payment outcome is unknown. Check the provider order history; automatic retry is disabled.';

/** Compatibility façade for the provider-neutral host orchestration.
 * No AI, remote site or renderer can request a state transition directly.
 */
class BookingRunner {
  constructor({adapter, preferences, eventKey, windowId, secret,
               notify, payment = null, rehearsal = false, assertWindow = null, onPageRead = null,
               ledger = null, purchasePermit = null, sessionCoordinator = null, reservation=null,
               runId=crypto.randomUUID()}) {
    if(reservation!==null&&!(reservation instanceof ReservationTransaction))throw Error('Trusted reservation transaction required');
    this.reservation=reservation;
    this.adapter = adapter;
    this.onPageRead = onPageRead;
    this.payment = payment;
    this.ledger = ledger;
    this.sessionCoordinator = sessionCoordinator;
    this.purchasePermit = purchasePermit;
    this.paymentIntent = null;
    this.cloudClaimAttempted = false;
    this.preferences = structuredClone(preferences);
    this.secret = secret;
    this.secretCleared = false;
    this.selectionMade = false;
    this.expected = null;
    this.orchestrator = new BookingOrchestrator({
      runId, eventKey, windowId, rehearsal, notify, assertWindow,
    });
  }

  get state() { return this.orchestrator.state; }
  get busy() { return !!this.orchestrator.current; }
  get cancelled() { return this.orchestrator.cancelled; }
  get submitted() { return this.orchestrator.machine.commitStarted; }
  setMetadata(patch) { this.orchestrator.setMetadata(patch); }

  clearSecret() {
    if (this.secretCleared) return;
    this.secretCleared = true;
    this.secret?.clear();
  }

  stop() {
    const pendingReservation=this.reservation?.requested===true&&!this.state.manualPayment;
    const manual = pendingReservation||['MANUAL_PAYMENT','RESERVATION_UNKNOWN'].includes(this.state.phase);
    if(pendingReservation)this.orchestrator.setMetadata({reservationRecoveryRequired:true,reservationVerified:false});
    this.reservation?.invalidate();
    this.clearSecret();
    this.payment?.invalidate?.();
    if((this.cloudClaimAttempted||this.paymentIntent?.claimOnly) && !this.submitted && !this.orchestrator.machine.terminal){
      return this.orchestrator.transition('CLOUD_CLAIM_UNKNOWN',
        'Purchase safety review is required. Payment submission is not established; automatic retry is disabled.',
        {claimOnly:true,safetyRecoveryRequired:true}, {claimAttempted:true});
    }
    if (this.paymentIntent && this.ledger) {
      try { this.ledger.markUnknown(this.paymentIntent); }
      catch { /* The already-durable commit record remains unresolved. */ }
    }
    return this.orchestrator.interrupt(manual
      ? 'Automation stopped. The provider reservation or manual payment was not cancelled. Check the same provider window before starting another booking.'
      : STOP_PRE, STOP_POST);
  }

  async step(confirm = false) {
    let handle;
    try {
      handle = this.orchestrator.begin({confirm});
      if (!handle) return;
      const page = await this.adapter.read({signal:handle.signal});
      if (!this.orchestrator.check(handle)) return;
      if (this.onPageRead) this.onPageRead(page, this.state);
      const extra = ['options','offers','payment','confirmation','unknown'].includes(page?.stage)
        ? {aiPageStage:page.stage} : {};
      this.orchestrator.transition('OBSERVED', 'Evaluating booking page.', extra);
      if (page?.eventKey !== this.state.eventKey) {
        if (this.submitted) this.orchestrator.fail(FAIL_PRE, FAIL_POST);
        else this.orchestrator.transition('NEED_USER', 'The page is for another event. Return to the saved event.');
        return;
      }
      // Authentication, queue, CAPTCHA and bank verification remain user-owned.
      if (page.challenge) {
        this.orchestrator.transition('NEED_USER', page.challenge);
        return;
      }
      if(page.stage==='allocation'){
        if(!this.reservation){
          this.orchestrator.transition('NEED_USER','Express allocation is not verified for this provider. Continue manually in the provider window.');
          return;
        }
        this.reservation.assertBinding({runId:this.state.id,eventKey:this.state.eventKey,windowId:this.state.windowId});
        this.orchestrator.transition('VALIDATE_ACTION','Validating Express allocation.');
        if(!this.orchestrator.check(handle))return;
        this.orchestrator.transition('ACTION_VALIDATED','Requesting seat allocation once.');
        if(!this.orchestrator.check(handle))return;
        const result=await this.reservation.reserve();
        if(!this.orchestrator.check(handle))return;
        if(result.status==='held'){
          this.expected=structuredClone(result.order);this.clearSecret();
          this.orchestrator.transition('HOLD_VERIFIED','Provider seat hold verified.',
            {order:result.order,reservationVerified:true,holdExpiresAtMs:result.holdExpiresAtMs,
              holdObservedAtMs:result.holdObservedAtMs},{reservationVerified:true});
          if(!this.orchestrator.check(handle))return;
          this.orchestrator.transition('HANDOFF_PAYMENT',
            'Provider seat hold verified. Complete payment now in the same provider window. Automation will not resume.',
            {manualPayment:true,paymentMode:'user'});
        }else{
          this.clearSecret();
          this.orchestrator.transition('RESERVATION_UNCERTAIN',
            'Seat reservation is not verified. Check the same provider window. Automatic reservation retry is blocked.',
            {reservationVerified:false,reservationRecoveryRequired:true});
        }
        return;
      }
      if (page.stage === 'confirmation') {
        if (!this.submitted) {
          this.orchestrator.transition('NEED_USER', 'Completion could not be verified. Check the provider order history.');
          return;
        }
        if (!page.order || !this.expected ||
            !validOrder(page.order, this.preferences, this.expected,{eventKey:this.state.eventKey}) || !page.receipt) {
          this.orchestrator.fail(FAIL_PRE, 'Completion could not be verified. Check the provider order history. Automatic retry is disabled.');
          return;
        }
        // AB-05: only the synthetic rehearsal receipt can close a durable
        // journal attempt. AB-14 must implement official provider verification.
        if(this.payment?.kind==='gated-mock'&&!this.payment.verify({
          run:this.state,order:page.order,expected:this.expected,
          preferences:this.preferences,receipt:page.receipt,challenge:page.challenge
        }))throw new Error('Unverified mock receipt');
        if (this.ledger && this.paymentIntent) {
          if (!this.state.rehearsal) throw new Error('Official receipt reconciliation is not implemented.');
          this.ledger.confirmRehearsal(this.paymentIntent, page.receipt);
        }
        this.orchestrator.transition('VERIFIED_RECEIPT', 'Booking confirmed by the provider.',
          {receipt:page.receipt}, {verifiedReceipt:true});
        return;
      }
      if (this.submitted) {
        this.orchestrator.fail(FAIL_PRE, 'Payment was submitted once. Check the provider order history before trying again.');
        return;
      }
      if (page.stage === 'options') {
        if (this.selectionMade) {
          this.orchestrator.transition('NEED_USER', 'The booking page has not advanced. Check the selected options before resuming.');
          return;
        }
        this.orchestrator.transition('VALIDATE_ACTION', 'Validating preferred options.');
        if (!this.orchestrator.check(handle)) return;
        this.orchestrator.transition('ACTION_VALIDATED', 'Selecting performance and price.');
        if (!this.orchestrator.check(handle)) return;
        assertDeterministicHostAction({action:'SELECT_OPTIONS',runner:this,page});
        const chosen = await this.adapter.selectOptions(this.preferences, {signal:handle.signal});
        if (!this.orchestrator.check(handle)) return;
        if (!chosen) {
          this.orchestrator.transition('NEED_USER', 'No available option matches your preferences. No alternative was selected.');
          return;
        }
        this.selectionMade = true;
        this.orchestrator.transition('ACTION_RETURNED', 'Preferred performance and price selected. Waiting for the next step.');
        return;
      }
      if (page.stage === 'offers') {
        const offer = chooseOffer(page.offers || [], this.preferences,{eventKey:this.state.eventKey});
        if (!offer) {
          this.orchestrator.transition('NEED_USER', 'No seats satisfy the quantity, adjacency, preferences and budget including fees.');
          return;
        }
        this.orchestrator.transition('OFFER_CHOSEN', 'A matching seat offer was found.');
        if (!this.orchestrator.check(handle)) return;
        this.orchestrator.transition('VALIDATE_ACTION', 'Validating seat reservation.');
        if (!this.orchestrator.check(handle)) return;
        this.orchestrator.transition('ACTION_VALIDATED', 'Reserving preferred offer.');
        if (!this.orchestrator.check(handle)) return;
        assertDeterministicHostAction({action:'RESERVE_OFFER',runner:this,page,offer});
        await this.adapter.reserve(offer, {signal:handle.signal});
        if (!this.orchestrator.check(handle)) return;
        this.orchestrator.transition('ACTION_RETURNED', 'Selected seats. Checking the final order.');
        return;
      }
      if (page.stage === 'payment') {
        const order = page.order;
        if (!order || !validOrder(order, this.preferences, this.expected || order,{eventKey:this.state.eventKey})) {
          this.orchestrator.transition('NEED_USER', 'The final order does not satisfy your requirements, or its total including fees is unknown.');
          return;
        }
        if (!this.expected) this.expected = structuredClone(order);
        this.orchestrator.transition('REVIEW_ORDER', 'Checking the final order.', {order});
        if (!this.payment?.verified) {
          // Handoff is not evidence of held seats or a completed purchase.
          // Keep window ownership; never re-enter the adapter after takeover.
          this.clearSecret();
          this.orchestrator.transition('HANDOFF_PAYMENT',
            'Complete payment in the same provider window. Automation is paused permanently for this run. Seat hold and payment completion are not verified.',
            {paymentMode:'user',manualPayment:true,reservationVerified:false,order});
          return;
        }
        if (this.preferences.checkout === 'review' && !confirm) {
          this.orchestrator.transition('REVIEW_REQUIRED', 'Check the final order, then confirm payment.', {order});
          return;
        }
        // Re-read after human review and immediately before the irreversible
        // operation. The final read must match the same verified event/order.
        if (!this.orchestrator.check(handle)) return;
        const fresh = await this.adapter.read({signal:handle.signal});
        if (!this.orchestrator.check(handle)) return;
        if (this.onPageRead) this.onPageRead(fresh, this.state);
        if (fresh?.eventKey !== this.state.eventKey || fresh.challenge ||
            fresh.stage !== 'payment' || !validOrder(fresh.order, this.preferences, this.expected,{eventKey:this.state.eventKey})) {
          this.orchestrator.transition('NEED_USER', 'The payment page changed. Review the provider window.');
          return;
        }
        if (!this.secret) throw new Error('Payment preparation unavailable.');
        if (!this.orchestrator.check(handle)) return;
        // Unlock succeeds before the latch; errors before then remain precommit.
        // A payment can be attempted only by the verified host-owned payment
        // service. AB-05 will record durable commit intent *before* this call.
        await this.secret.use(async card => {
          if (!this.orchestrator.check(handle)) return;
          this.orchestrator.transition('COMMIT_READY', 'Final order was rechecked.');
          if (!this.orchestrator.check(handle)) return;
          let mockPrepared=null;
          if(this.payment?.kind==='gated-mock'){
            const approval=this.payment.approveReview({
              run:this.state,order:fresh.order,confirmed:confirm===true
            });
            mockPrepared=this.payment.prepare({
              run:this.state,order:fresh.order,expected:this.expected,
              preferences:this.preferences,permit:this.purchasePermit,approval
            });
          }
          if(!this.state.rehearsal){
            // Durable *server* claim precedes local fsync. A lost response,
            // expired lease, or ownership change permanently blocks retry.
            if(!this.sessionCoordinator)throw new Error('Shared purchase lease required.');
            if(!this.ledger||typeof this.ledger.recordClaimRequested!=='function')
              throw new Error('Durable purchase claim journal required.');
            this.paymentIntent=this.ledger.recordClaimRequested({
              runId:this.state.id,permit:this.purchasePermit,
              order:fresh.order,rehearsal:false
            });
            if(!this.orchestrator.check(handle))return;
            this.cloudClaimAttempted=true; // before network; response may be lost
            await this.sessionCoordinator.claimBeforeCommit(
              this.state.id,this.state.windowId,this.state.eventKey);
            if(!this.orchestrator.check(handle))return;
          }
          if (this.ledger) {
            // Synchronous, write-ahead, fsync-before-submit. A disk error
            // throws here, before any external payment side effect.
            this.paymentIntent = this.ledger.recordCommitIntent({
              runId:this.state.id,permit:this.purchasePermit,
              order:fresh.order,rehearsal:this.state.rehearsal,
            });
          } else if (!this.state.rehearsal) {
            // AB-13 must supply both a verified executor and this ledger.
            throw new Error('A durable journal is required before live payment.');
          }
          this.orchestrator.transition('COMMIT_STARTED', 'Submitting payment once.', {},
            {paymentProfileVerified:true});
          // Stop called synchronously by a UI notification after the durable
          // intent is persisted still prevents the actual provider submit.
          if (!this.orchestrator.check(handle)) return;
          if(this.payment?.kind==='gated-mock')
            return this.payment.submitOnce({
              run:this.state,order:fresh.order,intent:this.paymentIntent,prepared:mockPrepared
            });
          return this.payment.submit(card, this.expected);
        });
        if (!this.orchestrator.check(handle)) return;
        if (this.ledger && this.paymentIntent)
          this.ledger.submissionReturned(this.paymentIntent);
        if (!this.orchestrator.check(handle)) return;
        this.orchestrator.transition('SUBMIT_RETURNED', 'Waiting for provider confirmation.');
        this.orchestrator.transition('CONTINUE', 'Waiting for provider confirmation.');
        return;
      }
      this.orchestrator.transition('NEED_USER', 'This page needs your attention. Continue in the provider window, then resume.');
    } catch {
      if((this.cloudClaimAttempted||this.paymentIntent?.claimOnly) && !this.submitted &&
         !this.orchestrator.machine.terminal &&
         this.orchestrator.machine.phase==='READY_TO_COMMIT'){
        this.orchestrator.transition('CLOUD_CLAIM_UNKNOWN',
          'Purchase safety review is required. Payment submission is not established; automatic retry is disabled.',
          {claimOnly:true,safetyRecoveryRequired:true}, {claimAttempted:true});
      }
      if (this.paymentIntent && this.ledger) {
        try { this.ledger.markUnknown(this.paymentIntent); }
        catch { /* Unresolved COMMIT_INTENT_RECORDED always blocks replay. */ }
      }
      if (this.orchestrator.machine.terminal || this.cancelled) return;
      this.orchestrator.fail(FAIL_PRE, FAIL_POST);
    } finally {
      this.orchestrator.end(handle);
      if (this.orchestrator.machine.terminal) this.clearSecret();
    }
  }
}

module.exports = { BookingRunner, TERMINAL };
