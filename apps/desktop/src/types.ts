export type AutomationSupportStatus = "available" | "restricted" | "unverified";

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
  automation: AddonAutomationSupport;
  version: string;
  description: string;
  capabilities: string[];
  installed: boolean;
}

export type Section = "overview" | "watchlist" | "sessions" | "providers" | "settings";

export interface Provider {
  id: string;
  name: string;
  region: string;
  country: string;
  url: string;
  allowedHosts: string[];
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
}

export interface TicketWindow {
  id: number;
  providerId: string;
  title: string;
  url: string;
  loading: boolean;
  openedAt: number;
}

export interface DesktopBridge {
  openWindow: (options: { providerId: string; url?: string }) => Promise<{ id: number; providerId: string; url: string }>;
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
  }
}
