import type { WatchEvent } from "./types";

export interface BookingPlan {
  id: string;
  artist: string;
  title: string;
  city: string;
  providerId: string;
  bookingUrl: string;
  eventId: string | null;
  performanceId: string | null;
  saleId: string | null;
  saleAt: string;
  performanceAt: string;
  timezone: string;
  quantity: number;
  budgetMinor: number;
  currency: string;
  requireTogether: boolean;
  allowFallback: boolean;
  preferencesReady: boolean;
  accountReady: boolean;
  paymentReady: boolean;
  lastRehearsalAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const PLANS_KEY = "tixbam.booking-plans.v1";

export function currencyFactor(currency: string): number {
  // Zero-decimal currencies are stored as integer smallest units.
  return ["KRW", "JPY", "VND"].includes(currency) ? 1 : 100;
}


export function planFromWatch(item: WatchEvent): BookingPlan {
  return {
    id: item.id, artist: item.artist, title: item.title, city: item.city,
    providerId: item.providerId, bookingUrl: item.url || "",
    eventId: item.eventId || null, performanceId: item.performanceId || null, saleId: null,
    saleAt: item.saleAt || "", performanceAt: item.performanceAt || "", timezone: "",
    quantity: 2, budgetMinor: 0,
    currency: item.providerId === "cityline" ? "HKD" :
      ["nol", "yes24"].includes(item.providerId) ? "KRW" :
      item.providerId === "kktix" ? "TWD" : "USD",
    requireTogether: true, allowFallback: true,
    preferencesReady: false, accountReady: false, paymentReady: false,
    lastRehearsalAt: null, notes: "",
    createdAt: item.addedAt, updatedAt: item.addedAt,
  };
}

export function makePlan(input: Pick<BookingPlan, "artist" | "title" | "city" | "providerId"> &
  Partial<BookingPlan>): BookingPlan {
  const now = new Date().toISOString();
  return {
    ...planFromWatch({ id: crypto.randomUUID(), artist: input.artist, title: input.title,
      city: input.city, providerId: input.providerId, url: "", saleAt: "", addedAt: now }),
    ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now,
  };
}

export function loadGuestPlans(): BookingPlan[] {
  try {
    const stored = localStorage.getItem(PLANS_KEY);
    if (stored !== null) {
      const parsed: unknown = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.filter((p): p is BookingPlan =>
        p && typeof p === "object" && typeof p.id === "string" &&
        typeof p.title === "string" && typeof p.artist === "string" &&
        typeof p.providerId === "string") : [];
    }
    // Import older anonymous watch entries once; never clear the original key.
    const old: unknown = JSON.parse(localStorage.getItem("tixbam.watchlist.v1") || "[]");
    const migrated = Array.isArray(old) ? old.filter((x): x is WatchEvent =>
      x && typeof x.id === "string" && typeof x.artist === "string" &&
      typeof x.title === "string" && typeof x.providerId === "string").map(planFromWatch) : [];
    localStorage.setItem(PLANS_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
}

export function saveGuestPlans(plans: BookingPlan[]): void {
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
}

export function toWatchEvent(plan: BookingPlan): WatchEvent {
  return {
    id: plan.id, artist: plan.artist, title: plan.title, city: plan.city,
    providerId: plan.providerId, url: plan.bookingUrl, saleAt: plan.saleAt,
    performanceAt: plan.performanceAt || undefined,
    eventId: plan.eventId || undefined, performanceId: plan.performanceId || undefined,
    addedAt: plan.createdAt,
  };
}

export function toCloudPayload(plan: BookingPlan): Omit<BookingPlan,"id" | "createdAt" | "updatedAt"> {
  const { id: _id, createdAt: _created, updatedAt: _updated, ...safe } = plan;
  return safe;
}

export function officialLinkKind(plan: BookingPlan, hosts: readonly string[]): "direct" | "promoter" | "missing" {
  if (!plan.bookingUrl) return "missing";
  try {
    const url = new URL(plan.bookingUrl);
    if (url.protocol !== "https:" || url.username || url.password) return "missing";
    return hosts.some(host => url.hostname.toLowerCase() === host ||
      url.hostname.toLowerCase().endsWith("." + host)) ? "direct" : "promoter";
  } catch {
    return "missing";
  }
}

export function planChecks(plan: BookingPlan, hosts: readonly string[]) {
  return [
    { label: "Link uses ticket provider domain", done: officialLinkKind(plan, hosts) === "direct" },
    { label: "Ticketing account checked", done: plan.accountReady },
    { label: "Ticket preferences configured", done: plan.preferencesReady && plan.budgetMinor > 0 },
    { label: "Payment method prepared", done: plan.paymentReady },
    { label: "Simulation rehearsed", done: Boolean(plan.lastRehearsalAt) },
  ];
}
