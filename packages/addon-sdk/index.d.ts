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
