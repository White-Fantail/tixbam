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
}
export interface BookingOrder {
  id: string; eventKey: string; quantity: number; totalMinor: number; currency: string;
  feesIncluded: boolean; adjacent?: boolean; seats: string[];
  performance: string; priceTier: string; section?: string; floor?: string; seatMode?: string; fulfillment?: string;
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
