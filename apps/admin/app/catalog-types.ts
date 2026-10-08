/** Type aliases are intentionally shared with the Electron renderer. */
import type {
  CatalogArtist, CatalogEvent, CatalogPerformance, CatalogSale,
} from "../../../packages/catalog-types";

export type Artist = CatalogArtist;
export type Performance = CatalogPerformance;
export type Sale = CatalogSale;
export type Event = CatalogEvent;
export type Provider = { id: string; name: string; kind?: "ticketing" | "event-presale" };
