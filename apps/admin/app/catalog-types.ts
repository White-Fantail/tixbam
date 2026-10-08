export type Artist = {
  id: string; name: string; country: string | null; imageUrl: string | null;
};
export type Performance = {
  id: string; eventId: string; sessionKey: string; label: string;
  startsAt: string | null; timezone: string | null;
  status: "scheduled" | "cancelled" | "postponed" | "sold_out";
};
export type Sale = {
  id: string; eventId: string; providerId: string; saleType: string;
  saleAt: string | null; bookingUrl: string;
  city: string | null; country: string | null; timezone: string | null;
  appliesToAll: boolean; performanceIds: string[];
};
export type Event = {
  id: string; artistId: string; artist: string; title: string;
  city: string; country: string; venue: string | null;
  startsAt: string | null; timezone: string | null; sourceUrl: string | null;
  performances: Performance[];
  sales: Sale[];
};
export type Provider = { id: string; name: string; kind?: "ticketing" | "event-presale" };
