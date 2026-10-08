export type Artist = {
  id: string; name: string; country: string | null; imageUrl: string | null;
};
export type Sale = {
  id: string; eventId: string; providerId: string; saleType: string;
  saleAt: string | null; bookingUrl: string;
  city: string | null; country: string | null; timezone: string | null;
};
export type Event = {
  id: string; artistId: string; artist: string; title: string;
  city: string; country: string; venue: string | null;
  startsAt: string | null; timezone: string | null; sourceUrl: string | null;
  sales: Sale[];
};
export type Provider = { id: string; name: string; kind?: "ticketing" | "event-presale" };
