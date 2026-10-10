/**
 * TIXBAM add-on manifest contract.
 * v0.2: for discovery and compatibility only; remotely supplied code is NOT executed.
 * Future executable packaging requires signature verification and reviewed host permissions.
 */
export type AutomationStatus = "available" | "restricted" | "unverified" | "delegated";
export type AutomationLevel = {
  status: AutomationStatus;
  summary: string;
  sourceUrl?: string;
};
export type AddonManifest = {
  id: string;
  name: string;
  kind: "ticketing" | "event-presale";
  version: string;
  url: string;
  allowedHosts: string[];
  sites?: Array<{ label: string; url: string }>;
  booking?: BookingSchema;
  capabilities: Array<"browser" | "persistent-session" | string>;
  automation: {
    reviewedAt: string;
    level1: AutomationLevel;
    level2: AutomationLevel;
    level3: AutomationLevel;
  };
};
export type PublishedAddon = AddonManifest & {
  published: boolean;
  artifactUrl?: string | null;
  artifactSha256?: string | null;
};

/** Host-owned booking contract. Add-ons describe options, never receive card secrets. */
export interface BookingChoice { id: string; label: string; available?: boolean }
export interface BookingField {
  id: string; label: string; type: 'select' | 'ranked'; required: boolean;
  choices?: BookingChoice[]; hint?: string;
}
export interface BookingSchema {
  schemaVersion: 1; currency: string; maxTickets: number; adapter: string;
  implementation: { options: 'verified' | 'pending'; seats: 'verified' | 'pending'; payment: 'verified' | 'pending' };
  fields: BookingField[];
}
export interface BookingPreferences {
  schemaVersion: 1; quantity: number; maxTotalMinor: number; currency: string;
  requireTogether: boolean; allowFallback: boolean; checkout: 'review' | 'automatic';
  options: Record<string, string | string[]>;
  /** Explicit opt-in. Omitted permissions mean no consent. */
  terms?: SeatRestrictionConsentV2;
}
export interface BookingOrder {
  id: string; eventKey: string; quantity: number; totalMinor: number; currency: string;
  feesIncluded: boolean; adjacent?: boolean; seats: string[];
  performance: string; priceTier: string; section?: string; floor?: string; seatMode?: string; fulfillment?: string;
  /** Verified seller evidence, when supplied by strict AB-10 V2 offer. */
  feeBreakdown?:VerifiedFeeBreakdownV2;
  restrictedView?:boolean;realNameRequired?:boolean;
  ageRestricted?:boolean;accessibilityRestricted?:boolean;
  extras?:SelectedOptionalExtraV2[];
}
export interface BookingContext {
  contextId: string; eventKey: string; schema: BookingSchema;
  preferences: BookingPreferences | null; rehearsal: boolean; providerEventId?: string; providerTitle?: string;
}
export interface BookingRun {
  id: string; eventKey: string; windowId?: number;
  status: 'running' | 'awaiting_user' | 'review' | 'submitting' | 'completed' | 'stopped' | 'failed' | 'payment_unknown';
  message: string; rehearsal: boolean; startedAt: number; order?: BookingOrder; receipt?: string;
  /** AB-02 informational host-owned phase; clients cannot set it. */
  phase?: BookingPhase; revision?: number; generation?: number;
  /** AB-05: read-only, recovered durable payment safety history; cannot resume or pay. */
  storageRecovered?: boolean; attemptId?: string;
  providerId?: string; aiPageStage?: string;
  aiContext?: Pick<AIAdvisoryContext, 'quantity' | 'currency' | 'budget_minor' | 'require_together' | 'allow_fallback'>;
}
export interface CardSummary { id: string; label: string; last4: string; expiryMonth: number; expiryYear: number }
export interface CardInput { label: string; name: string; number: string; expiryMonth: number; expiryYear: number }

/** Host-level AI advisory interface; shared by every ticketing provider add-on.
 * Add-ons provide coarse, non-sensitive state only; never executable instructions.
 * Model selection and OpenRouter credentials remain on the server. */
export type AIAdvisoryTask = "rehearsal_guidance" | "page_recovery" | "seat_review";
export interface AIAdvisoryContext {
  stage: string; issue?: string; quantity: number; currency: string;
  budget_minor: number; total_minor?: number | null; require_together: boolean;
  allow_fallback: boolean; locale?: "ko" | "en";
  signals?: Record<string, string | number | boolean>;
}
export interface AIAdvisoryRequest { task: AIAdvisoryTask; provider_id: string; context: AIAdvisoryContext }
export interface AIAdvisoryResponse {
  task: AIAdvisoryTask; providerId: string; model: string; summary: string; tips: string[];
  risk: "info" | "caution" | "block";
  nextStep: "continue" | "review" | "wait" | "ask_user" | "stop";
  advisoryOnly: true;
}


/** AB-01: types only. The server's evidence registry cannot execute actions.
 * The Electron main process must independently validate a bundled/reviewed
 * implementation, current user consent, and a separately approved release.
 */
export type AutomationPermissionState = 'restricted' | 'unverified' | 'permitted' | 'revoked';
export type AutomationMode = 'assistant' | 'supervised' | 'conditional_auto';
export type AutomationCapability =
  | 'OBSERVE' | 'SELECT_PERFORMANCE' | 'SELECT_PRICE_TIER' | 'LIST_OFFERS'
  | 'SELECT_OFFER' | 'READ_ORDER' | 'PREPARE_CHECKOUT'
  | 'VERIFY_ORDER' | 'PAYMENT_EXECUTOR';
export type AutomationImplementationState = 'verified' | 'pending' | 'disabled';
export interface LocalReviewedCapabilityManifest {
  providerId: string; addonVersion: string; profileId: string;
  hostOwned: true; capabilities: Partial<Record<AutomationCapability, AutomationImplementationState>>;
}
export interface AutomationPolicyStatus {
  capability: AutomationCapability; country: string;
  permissionState: AutomationPermissionState; reason: string;
  revision: number; permitted: boolean;
}
export interface ProviderAutomationStatus {
  providerId: string; name: string; country: string;
  registeredCountry: string; published: boolean;
  ticketAgentRequired: boolean;
  mode: 'assistant'; autonomousCheckoutAvailable: false;
  localVerificationRequired: true;
  policies: AutomationPolicyStatus[];
}
export interface AutomationCapabilityResponse {
  schemaVersion: 1; globalKillSwitch: boolean; autonomousExecutionAvailable: false;
  items: ProviderAutomationStatus[];
}


/** AB-02 state machine exposes a phase for progress, while status preserves
 * the backwards-compatible renderer contract. Terminal phases cannot resume. */
export type BookingPhase =
  | 'CREATED' | 'WAITING_FOR_SESSION' | 'OBSERVING' | 'DECIDING'
  | 'VALIDATING_ACTION' | 'EXECUTING_ACTION' | 'OFFER_SELECTED'
  | 'ORDER_REVIEW' | 'READY_TO_COMMIT' | 'PAYMENT_COMMITTING'
  | 'VERIFYING' | 'WAITING_FOR_USER' | 'CONFIRMED'
  | 'PAYMENT_UNKNOWN' | 'STOPPED' | 'FAILED';


/** AB-03: proposals are data only. No payment, CSS selectors, XPath,
 * coordinates, URLs, JavaScript, or renderer-invocable execution methods.
 * The Electron host issues opaque snapshot/target IDs and revalidates all
 * authority and constraints immediately before a reviewed action.
 */
export type ProposedActionKind =
  | 'WAIT' | 'REOBSERVE' | 'ASK_USER' | 'STOP'
  | 'SELECT_PERFORMANCE' | 'SELECT_PRICE_TIER'
  | 'SELECT_APPROVED_OFFER' | 'CHOOSE_VERIFIED_DELIVERY'
  | 'RETURN_TO_VERIFIED_STEP';
export type ProposedPageStage =
  | 'unknown' | 'landing' | 'queue' | 'login' | 'options' | 'offers'
  | 'cart' | 'checkout' | 'bank_challenge' | 'receipt' | 'access_blocked';
export interface ActionProposalV1 {
  schemaVersion: 1;
  requestId: string; runId: string; snapshotId: string;
  expectedPageGeneration: number; expectedStage: ProposedPageStage;
  action: ProposedActionKind; targetRef: string | null;
  rationaleCode: string; expiresAtMs: number;
}
export type ActionDecisionCode =
  | 'ALLOW' | 'UNKNOWN_ACTION' | 'STALE_OBSERVATION' | 'WRONG_OWNER'
  | 'POLICY_DENY' | 'CAPABILITY_MISSING' | 'CONSENT_MISSING'
  | 'CHALLENGE_REQUIRED' | 'PLAN_MISMATCH' | 'UNKNOWN_PRICE'
  | 'LIMIT_EXCEEDED';
export interface ActionDecision {
  allowed: boolean; code: ActionDecisionCode; checkedAtMs: number;
}
export interface IssuedActionSnapshotV1 {
  schemaVersion: 1; snapshotId: string; pageGeneration: number;
  stage: ProposedPageStage;
  challenge: 'none' | 'captcha' | 'queue' | 'login' | '3ds' | 'consent' | 'unknown';
  observedAtMs: number; expiresAtMs: number;
  handles: ReadonlyArray<{ref:string;kind:'performance'|'price_tier'|'offer'|'delivery'|'navigation'}>;
}


/** AB-04 observational types; these interfaces are host-private and
 * MUST NOT be sent to OpenRouter verbatim or exposed by renderer IPC.
 * Page labels / DOM / hidden fields / screenshots never enter AIObservationV1.
 */
export type ObservationChallenge =
  | 'none' | 'captcha' | 'queue' | 'login' | '3ds' | 'consent' | 'unknown';
export type ObservationTargetKind =
  | 'performance' | 'price_tier' | 'offer' | 'delivery' | 'navigation';
export interface HostObservationV1 {
  schemaVersion: 1;
  snapshotId: string; runId: string; accountId: string; planId: string;
  windowId: number; providerId: string; providerEventId: string | null;
  pageGeneration: number;
  stage: ProposedPageStage; challenge: ObservationChallenge;
  observedAtMs: number; expiresAtMs: number;
  trustedSource: 'verified_adapter' | 'official_api' | 'observed_only' | 'unknown';
  confidence: 'verified' | 'partial' | 'unknown';
  handles: ReadonlyArray<{ ref:string;kind:ObservationTargetKind;label:string;available:boolean }>;
  orderSummary: null | {
    ticketCount: number | null; currency: string | null;
    allInTotalMinor: number | null; feesIncluded: boolean; merchantVerified: false;
  };
}
export interface AIObservationV1 {
  schemaVersion:1;
  stage:ProposedPageStage;
  challenge:ObservationChallenge;
  confidence:'verified' | 'partial' | 'unknown';
  optionCounts:Readonly<Record<ObservationTargetKind,number>>;
  /** Task-local opaque token, not an ActionValidator ref, DOM ID or booking identity. */
  targets:ReadonlyArray<{token:string;kind:ObservationTargetKind}>;
}


/** AB-05 — host-local, append-only journal contract. No full account,
 * card, CVV, OTP, ticket URL or raw order fields are persisted.
 */
export type BookingJournalEventKind =
  | 'RUN_CREATED' | 'OFFER_LOCKED' | 'COMMIT_INTENT_RECORDED'
  | 'PAYMENT_SUBMISSION_RETURNED' | 'PAYMENT_UNKNOWN'
  | 'PURCHASE_CONFIRMED' | 'RUN_STOPPED';
export interface PaymentCommitIntentV1 {
  runId:string;attemptId:string;scopeDigest:string;
  permitDigest:string;orderDigest:string;
  journalSequence:number;persistedAtMs:number;rehearsal:boolean;
}
/** This is never a renderer callable payment command. */
export interface RecoveredPurchaseAttemptV1 {
  id:string;attemptId:string;status:'payment_unknown';
  phase:'PAYMENT_UNKNOWN';revision:0;generation:0;
  eventKey:'unverified';rehearsal:boolean;
  message:string;startedAt:number;storageRecovered:true;
}


/** AB-06: browser-private cloud coordination status, not payment permission. */
export interface BookingLeaseStatusV1 {
  leaseId:string;providerId:string;saleId:string;performanceId:string;
  fencingToken:number;status:'leased'|'claimed';expiresAt:string;
  claimedAt:string|null;autonomousCheckoutAvailable:false;
}
export interface BookingLeaseAcquireV1 extends BookingLeaseStatusV1 {
  leaseToken:string;leaseSeconds:number;
}


/** AB-07: offline scenario metadata only. No provider session or execution
 * capability is supplied by this data-only SDK contract.
 */
export type RehearsalScenarioIdV1 =
  | 'standard' | 'queue' | 'sold_out' | 'price_change' | 'fees_change'
  | 'captcha' | 'bank_3ds' | 'payment_timeout' | 'unknown_charge'
  | 'restart' | 'standing' | 'automatic' | 'adjacency' | 'stale';
export interface RehearsalScenarioInfoV1 {
  id: RehearsalScenarioIdV1;
  title: string; ko: string; hint: string; hintKo: string;
}
export interface RehearsalLabObservationV1 {
  active: boolean;
  scenarioId: RehearsalScenarioIdV1 | null;
  status: 'idle' | 'running' | 'review' | 'awaiting_user'
    | 'submitting' | 'completed' | 'payment_unknown' | 'stopped' | 'failed';
  phase?: string;
  seed?: number; message: string;
  recovered: boolean;
  challenge?: 'none' | 'queue' | 'captcha' | '3ds';
  paymentAttempts?: number;
  /** Entirely synthetic mock-order summary, never real merchant data. */
  order?: null | {quantity: number; totalMinor: number; currency: string; seats: string[]};
  events?: ReadonlyArray<{phase: string;status: string;message: string}>;
}


/** AB-08: AI sees only the AB-04 redacted observation.
 * runNonce/requestId/snapshotId stay with the TixBam API and are NOT sent
 * to OpenRouter messages. No provider identity, page HTML, URLs or receipts.
 */
export interface AIPlannerRequestV1 {
  requestId:string;
  runNonce:string; // random, opaque per rehearsal run
  snapshotId:string; // host-local snapshot binding only
  pageGeneration:number;
  providerId:string; // API registration check; omitted from model prompt
  locale:'ko'|'en';rehearsal:true;
  observation:AIObservationV1;
}
export interface AIPlannerSuggestionV1 {
  schemaVersion:1;
  requestId:string;
  snapshotId:string;
  expectedPageGeneration:number;
  expectedStage:ProposedPageStage;
  action:ProposedActionKind;
  targetToken:string|null; // temporary AI token, never host targetRef
  rationaleCode:string;
  expiresAtMs:number;
  advisoryOnly:true;
  model:string;
}
/** Main process resolves targetToken and verifies AB-03 ProposalV1;
 * renderer sees only this non-actionable result.
 */
export interface RehearsalPlannerViewV1 {
  action:ProposedActionKind;
  rationaleCode:string;
  advisoryOnly:true;
  source:'openrouter'|'fallback';
  model?:string;
}


/** AB-09: read-only status reported by the offline recovery IPC.
 * This is NOT an add-on action or a live booking permission. It never
 * contains raw host ProposalV1 references, user credentials or seat identities.
 */
export interface RehearsalRecoveryResultV1 {
  executed:boolean;
  code:string;
  manualTakeover:boolean;
  action?:ProposedActionKind;
  attempts?:number;
  remaining?:number;
}


/** AB-10 host seat/offer model. All amounts are safe integer ISO currency
 * minor units (no FX, no float conversion). This describes seller evidence,
 * NOT a verified provider integration or an automation permission.
 */
export type NormalizedSeatModeV2 = 'assigned' | 'standing' | 'automatic';
export interface SeatRestrictionConsentV2 {
  allowRestrictedView?:boolean;
  allowRealName?:boolean;
  allowAgeRestricted?:boolean;
  allowAccessibilityRestricted?:boolean;
  allowedExtraIds?:string[];
}
export interface VerifiedFeeBreakdownV2 {
  ticketSubtotalMinor:number;
  serviceFeeMinor:number;
  taxMinor:number;
  deliveryFeeMinor:number;
  extrasMinor:number;
}
export interface SelectedOptionalExtraV2 {
  id:string;priceMinor:number;selected:true;
}
export interface NormalizedSeatOfferV2 {
  schemaVersion:2;
  id:string;providerId:string;eventKey:string;performance:string;
  quantity:number;currency:string;priceTier:string;
  section?:string;floor?:string;fulfillment?:string;
  seatMode:NormalizedSeatModeV2;
  /** Confirmed group/GA area, required for standing admission. */
  areaId?:string;
  /** May be empty at initial offer only for standing or automatic. */
  seats:string[];
  adjacent?:boolean;
  /** Required for automatic allocation. False means final payment cannot pass. */
  verifiedAllocation?:boolean;
  maxPerOrder?:number;
  available:true;feesIncluded:true;totalVerified:true;
  availabilityVerified:true;identityVerified:true;
  restrictedView:boolean;realNameRequired:boolean;ageRestricted:boolean;
  accessibilityRestricted:boolean;
  totalMinor:number;
  feeBreakdown:VerifiedFeeBreakdownV2;
  extras?:SelectedOptionalExtraV2[];
}
/** A host must evaluate seller and attendee constraints before selecting.
 * A parsed offer NEVER implies provider permission, approved actions or checkout.
 */
export interface OfferPolicyDecisionV2 {
  ok:boolean;
  code:string;
}

/** AB-12 evidence separates technical OFFLINE fixture records from vendor
 * authorization. Neither a stored digest nor a displayed verified state
 * grants real booking execution or any payment capability.
 */
export type FixtureVerificationState='unverified'|'fixture_verified'|'revoked';
export interface ProviderFixtureVerificationV1 {
  country:string;capability:AutomationCapability;state:FixtureVerificationState;
  recordedState:'pending'|'fixture_verified'|'revoked';
  reason:string;revision:number;addonVersion:string;
  profileId:string|null;fixtureSuite:string|null;fixtureSha256:string|null;
  evidenceUrl:string|null;reviewer:string|null;expiresAt:string|null;
  hostPermission:false;liveExecution:false;
}
export interface ProviderFixtureVerificationResponseV1 {
  providerId:string;country:string;registeredVersion:string;
  verifications:ProviderFixtureVerificationV1[];
  liveExecutionAvailable:false;
}
