import type { BookingPlan } from "./booking-plans";
import type { BookingSchema, BookingContext, BookingPreferences, BookingRun, CardSummary, CardInput, AIAdvisoryRequest, AIAdvisoryResponse, AIAdvisoryContext } from "../../../packages/addon-sdk";
export type AutomationSupportStatus = "available" | "restricted" | "unverified" | "delegated";

export interface AutomationLevelSupport {
  status: AutomationSupportStatus;
  summary: string;
  sourceUrl?: string;
}

export interface AddonAutomationSupport {
  reviewedAt: string;
  level1: AutomationLevelSupport;
  level2: AutomationLevelSupport;
  level3: AutomationLevelSupport;
}

export interface TicketAddon extends Provider {
  booking?: BookingSchema;
  bookingAssistance?: { mode: "manual"; guide: "cityline"; payment: "user"; guideUrl: string; faqUrl: string };
  automation: AddonAutomationSupport;
  version: string;
  description: string;
  capabilities: string[];
  installed: boolean;
}

export type Section = "overview" | "plans" | "discover" | "artists" | "watchlist" | "sessions" | "providers" | "settings";

export interface Provider {
  id: string;
  name: string;
  region: string;
  country: string;
  kind: "ticketing" | "event-presale";
  url: string;
  allowedHosts: string[];
  sites?: Array<{ label: string; url: string }>;
  color: string;
  initials: string;
}

export interface WatchEvent {
  id: string;
  artist: string;
  title: string;
  city: string;
  providerId: string;
  saleAt: string;
  url: string;
  addedAt: string;
  eventId?: string;
  performanceId?: string;
  performanceAt?: string;
}

export type { AIAdvisoryRequest, AIAdvisoryResponse, AIAdvisoryContext };
export type RehearsalTarget = Pick<BookingPlan,
  "id" | "artist" | "title" | "providerId" | "currency" | "quantity" |
  "budgetMinor" | "requireTogether" | "allowFallback" | "preferencesReady" | "seatPreferences" | "terms">;
export interface RehearsalLabScenario {
  id:string;title:string;ko:string;hint:string;hintKo:string;
}
export interface RehearsalLabState {
  active:boolean;scenarioId:string|null;status:string;phase?:string;
  message:string;recovered:boolean;seed?:number;
  challenge?:string;paymentAttempts?:number;
  reservationVerified?:boolean;holdExpiresAtMs?:number|null;holdObservedAtMs?:number;
  reservationRecoveryRequired?:boolean;
  order?:null|{quantity:number;totalMinor:number;currency:string;seats:string[]};
  events?:Array<{phase:string;status:string;message:string}>;
  reconciliation?:{reviewed:boolean;reviewOutcome:string|null;purchaseBlocked:true};
}
export interface RehearsalPlannerView {
  action:"WAIT"|"REOBSERVE"|"ASK_USER"|"STOP"|
    "SELECT_PERFORMANCE"|"SELECT_PRICE_TIER"|"SELECT_APPROVED_OFFER"|
    "CHOOSE_VERIFIED_DELIVERY"|"RETURN_TO_VERIFIED_STEP";
  rationaleCode:string;
  advisoryOnly:true;
  source:"openrouter"|"fallback";
  model?:string;
}
export interface RehearsalRecoveryResult {
  executed:boolean;code:string;manualTakeover:boolean;
  action?:RehearsalPlannerView["action"];attempts?:number;remaining?:number;
}
export interface RehearsalBridge {
  labRecover:()=>Promise<RehearsalRecoveryResult>;
  labPropose:()=>Promise<RehearsalPlannerView>;
  labScenarios:()=>Promise<RehearsalLabScenario[]>;
  labStatus:()=>Promise<RehearsalLabState>;
  labStart:(scenarioId:string,seed:number)=>Promise<RehearsalLabState>;
  labNext:(action:"advance"|"manual"|"confirm")=>Promise<RehearsalLabState>;
  labStop:()=>Promise<RehearsalLabState>;
  labRestart:()=>Promise<RehearsalLabState>;
  labReviewUnknown:(outcome:'reported_paid'|'reported_not_paid'|'inconclusive',confirmed:boolean)=>Promise<RehearsalLabState>;
  getLanguage: () => Promise<"ko" | "en">;
  setLanguage: (code: "ko" | "en") => Promise<"ko" | "en">;
  onLanguageChanged: (listener: (code: "ko" | "en") => void) => () => void;
  getContext: () => Promise<RehearsalTarget>;
  aiAdvice: (input: AIAdvisoryRequest) => Promise<AIAdvisoryResponse>;
  complete: () => Promise<{ saved: boolean }>;
  close: () => Promise<boolean>;
}

export type LivePhase = "preparing" | "waiting" | "queue" | "selecting" | "checkout" | "verification";
export interface LiveHistory {
  planId: string;
  providerId: string;
  phase: LivePhase;
  updatedAt: number;
  reason: "closed" | "interrupted";
}

export interface CopilotSuggestion {
  x:number;y:number;label:string;reason:string;confidence:number;
  kind:"performance"|"price_tier"|"seat"|"quantity"|"continue";
}
export interface CopilotVisionResult {
  status:"candidates"|"uncertain"|"human_required";
  targets:CopilotSuggestion[];advisoryOnly:true;humanApprovalRequired:true;
  snapshotToken:string;
}
export interface CopilotSnapshot {
  token: string;windowId:number;expiresAt:number;
  image:string;width:number;height:number;
  mode:"human_guidance";automaticClickAvailable:false;
}
export interface TicketWindow {
  planId?: string | null;
  phase?: LivePhase;
  site?: string;
  popup?: boolean;
  parentId?: number | null;
  loadError?: number | null;
  id: number;
  providerId: string;
  title: string;
  url: string;
  loading: boolean;
  openedAt: number;
}

export interface CloudAccount { id: string; displayName: string; email: string | null; providers: string[]; }
export interface CloudSnapshot { user: CloudAccount; favoriteArtistIds: string[]; favoriteEventIds: string[]; favoritePerformanceIds: string[]; favoriteSaleIds: string[]; bookingPlans: BookingPlan[]; offline?: boolean; watchlist: WatchEvent[]; }
export interface DesktopBridge {
  getLanguage: () => Promise<"ko" | "en">;
  setLanguage: (code: "ko" | "en") => Promise<"ko" | "en">;
  onLanguageChanged: (listener: (code: "ko" | "en") => void) => () => void;
  accountStatus: () => Promise<CloudSnapshot | null>;
  accountOAuthStart: (url: string, provider: "google" | "apple") => Promise<{ provider: "google" | "apple"; expiresIn: number }>;
  accountOAuthPoll: () => Promise<CloudSnapshot | null>;
  accountOAuthCancel: () => Promise<boolean>;
  accountSignOut: () => Promise<boolean>;
  accountRequest: (method: "GET" | "PUT" | "DELETE", endpoint: string, body?: unknown) => Promise<unknown>;
  aiAdvice: (input: AIAdvisoryRequest) => Promise<AIAdvisoryResponse>;
  vaultStatus: () => Promise<{ available: boolean; cards: CardSummary[] }>;
  saveCard: (input: CardInput) => Promise<CardSummary[]>;
  removeCard: (id: string) => Promise<CardSummary[]>;
  bookingContext: (input: { providerId: string; eventUrl: string; windowId?: number; planId?: string; rehearsal?: boolean }) => Promise<BookingContext>;
  bookingReadiness: (input: { providerId: string }) => Promise<import('../../../packages/addon-sdk').CheckoutReadiness>;
  saveBookingPreferences: (id: string, input: BookingPreferences) => Promise<BookingPreferences>;
  startBooking: (input: { contextId: string; preferences: BookingPreferences; cardId?: string; cvv?: string; paymentConsent: boolean }) => Promise<BookingRun>;
  listBookings: () => Promise<BookingRun[]>;
  resumeBooking: (id: string, confirm?: boolean) => Promise<BookingRun>;
  stopBooking: (id: string) => Promise<BookingRun>;
  onBookingChanged: (listener: (run: BookingRun) => void) => () => void;
  openAssistanceGuide: (providerId: string, kind: "guide" | "faq") => Promise<boolean>;
  openWindow: (options: { providerId: string; url?: string }) => Promise<{ id: number; providerId: string; url: string }>;
  openSaleWindow: (options: { providerId: string; url: string }) => Promise<{ id: number; providerId: string; url: string }>;
  openRehearsalWindow: (plan: BookingPlan, accountId: string | null) => Promise<{ reused: boolean; planId: string }>;
  ackRehearsalSave: (requestId: number, success: boolean, message?: string) => Promise<boolean>;
  onRehearsalSaveRequest: (listener: (request: {
    requestId: number; planId: string; ownerId: string | null;
  }) => void) => () => void;
  onRehearsalClosed: (listener: (planId: string) => void) => () => void;
  openPlanWindow: (options: { planId: string; providerId: string; url: string }) =>
    Promise<{ id: number; providerId: string; planId: string; reused: boolean; site?: string }>;
  setLivePhase: (windowId: number, phase: LivePhase) => Promise<boolean>;
  listLiveHistory: () => Promise<LiveHistory[]>;
  dismissLiveHistory: (planId: string) => Promise<LiveHistory[]>;
  openTicketAgent: (sourceWindowId: number, agentUrl: string) => Promise<{ id: number; providerId: string; url: string }>;
  copilotCapture: (id:number) => Promise<CopilotSnapshot>;
  copilotHighlight: (id:number, token:string, point:{x:number;y:number}) => Promise<{highlighted:boolean;expiresAt:number}>;
  copilotClick: (id:number, token:string, point:{x:number;y:number}) => Promise<{clicked:boolean;verifiedPurchase:false;automatic:false}>;
  copilotAnalyze: (id:number, token:string, conditions:{quantity:number;currency:string;budgetMinor:number;locale:"ko"|"en"}) => Promise<CopilotVisionResult>;
  listWindows: () => Promise<TicketWindow[]>;
  focusWindow: (id: number) => Promise<boolean>;
  closeWindow: (id: number) => Promise<boolean>;
  listAddons: () => Promise<TicketAddon[]>;
  setAddonInstalled: (id: string, installed: boolean) => Promise<TicketAddon[]>;
  onAddonsChanged: (listener: (addons: TicketAddon[]) => void) => () => void;
  clearProviderData: (id: string) => Promise<boolean>;
  onWindowsChanged: (listener: (windows: TicketWindow[]) => void) => () => void;
}

declare global {
  interface Window {
    tixbam?: DesktopBridge;
    tixbamRehearsal?: RehearsalBridge;
  }
}
