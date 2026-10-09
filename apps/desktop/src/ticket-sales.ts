import type { CatalogSale, CatalogPerformance } from "../../../packages/catalog-types";

export type SalePhase = "tba" | "upcoming" | "soon" | "imminent" | "started" | "sold-out" | "cancelled" | "postponed";
export type SaleLike = Pick<CatalogSale, "saleAt" | "appliesToAll" | "performanceIds">;
export type PerformanceState = CatalogPerformance["status"] | null | undefined;
export const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function saleTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Opening time is not a closing time: after the timestamp, availability is unknown. */
export function getSaleTiming(
  saleAt: string | null | undefined,
  now: number,
  performanceStatus?: PerformanceState
): { phase: SalePhase; label: string } {
  if (performanceStatus === "sold_out") return { phase: "sold-out", label: "Sold out" };
  if (performanceStatus === "cancelled") return { phase: "cancelled", label: "Performance cancelled" };
  if (performanceStatus === "postponed") return { phase: "postponed", label: "Performance postponed" };
  const timestamp = saleTimestamp(saleAt);
  if (timestamp === null) return { phase: "tba", label: "Sale TBA" };
  const remaining = timestamp - now;
  if (remaining <= 0) return { phase: "started", label: "Sale started" };
  if (remaining > 7 * DAY_MS) {
    return { phase: "upcoming", label: "D-" + Math.ceil(remaining / DAY_MS) + " until sale" };
  }
  if (remaining > DAY_MS) {
    const days = Math.floor(remaining / DAY_MS);
    const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
    return { phase: "soon", label: "Opens in " + days + "d " + hours + "h" };
  }
  if (remaining > HOUR_MS) {
    const hours = Math.floor(remaining / HOUR_MS);
    const minutes = Math.floor((remaining % HOUR_MS) / 60000);
    return { phase: "soon", label: "Opens in " + hours + "h " + minutes + "m" };
  }
  return { phase: "imminent", label: "Opens in " + Math.ceil(remaining / 60000) + "m" };
}

export function formatSaleLocalTime(saleAt: string | null | undefined, timezone?: string | null): string {
  const timestamp = saleTimestamp(saleAt);
  if (timestamp === null) return "Sale date TBA";
  // User-created watchlist entries have no venue time zone and were entered
  // with datetime-local. Retain that local wall-clock interpretation in UI.
  if (!timezone) {
    const local = new Intl.DateTimeFormat("en-NZ", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).format(timestamp);
    return local + " (your time)";
  }
  let zone = timezone;
  try {
    new Intl.DateTimeFormat("en-NZ", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const display = new Intl.DateTimeFormat("en-NZ", {
    timeZone: zone, day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(timestamp);
  return display + " (" + zone + ")";
}

/**
 * Only show a venue status for the whole event when every performance has
 * that same confirmed status; otherwise use the selected session's status.
 */
export function eventPerformanceStatus(
  performances: readonly Pick<CatalogPerformance, "id" | "status">[],
  performanceId?: string
): PerformanceState {
  if (performanceId) return performances.find(performance => performance.id === performanceId)?.status;
  if (!performances.length) return undefined;
  const confirmed = ["sold_out", "cancelled", "postponed"] as const;
  return confirmed.find(status => performances.every(performance => performance.status === status));
}

export function saleAppliesToPerformance(sale: SaleLike, performanceId?: string): boolean {
  if (!performanceId) return true;
  return sale.appliesToAll !== false || (sale.performanceIds || []).includes(performanceId);
}

/** Select the next scheduled opening. If none remain, show the latest past opening, then TBA. */
export function pickNextSale<T extends SaleLike>(sales: readonly T[], now: number, performanceId?: string): T | null {
  const eligible = sales.filter(sale => saleAppliesToPerformance(sale, performanceId));
  const future = eligible
    .filter(sale => { const ts = saleTimestamp(sale.saleAt); return ts !== null && ts > now; })
    .sort((a, b) => saleTimestamp(a.saleAt)! - saleTimestamp(b.saleAt)!);
  if (future.length) return future[0];
  const past = eligible
    .filter(sale => { const ts = saleTimestamp(sale.saleAt); return ts !== null && ts <= now; })
    .sort((a, b) => saleTimestamp(b.saleAt)! - saleTimestamp(a.saleAt)!);
  return past[0] || eligible.find(sale => saleTimestamp(sale.saleAt) === null) || null;
}

export type SaleFilter = "all" | "upcoming" | "week";

/** Strictly future openings; a past opening never means the tickets sold out. */
export function matchesSaleFilter(
  saleAts: readonly (string | null | undefined)[],
  now: number,
  filter: SaleFilter
): boolean {
  if (filter === "all") return true;
  return saleAts.some(saleAt => {
    const timestamp = saleTimestamp(saleAt);
    return timestamp !== null && timestamp > now &&
      (filter === "upcoming" || timestamp <= now + 7 * DAY_MS);
  });
}
