import type { BookingPlan } from "./booking-plans";
import type { BookingSchema, BookingContext, BookingPreferences, BookingRun, CardSummary, CardInput } from "../../../packages/addon-sdk";
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

export type RehearsalTarget = Pick<BookingPlan,
  "id" | "artist" | "title" | "providerId" | "currency" | "quantity" |
  "budgetMinor" | "requireTogether" | "allowFallback" | "preferencesReady">;
export interface RehearsalBridge {
  getLanguage: () => Promise<"ko" | "en">;
  setLanguage: (code: "ko" | "en") => Promise<"ko" | "en">;
  onLanguageChanged: (listener: (code: "ko" | "en") => void) => () => void;
  getContext: () => Promise<RehearsalTarget>;
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
  vaultStatus: () => Promise<{ available: boolean; cards: CardSummary[] }>;
  saveCard: (input: CardInput) => Promise<CardSummary[]>;
  removeCard: (id: string) => Promise<CardSummary[]>;
  bookingContext: (input: { providerId: string; eventUrl: string; windowId?: number; planId?: string; rehearsal?: boolean }) => Promise<BookingContext>;
  saveBookingPreferences: (id: string, input: BookingPreferences) => Promise<BookingPreferences>;
  startBooking: (input: { contextId: string; preferences: BookingPreferences; cardId?: string; cvv?: string; paymentConsent: boolean }) => Promise<BookingRun>;
  listBookings: () => Promise<BookingRun[]>;
  resumeBooking: (id: string, confirm?: boolean) => Promise<BookingRun>;
  stopBooking: (id: string) => Promise<BookingRun>;
  onBookingChanged: (listener: (run: BookingRun) => void) => () => void;
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
