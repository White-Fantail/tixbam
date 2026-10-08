import { resolvePlatformApiUrl } from "./api-config";

export interface RemotePerformance {
  id: string;
  eventId: string;
  sessionKey: string;
  label: string;
  startsAt: string | null;
  timezone: string | null;
  status: "scheduled" | "cancelled" | "postponed" | "sold_out";
}
export interface RemoteSale {
  id: string;
  providerId: string;
  saleType: string;
  saleAt: string | null;
  bookingUrl: string;
  appliesToAll: boolean;
  performanceIds: string[];
}
export interface RemoteEvent {
  id: string;
  artist: string;
  title: string;
  city: string;
  country: string;
  venue: string | null;
  startsAt: string | null;
  timezone: string | null;
  performances: RemotePerformance[];
  sales: RemoteSale[];
}
export interface RemoteAddon {
  id: string;
  name: string;
  version: string;
  published: boolean;
}
export const initialApiUrl = () =>
  resolvePlatformApiUrl(import.meta.env.DEV, import.meta.env.VITE_TIXBAM_API_URL);

export function validApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname));
  } catch {
    return false;
  }
}
export async function getPublicData<T>(url: string, endpoint: string): Promise<T> {
  if (!validApiUrl(url)) throw new Error("Configure a secure TIXBAM API URL.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url.replace(/\/$/, "") + endpoint, { signal: controller.signal });
    if (!response.ok) throw new Error("Server returned HTTP " + response.status);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}
