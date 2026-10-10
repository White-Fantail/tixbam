# TIXBAM Autonomous Booking — Contracts & Security Invariants v1

Status: **Design only / no runtime implementation**
Normative: [AUTONOMOUS_BOOKING_DESIGN.md](AUTONOMOUS_BOOKING_DESIGN.md)
Work units: [AUTONOMOUS_BOOKING_RUNBOOK.md](AUTONOMOUS_BOOKING_RUNBOOK.md)

Use this document to prevent independent AB phases from inventing incompatible contracts. Examples are *illustrative interfaces*, not currently implemented code. The phase implementing each contract must add runtime validators + tests.

## A. Standard types (host-owned, no arbitrary execute)

~~~ts
export type ExecutionMode = 'assistant' | 'supervised' | 'conditional_auto';
export type ApprovalGate = 'restricted' | 'unverified' | 'permitted' | 'revoked';
export type VerifiedCapability =
  | 'OBSERVE' | 'SELECT_PERFORMANCE' | 'SELECT_PRICE_TIER'
  | 'LIST_OFFERS' | 'SELECT_OFFER' | 'READ_ORDER'
  | 'PREPARE_CHECKOUT' | 'VERIFY_ORDER'
  | 'PAYMENT_EXECUTOR'; // never directly callable by AI

export type ProviderPermission = {
  schemaVersion: 1;
  providerId: string;
  country: string; // specific jurisdiction, not "global" unless evidence covers it
  capability: VerifiedCapability;
  state: ApprovalGate;
  evidenceRef: string | null;   // verified by admin; sanitized for clients
  reviewedAt: string | null;
  expiresAt: string | null;
  revision: number;
  reviewerId: string | null;
};

export type ReviewedAddonCapabilities = {
  addonId: string;
  addonVersion: string;
  profileId: string;
  hostOwned: true;
  capabilities: Partial<Record<VerifiedCapability, 'verified' | 'pending' | 'disabled'>>;
  allowedHosts: string[];
  approvedOrigins: string[]; // for checked-out payment frame where applicable
};

export type UserPurchasePermit = {
  schemaVersion: 1;
  permitId: string;
  runId: string;
  accountId: string;
  planId: string;
  providerId: string;
  saleId: string;
  eventId: string;
  performanceId: string;
  providerEventId: string;
  addonVersion: string;
  capabilityRevision: number;
  mode: ExecutionMode;
  quantity: number;              // exact
  currency: string;              // ISO 4217
  maxAllInMinor: number;          // integer; includes all fees
  requireAdjacentAssignedSeats: boolean;
  approvedPriceTiers: readonly string[];
  approvedSections: readonly string[];
  approvedSeatModes: readonly ('assigned'|'standing'|'auto_allocated')[];
  permittedDeliveryMethods: readonly string[];
  allowRestrictedView: boolean;
  allowFallback: boolean;
  validFromMs: number;
  expiresAtMs: number;
  permittedActions: readonly VerifiedCapability[];
  consentNonce: string;          // local one-time approval; never model-supplied
  immutableDigest: string;       // canonical serialization + digest, host-computed
};
~~~

Constraints: seller ID must be actual ticket agent; one permit only for one exact event/session/sale. Empty allowlists mean *unrestricted only when explicitly modeled as optional preference*; never silently turn an empty required field into universal consent. Monetary minor units follow ISO currency rules (JPY/KRW 0 decimal, HKD 2, etc). When total/fees unknown, fail checkout.

## B. ObservationV1: cap, bind, redact

~~~ts
export type PageStage =
  | 'unknown' | 'landing' | 'queue' | 'login' | 'options'
  | 'offers' | 'cart' | 'checkout' | 'bank_challenge'
  | 'receipt' | 'access_blocked';

export type ObserveHandle = {
  ref: string;         // short opaque run-scoped handle; never selector/path
  kind: 'performance'|'price_tier'|'offer'|'delivery'|'navigation';
  label: string;       // sanitized, bounded, no PII
  available: boolean | null;
  priceMinor?: number; // integer, correct currency, trusted provenance
};

export type ObservationV1 = {
  schemaVersion: 1;
  snapshotId: string;
  runId: string;
  accountId: string;
  planId: string;
  windowId: number;
  providerId: string;
  providerEventId: string | null;
  pageGeneration: number;
  stage: PageStage;
  challenge: 'none'|'captcha'|'queue'|'login'|'3ds'|'consent'|'unknown';
  observedAtMs: number;
  expiresAtMs: number;          // short TTL; invalidate on navigation
  trustedSource: 'official_api'|'verified_adapter'|'observed_only'|'unknown';
  handles: readonly ObserveHandle[]; // cap count and strings in validator
  order?: SanitizedOrder;       // only when officially observed/verified
  confidence: 'verified'|'partial'|'unknown';
};
export type SanitizedOrder = {
  orderRefDigest: string;       // no full personal/order URL
  eventId: string;
  performanceId: string;
  ticketCount: number;
  ticketMode: 'assigned'|'standing'|'auto_allocated';
  seatRefs: readonly string[];  // bounded sanitized; not full names
  currency: string;
  allInTotalMinor: number | null;
  feesIncluded: boolean | null;
  merchantVerified: boolean;
};
~~~

The host-only ObservationV1 intentionally contains identifiers for binding but must NOT be forwarded verbatim to OpenRouter. Derive a separately validated AIObservationV1 payload that omits accountId, planId, windowId, runId, raw providerEventId, payment/receipt references, URLs, identity/attendee information and screenshots. Include only stage/challenge category, bounded sanitized handles (opaque task-scoped tokens), currency/budget constraints where needed and non-identifying outcome flags. AI target handles are task-scoped and must be resolved by the host to the original current ObservationV1 before any action. This mapping expires on navigation, permit revocation and user sign-out.

**AB-04 implementation (2026-10-10):** `ObservationPipeline` is host-only and currently observes Cityline's bounded, officially scoped eventDetail selectors plus synthetic rehearsal pages. `HostObservationV1` retains identity bindings locally; the AI projection drops all raw labels/HTML/URLs/IDs and sends only stage/challenge/option counts/confidence and task-scoped random tokens. Observation expiration, page/navigation generation changes, renewed reads, sign-out and account changes invalidate host action handles and AI token mappings. Login/queue/CAPTCHA/3DS are classified as manual challenges, never automated. No screenshot capture, live external AI transmission, or general site add-on execution is introduced. Currency/price comparisons remain entirely in host code pending separately approved AI task data-sharing contracts.

Input policy: remote HTML text including prompts is untrusted. Prevent DOM injection into host, validate URLs and plan binding outside and inside any restricted executeJavaScript inspection. No extension of remote preload IPC. Payment/identity/cookie fields should be filtered at the host before any remote AI call. No screenshots initially; any future image endpoint needs explicit consent, redaction QA and vendor permission.

## C. ProposalV1 and validator

~~~ts
export type ProposedActionKind =
  | 'WAIT' | 'REOBSERVE' | 'ASK_USER' | 'STOP'
  | 'SELECT_PERFORMANCE' | 'SELECT_PRICE_TIER'
  | 'SELECT_APPROVED_OFFER' | 'CHOOSE_VERIFIED_DELIVERY'
  | 'RETURN_TO_VERIFIED_STEP';

export type ProposalV1 = {
  schemaVersion: 1;
  requestId: string;
  runId: string;
  snapshotId: string;
  expectedPageGeneration: number;
  expectedStage: PageStage;
  action: ProposedActionKind;
  targetRef: string | null;   // handle issued by ObservationV1
  rationaleCode: string;
  expiresAtMs: number;
};

export type ActionDecision = {
  allowed: boolean;
  code:
    | 'ALLOW' | 'POLICY_DENY' | 'CAPABILITY_MISSING'
    | 'CONSENT_MISSING' | 'WRONG_OWNER' | 'STALE_OBSERVATION'
    | 'PLAN_MISMATCH' | 'UNKNOWN_PRICE' | 'CHALLENGE_REQUIRED'
    | 'LIMIT_EXCEEDED' | 'UNKNOWN_ACTION';
  checkedAtMs: number;
};
~~~

Immutable input: ProposalV1 cannot hold arbitrary JS, CSS selector, URL, screenshot, payment data, retry count or cost override. All action implementations are host-side static registry functions. Restrict targetRef to a currently visible, enabled handle from matching run/window/snapshot. Validator reruns immediately before mutation. If a provider permission changes mid-run, deny. If AI suggests STOP or ASK_USER, these are **recommendations**, while a signed-in user stop/cancel command can independently apply.

Validator decision must not depend on AI textual confidence or rationale. Explicit receipt and purchase evidence validated independently.

**AB-03 implemented contract (2026-10-10):** Host-only `ActionValidator.issueSnapshot` creates process-local opaque handles, scoped to run/window/account/plan/provider/event, page generation, policy revision, and a short TTL. `strictProposal` rejects fields not in the exact schema, getter/prototype pollution, executable instructions, URLs and payment actions. Any approved rehearsal mutation consumes the snapshot/request before side effects; the host verifies a fresh matching offer and checks the postcondition. Live AI mutation execution is not enabled; actual observation/AI planning/recovery remain AB-04/AB-08/AB-09.


## D. Durable journal and payment boundary

~~~ts
export type JournalEvent =
  | {type:'RUN_CREATED'; seq:number; runId:string; permitDigest:string; atMs:number}
  | {type:'OFFER_LOCKED'; seq:number; runId:string; orderDigest:string; atMs:number}
  | {type:'COMMIT_INTENT_RECORDED'; seq:number; runId:string; attemptId:string;
      permitDigest:string; orderDigest:string; atMs:number}
  | {type:'PAYMENT_SUBMISSION_RETURNED'; seq:number; runId:string; attemptId:string; atMs:number}
  | {type:'PAYMENT_UNKNOWN'; seq:number; runId:string; attemptId:string; atMs:number}
  | {type:'PURCHASE_CONFIRMED'; seq:number; runId:string; attemptId:string;
      verifiedReceiptDigest:string; atMs:number}
  | {type:'RUN_STOPPED'; seq:number; runId:string; atMs:number};

export type PaymentCommitIntent = {
  runId: string; attemptId: string; permitDigest: string; orderDigest: string;
  providerId: string; saleId: string; performanceId: string;
  journalSequence: number; persistedAtMs: number;
};
~~~

**Write-ahead invariant:** no external payment side effect without a durable COMMIT_INTENT_RECORDED fsync completed successfully. Persistence error = no submit. A resumed process finding that record and no verified confirmation treats attempt as UNKNOWN (even if submit might not have happened). Payment service is **host-only**. Do not expose to AI/renderer/provider addon.

~~~ts
export interface VerifiedPaymentExecutor {
  // Factory is only possible after vendor permission, reviewed implementation
  // and compliant payment method checks; not created by toggling Admin UI.
  prepare(permit: UserPurchasePermit, order: SanitizedOrder):
    Promise<{ready: boolean; requiresHumanAction: boolean; reason?: string}>;
  submitOnce(input: PaymentCommitIntent):
    Promise<{submitted: boolean; providerSubmissionRefDigest?: string}>;
  verify(input: PaymentCommitIntent):
    Promise<'CONFIRMED'|'VERIFIED_NO_CHARGE'|'UNKNOWN'>;
}
~~~


**AB-05 implemented journal boundary (2026-10-10):** Host local `DurableBookingJournal` stores versioned, append-only JSONL entries in a 0700 directory and 0600 files (on POSIX), with a SHA-256 integrity chain, sequence and durable fsync of the file/directory. The persistent key permits HMAC digests of normalized purchase scope/permit/order without writing raw account, event, URL, seat, CVV or card numbers to disk. `PaymentAttemptLedger.recordCommitIntent` records RUN_CREATED, OFFER_LOCKED and COMMIT_INTENT_RECORDED in a single exclusive transaction, fsynced before any provider payment effect. A separate attempt under the same account/provider/sale/event/performance scope is refused even after a different plan or quantity, and even if the earlier attempt was confirmed. Submission return does not mean payment was successful. Unresolved attempts are shown as payment_unknown on restart; no automatic retries.

Failure modes are intentionally fail-closed: invalid schema/sequence/hash, torn tail, disk-full, fsync error, permissions/symlinks, orphaned local exclusive lock and missing HMAC key/journal block payment submissions. A stale lock is **not automatically reclaimed**; reconcile the merchant state, inspect the data and involve a human operator. Currently only a synthetic rehearsal receipt can close a journal attempt; official vendor receipt verification belongs to AB-14. There is no real live payment executor in AB-05, and desktop-only storage cannot prevent charges made manually on websites or from another device (AB-06 coordinates multiple devices).

The payment implementation must not infer card details from the model. Favor official token, wallet or hosted checkout. Existing CardVault/RunSecret and PCI scope require separate security review before a live implementation. Client side JavaScript memory clearing is not secure deletion.

## E. State transitions and invariants

~~~text
CREATED -> WAITING_FOR_SESSION -> OBSERVING
OBSERVING -> DECIDING -> VALIDATING_ACTION -> EXECUTING_ACTION -> OBSERVING
OBSERVING -> WAITING_FOR_USER -> OBSERVING
OBSERVING -> OFFER_SELECTED -> ORDER_REVIEW
ORDER_REVIEW -> WAITING_FOR_USER | READY_TO_COMMIT
READY_TO_COMMIT -> PAYMENT_COMMITTING (journal commit intent first)
PAYMENT_COMMITTING -> VERIFYING -> CONFIRMED | PAYMENT_UNKNOWN
Any pre-commit step -> STOPPED | FAILED
Any interrupted/post-commit step -> PAYMENT_UNKNOWN
~~~

Rules:
- A payment commit intent is irreversible for the purpose of automatic retry; if unknown, require reconciliation.
- Only CONFIRMED from a verified official order with exact seller/event/session/seat/quantity/price fingerprint.
- STOPPED after submitted payment cannot imply no charge.
- Re-running the model for another proposal does not reset action attempt counters, permits, or journal.
- Manual completion of CAPTCHA/queue/3DS is separate user action; AI must not solve/bypass it.
- Failure to prove who owns the window, which event is displayed, or whether policy permits the operation => manual mode.

**AB-07 implemented (2026-10-10):** A host-controlled, provider-neutral mock adapter runs the existing AB-02 BookingRunner/FSM and AB-03 deterministic action preconditions against bounded, seeded synthetic inventory. The independent rehearsal-only AB-05 journal records a synthetic commit before a mock one-shot payment; timeouts/crashes remain `payment_unknown` across process restart. A deliberately minimal `tixbamRehearsal` IPC exposes only scenario selection, step, manual handoff, mock order confirmation, Stop and simulated restart to the isolated rehearsal window. Scenarios are a hardcoded allowlist, not downloaded provider code. No network requests, real cards or real payment execution are performed, and no official receipt verification is claimed.

## F. Test matrix / no-release conditions

| Invariant | Synthetic regression |
|---|---|
| Zero unauthorized actions | denied provider / wrong country / expired policy / downgraded adapter |
| Zero cross-event actions | event/plan/window switched while AI waits |
| Zero stale actions | snapshot replaced, navigation generation changed |
| Zero unknown-price checkout | missing all-in total/fees or FX mismatch |
| Zero silent extra items | checkout adds insurance/subscription/delivery fee |
| At-most-one submit attempt | double-click, two windows, two processes, submit timeout |
| No crash duplicate payment | kill/restart before and after COMMIT_INTENT_RECORDED |
| No AI secret leak | hidden field, PAN/CVV, cookie, OTP, email, prompt injection |
| Safe challenge | CAPTCHA, login, queue, access block, 3DS require user |
| Safe model outage | timeout/malformed response/revoked model: no mutation |
| Hard stop semantics | stop/cancel while action executing and after commit |
| Truthful success | forged receipt, stale HTML, missing official confirmation rejected |

Property-based tests may generate near-boundary quantities, currencies and repeated transitions. Include deterministic fixtures and mock payment; do not use an actual ticket purchase to satisfy CI.

## G. API and DB — AB-06 leases

**AB-06 implemented (2026-10-10):** Authenticated lease endpoints enforce a unique user/provider/sale/performance scope, registered ownership and monotonic fencing token. Renew/release/claim use SQL compare-and-swap. Only unclaimed expired leases can be acquired again. A server payment claim is irreversible and must be acknowledged before the local AB-05 fsync record; an ambiguous claim is not retried. Electron SessionCoordinator owns the browser window and lease token. Offline rehearsal remains local. No live AI payment capability or vendor authorization is granted by lease issuance.



API added through FastAPI routers, preserving existing /v1/admin/ai/tasks and /v1/ai/advice:
- GET /v1/automation/capabilities (minimal UI metadata; user identity when personalized)
- POST /v1/ai/plans (user auth, non-secret ProposalV1; model never directly calls tools)
- GET/PUT /v1/admin/automation/providers/{id}/policies (admin only, reviewer & evidence required)
- POST /v1/admin/automation/kill-switch (admin only, transaction audit)
- optional POST /v1/me/automation/leases and release/renew; not a replacement for local journal/provider idempotency.

Schema migrations proposed:
- provider_automation_policies (provider_id, country, capability, state, evidence, reviewed_at, expires_at, revision, reviewer, effective_status).
- provider_automation_audit (actor, policy_revision, diff, timestamp; no secrets).
- ai_model_policies continues as-is, new supported task keys with validation & capability checks.
- optional purchase_intent_leases with user_id/plan_id/scoped fingerprint/fencing token/expires_at and hashed non-secret owner device ID.
- **never** central cloud storage for merchant browser sessions, CVV, local payment journal or cards.

Migrations must be idempotent for both SQLite tests and existing PostgreSQL production, and never flip unverified providers to active. Live vendor policy evidence must be supplied and verified, never invented.

## H. Consistency with current TIXBAM code

- Retain BookingPreferences and chooseOffer/validOrder behavior; migrate carefully to support new terms without weakening existing hard requirements.
- Retain user login and current secret isolation in Electron main. Renderer cannot directly address /v1/admin or OpenRouter with admin/user secrets.
- Retain separate rehearsal window and no real purchase there.
- Provider manifests currently describe automation level and booking schema; do not claim current Cityline payment implemented.
- New contracts should be versioned and exported from packages/addon-sdk/index.d.ts with precise runtime parsers (plain TypeScript types are insufficient for untrusted input).
- Existing admin route security and the support for Korean default/English UI must remain functional.
