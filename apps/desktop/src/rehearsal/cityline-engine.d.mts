export interface CitylineScenario {
  id: string; title: string; difficulty: string; description: string;
  queue: boolean; presale: boolean; expressOnly: boolean; scarcity: boolean;
  checkoutUncertain: boolean; restrictedView: boolean; maxTickets: number;
}
export interface CitylineTier {
  id: string; label: string; priceMinor: number;
  soldOut?: boolean; restrictedView?: boolean;
}
export interface CitylineSeat {
  id: string; row: string; number: number; tierId: string;
  sold: boolean; restrictedView: boolean;
}
export interface CitylineQuote {
  ticketsMinor: number; feeMinor: number; deliveryMinor: number; totalMinor: number;
}
export interface CitylineOfferInput {
  tierId: string; quantity: number; budgetMinor: number; deliveryId?: string;
  selectedSeatIds: string[]; seats: CitylineSeat[]; requireTogether: boolean;
  acceptRestrictedView: boolean; scenarioId: string;
}
export interface CitylineResult {
  ok: boolean; reason: string; quote?: CitylineQuote;
}
export const CITYLINE_SCENARIOS: readonly CitylineScenario[];
export const CITYLINE_STEPS: readonly string[];
export const CITYLINE_TIERS: readonly {id: string; label: string; priceMinor: number}[];
export const CITYLINE_PERFORMANCES: readonly {id: string; label: string}[];
export const CITYLINE_DELIVERY: readonly {id: string; label: string; feeMinor: number}[];
export const CITYLINE_TICKET_FEE_MINOR: number;
export const CITYLINE_PRACTICE_HOLD_SECONDS: number;
export function citylineScenario(id: string): CitylineScenario;
export function citylinePrice(tierId: string): {id: string; label: string; priceMinor: number} | null;
export function citylineDelivery(methodId: string): {id: string; label: string; feeMinor: number} | null;
export function citylineMoney(minor: number): string;
export function citylineAvailableTiers(id: string): CitylineTier[];
export function citylineSeats(tierId: string, scenarioId: string): CitylineSeat[];
export function areAdjacent(ids: string[]): boolean;
export function expressSeatOffer(seats: CitylineSeat[], quantity: number, requireTogether: boolean): CitylineSeat[];
export function citylineQuote(input: {tierId: string; quantity: number; deliveryId?: string}): CitylineQuote | null;
export function citylineOfferCheck(input: CitylineOfferInput): CitylineResult;
export function citylineNextFromResult(scenarioId: string): "unknown" | "simulated-receipt";
