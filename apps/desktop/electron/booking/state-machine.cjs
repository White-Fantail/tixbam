'use strict';

/** AB-02 host-owned, provider-neutral transition table.
 * Never accept phases or terminal success directly from an add-on/AI.
 * Post-commit crashes remain unknown until AB-05 adds a durable journal.
 */
const PHASES = Object.freeze([
  'CREATED','WAITING_FOR_SESSION','OBSERVING','DECIDING',
  'VALIDATING_ACTION','EXECUTING_ACTION','OFFER_SELECTED','ORDER_REVIEW',
  'READY_TO_COMMIT','PAYMENT_COMMITTING','VERIFYING','WAITING_FOR_USER',
  'MANUAL_PAYMENT','CONFIRMED','PAYMENT_UNKNOWN','STOPPED','FAILED',
]);
const TERMINAL_PHASES = new Set(['CONFIRMED','PAYMENT_UNKNOWN','STOPPED','FAILED']);

const NEXT = Object.freeze({
  CREATED: { START:'WAITING_FOR_SESSION' },
  WAITING_FOR_SESSION: { SESSION_READY:'OBSERVING', NEED_USER:'WAITING_FOR_USER' },
  OBSERVING: { OBSERVED:'DECIDING', NEED_USER:'WAITING_FOR_USER' },
  DECIDING: {
    VALIDATE_ACTION:'VALIDATING_ACTION', OFFER_CHOSEN:'OFFER_SELECTED',
    REVIEW_ORDER:'ORDER_REVIEW', NEED_USER:'WAITING_FOR_USER',
    VERIFIED_RECEIPT:'CONFIRMED',
  },
  VALIDATING_ACTION: { ACTION_VALIDATED:'EXECUTING_ACTION', NEED_USER:'WAITING_FOR_USER' },
  EXECUTING_ACTION: { ACTION_RETURNED:'OBSERVING', NEED_USER:'WAITING_FOR_USER' },
  OFFER_SELECTED: { VALIDATE_ACTION:'VALIDATING_ACTION', CONTINUE:'OBSERVING', NEED_USER:'WAITING_FOR_USER' },
  ORDER_REVIEW: { USER_CONFIRMED:'OBSERVING', REVIEW_REQUIRED:'ORDER_REVIEW', COMMIT_READY:'READY_TO_COMMIT', NEED_USER:'WAITING_FOR_USER', HANDOFF_PAYMENT:'MANUAL_PAYMENT' },
  MANUAL_PAYMENT: {}, // Never resume automation after user takeover.
  READY_TO_COMMIT: { COMMIT_STARTED:'PAYMENT_COMMITTING', NEED_USER:'WAITING_FOR_USER' },
  PAYMENT_COMMITTING: { SUBMIT_RETURNED:'VERIFYING' },
  VERIFYING: { CONTINUE:'OBSERVING', NEED_USER:'WAITING_FOR_USER', VERIFIED_RECEIPT:'CONFIRMED' },
  WAITING_FOR_USER: { USER_RESUMED:'OBSERVING' },
  CONFIRMED: {}, PAYMENT_UNKNOWN: {}, STOPPED: {}, FAILED: {},
});

const PUBLIC_STATUS = Object.freeze({
  CREATED:'running',WAITING_FOR_SESSION:'running',OBSERVING:'running',
  DECIDING:'running',VALIDATING_ACTION:'running',EXECUTING_ACTION:'running',
  OFFER_SELECTED:'running',ORDER_REVIEW:'review',READY_TO_COMMIT:'running',
  PAYMENT_COMMITTING:'submitting',VERIFYING:'running',
  WAITING_FOR_USER:'awaiting_user',MANUAL_PAYMENT:'awaiting_user',CONFIRMED:'completed',
  PAYMENT_UNKNOWN:'payment_unknown',STOPPED:'stopped',FAILED:'failed',
});

class InvalidTransition extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidTransition';
  }
}

class BookingStateMachine {
  constructor(runId) {
    if (typeof runId !== 'string' || !runId) throw new TypeError('Run ID required');
    this.runId = runId;
    this.phase = 'CREATED';
    this.revision = 0;
    this.commitStarted = false;
  }
  get terminal() { return TERMINAL_PHASES.has(this.phase); }
  get publicStatus() { return PUBLIC_STATUS[this.phase]; }

  /**
   * Single-writer event transition; expectedRevision is mandatory.
   * Verified receipt evidence must come from the trusted host's order checker,
   * not from an AI proposal. This is an in-memory gate, not a payment journal.
   */
  transition(runId, expectedRevision, event, evidence = {}) {
    if (runId !== this.runId) throw new InvalidTransition('Run identity mismatch');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== this.revision)
      throw new InvalidTransition('Stale run revision');
    if (this.terminal) throw new InvalidTransition('Terminal run cannot be resumed');
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
      throw new InvalidTransition('Invalid transition evidence');
    let next;
    if (event === 'CLOUD_CLAIM_UNKNOWN') {
      if (this.phase !== 'READY_TO_COMMIT' || evidence.claimAttempted !== true)
        throw new InvalidTransition('Cloud claim uncertainty requires an attempted commit claim');
      next = 'PAYMENT_UNKNOWN';
    }
    else if (event === 'STOP') next = this.commitStarted ? 'PAYMENT_UNKNOWN' : 'STOPPED';
    else if (event === 'FAIL') next = this.commitStarted ? 'PAYMENT_UNKNOWN' : 'FAILED';
    else if (event === 'UNKNOWN_PAYMENT') {
      if (!this.commitStarted) throw new InvalidTransition('No attempted payment to reconcile');
      next = 'PAYMENT_UNKNOWN';
    } else next = NEXT[this.phase]?.[event];
    if (!next || !PHASES.includes(next)) throw new InvalidTransition('Forbidden booking state transition');
    if (event === 'VERIFIED_RECEIPT' && (!this.commitStarted || evidence.verifiedReceipt !== true))
      throw new InvalidTransition('Provider receipt verification required');
    if (event === 'COMMIT_STARTED') {
      if (this.commitStarted || evidence.paymentProfileVerified !== true)
        throw new InvalidTransition('Verified payment preparation required');
      this.commitStarted = true; // latch BEFORE any external submit can be made
    }
    this.phase = next;
    this.revision += 1;
    return Object.freeze({
      runId: this.runId, phase: this.phase, revision: this.revision,
      status: PUBLIC_STATUS[this.phase], commitStarted: this.commitStarted,
    });
  }

  /** Untrusted recovery snapshots must never authorize a new submit.
   * AB-05 will replace this with a journal-backed recovery decision. */
  static recoveryPhase(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
      return 'FAILED';
    if (snapshot.commitStarted === true ||
        ['PAYMENT_COMMITTING','VERIFYING','CONFIRMED','PAYMENT_UNKNOWN'].includes(snapshot.phase) ||
        ['submitting','payment_unknown'].includes(snapshot.status)) return 'PAYMENT_UNKNOWN';
    // Even a purported "completed" external snapshot is not proof of payment.
    return 'STOPPED';
  }
}

module.exports = { PHASES, TERMINAL_PHASES, PUBLIC_STATUS, BookingStateMachine, InvalidTransition };
