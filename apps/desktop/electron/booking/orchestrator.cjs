'use strict';

const { BookingStateMachine, InvalidTransition } = require('./state-machine.cjs');

/**
 * Serializes host-observed steps for any provider adapter. The UI-facing
 * legacy status is derived exclusively from the state machine.
 *
 * This is an in-process coordinator. It cannot persist payment attempts across
 * restarts (AB-05), nor authorize live vendor operations (AB-01/AB-12).
 */
class BookingOrchestrator {
  constructor({ runId, eventKey, windowId, rehearsal, notify, assertWindow = null }) {
    this.machine = new BookingStateMachine(runId);
    this.state = {
      id: runId, windowId, eventKey, rehearsal,
      status: 'running', phase: 'CREATED', revision: 0, generation: 0,
      message: 'Reading booking page…', startedAt: Date.now(),
    };
    this.notify = notify;
    this.assertWindow = assertWindow;
    this.generation = 0;
    this.current = null;
    this.cancelled = false;
    this.transition('START', 'Preparing session.');
    this.transition('SESSION_READY', 'Reading booking page…');
  }

  transition(event, message, patch = {}, evidence = {}) {
    const next = this.machine.transition(this.state.id, this.machine.revision, event, evidence);
    // Metadata is internal allowlisted presentation data, not executable state.
    // Do not permit a patch to override source-of-truth fields.
    const {status, phase, revision, generation, id, eventKey, windowId, rehearsal,
           startedAt, ...metadata} = patch;
    this.state = {
      ...this.state, ...metadata,
      status: next.status, phase: next.phase, revision: next.revision,
      generation: this.generation, message,
    };
    this.notify?.(structuredClone(this.state));
    return this.state;
  }

  setMetadata(patch) {
    const {status, phase, revision, generation, id, eventKey, windowId, rehearsal,
           startedAt, ...metadata} = patch;
    this.state = {...this.state, ...metadata};
  }

  assertOwner() {
    if (this.assertWindow) this.assertWindow();
  }

  /** Start one async step, or safely ignore a concurrent timer tick.
   * The returned handle remains valid across internal phase revisions, but
   * never across cancellation, window changes or a newer step.
   */
  begin({confirm = false} = {}) {
    if (this.current || this.cancelled || this.machine.terminal) return null;
    if (this.machine.phase === 'ORDER_REVIEW' && !confirm) return null;
    this.assertOwner();
    if (this.machine.phase === 'ORDER_REVIEW') this.transition('USER_CONFIRMED', 'Rechecking the final order.');
    if (this.machine.phase === 'WAITING_FOR_USER') this.transition('USER_RESUMED', 'Resuming…');
    // Synchronous notifications can invoke Stop while resuming. Never start
    // another adapter operation after a terminal interrupt.
    if (this.cancelled || this.machine.terminal) return null;
    if (this.machine.phase !== 'OBSERVING') throw new InvalidTransition('Run is not ready to observe');
    const controller = new AbortController();
    const handle = Object.freeze({
      generation: ++this.generation, windowId: this.state.windowId,
      runId: this.state.id, signal: controller.signal,
    });
    this.current = {handle, controller};
    this.state = {...this.state, generation: this.generation};
    return handle;
  }

  valid(handle) {
    return !!handle && !!this.current &&
      this.current.handle === handle && handle.generation === this.generation &&
      handle.runId === this.state.id && handle.windowId === this.state.windowId &&
      !handle.signal.aborted && !this.cancelled && !this.machine.terminal;
  }

  check(handle) {
    if (!this.valid(handle)) return false;
    this.assertOwner();
    return this.valid(handle);
  }

  end(handle) {
    if (this.current?.handle === handle) this.current = null;
  }

  interrupt(messageBefore, messageAfter) {
    if (this.machine.terminal) return this.state;
    this.cancelled = true;
    this.generation += 1;
    this.current?.controller.abort();
    const paid = this.machine.commitStarted;
    return this.transition('STOP', paid ? messageAfter : messageBefore);
  }

  fail(before, after) {
    if (this.machine.terminal) return this.state;
    return this.transition('FAIL', this.machine.commitStarted ? after : before);
  }
}
module.exports = { BookingOrchestrator };
