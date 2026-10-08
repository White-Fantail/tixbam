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
}
export interface CardSummary { id: string; label: string; last4: string; expiryMonth: number; expiryYear: number }
export interface CardInput { label: string; name: string; number: string; expiryMonth: number; expiryYear: number }
