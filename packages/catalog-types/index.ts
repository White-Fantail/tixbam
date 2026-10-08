/** Shared public catalog payloads for TixBam Admin and Desktop.
 * The FastAPI serializers in services/api/app/serializers.py define the wire contract.
 */
export interface CatalogArtist {
  id: string;
  name: string;
  country: string | null;
  imageUrl: string | null;
}

export interface CatalogPerformance {
  id: string;
  eventId: string;
  sessionKey: string;
  label: string;
  startsAt: string | null;
  timezone: string | null;
  status: "scheduled" | "cancelled" | "postponed" | "sold_out";
}

export interface CatalogSale {
  id: string;
  eventId: string;
  providerId: string;
  saleType: string;
  saleAt: string | null;
  bookingUrl: string;
  city: string | null;
  country: string | null;
  timezone: string | null;
  appliesToAll: boolean;
  performanceIds: string[];
}

export interface CatalogEvent {
  id: string;
  artistId: string;
  artist: string;
  title: string;
  city: string;
  country: string;
  venue: string | null;
  startsAt: string | null; // legacy earliest-session summary
  timezone: string | null;
  sourceUrl: string | null;
  performances: CatalogPerformance[];
  sales: CatalogSale[];
}
