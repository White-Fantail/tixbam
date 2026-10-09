/**
 * Deterministic Cityline-inspired *offline* training fixtures.
 *
 * Facts drawn from the official Cityline purchasing guide/FAQ:
 * event/performance -> member login where required -> price/type/quantity ->
 * Normal (manual seats) or Express (system allocation) where offered ->
 * shopping cart and fulfillment/payment -> Transaction Preview -> receipt.
 *
 * None of these fixture prices, seat maps, fees, clocks or offers come from
 * a real ticketing session. This module NEVER makes network requests.
 */
export const CITYLINE_SCENARIOS = Object.freeze([
  { id: "standard", title: "Full purchase", difficulty: "Getting started",
    description: "Choose a session, price zone, quantity and Normal/Express seats; review fees and checkout.",
    queue: false, presale: false, expressOnly: false, scarcity: false, checkoutUncertain: false, restrictedView: false,
    maxTickets: 6 },
  { id: "rush", title: "High-demand onsale", difficulty: "Intermediate",
    description: "Practice a waiting room, sold-out zones, limited adjacency and switching to a permitted alternative.",
    queue: true, presale: false, expressOnly: false, scarcity: true, checkoutUncertain: false, restrictedView: false,
    maxTickets: 2 },
  { id: "express", title: "Express Purchase only", difficulty: "Intermediate",
    description: "Simulate an event where the organiser has disabled seat-by-seat selection.",
    queue: false, presale: false, expressOnly: true, scarcity: false, checkoutUncertain: false, restrictedView: false,
    maxTickets: 4 },
  { id: "presale", title: "Member presale", difficulty: "Intermediate",
    description: "Practice a members-only sale, login/OTP prompt and eligible ticket-type checks.",
    queue: true, presale: true, expressOnly: true, scarcity: false, checkoutUncertain: false, restrictedView: false,
    maxTickets: 2 },
  { id: "restricted", title: "Restricted-view decision", difficulty: "Advanced",
    description: "Practice identifying and rejecting obstructed-view tickets before confirming an order.",
    queue: false, presale: false, expressOnly: false, scarcity: true, checkoutUncertain: false, restrictedView: true,
    maxTickets: 4 },
  { id: "uncertain", title: "Uncertain payment outcome", difficulty: "Advanced",
    description: "Practice bank verification and the safe action when a charge has no verified receipt.",
    queue: false, presale: false, expressOnly: false, scarcity: false, checkoutUncertain: true, restrictedView: false,
    maxTickets: 4 }
]);
export const CITYLINE_STEPS = Object.freeze([
  "Scenario & readiness", "Ticketing queue", "Member login",
  "Performance & ticket options", "Seat selection", "Shopping cart",
  "Delivery & payment", "Transaction preview", "Simulated bank verification", "Result & verification"
]);
export const CITYLINE_TIERS = Object.freeze([
  { id: "vip", label: "VIP", priceMinor: 148000 },
  { id: "a", label: "Zone A", priceMinor: 98000 },
  { id: "b", label: "Zone B", priceMinor: 68000 },
  { id: "c", label: "Zone C", priceMinor: 48000 }
]);
export const CITYLINE_PERFORMANCES = Object.freeze([
  { id: "first", label: "Practice · Fri 19:00" },
  { id: "second", label: "Practice · Sat 18:00" }
]);
export const CITYLINE_DELIVERY = Object.freeze([
  { id: "eticket", label: "E-ticket (where offered)", feeMinor: 0 },
  { id: "kiosk", label: "Ticketing kiosk pickup (where offered)", feeMinor: 0 },
  { id: "delivery", label: "Delivery (where offered)", feeMinor: 4000 }
]);
export const CITYLINE_TICKET_FEE_MINOR = 3500;
export const CITYLINE_PRACTICE_HOLD_SECONDS = 120; // invented training clock, NOT an event-specific limit

export function citylineScenario(id) {
  return CITYLINE_SCENARIOS.find(s => s.id === id) || CITYLINE_SCENARIOS[0];
}
export function citylinePrice(tierId) {
  return CITYLINE_TIERS.find(t => t.id === tierId) || null;
}
export function citylineDelivery(methodId) {
  return CITYLINE_DELIVERY.find(d => d.id === methodId) || null;
}
export function citylineMoney(minor) {
  return "HK$" + (minor / 100).toLocaleString("en-HK", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}
export function citylineAvailableTiers(id) {
  const scenario = citylineScenario(id);
  // Deliberate synthetic constraints. Never represent actual event inventory.
  return CITYLINE_TIERS.map(t => ({
    ...t, soldOut: scenario.scarcity && (t.id === "vip" || t.id === "a"),
    restrictedView: scenario.restrictedView && t.id === "c"
  }));
}
export function citylineSeats(tierId, scenarioId) {
  const scenario = citylineScenario(scenarioId);
  const seats = [];
  for (let ri = 0; ri < 5; ri++) {
    const row = String.fromCharCode(65 + ri);
    for (let number = 1; number <= 10; number++) {
      // A small mock seat chart, never a venue seating map.
      const sold = scenario.scarcity
        ? (ri < 2 || (number % 3 === 0) || (ri === 2 && number > 7))
        : (ri === 0 && (number === 2 || number === 6)) || (ri === 3 && number > 7);
      seats.push({
        id: row + number, row, number, tierId, sold,
        restrictedView: scenario.restrictedView && (ri === 4 || tierId === "c")
      });
    }
  }
  return seats;
}
export function areAdjacent(ids) {
  if (ids.length <= 1) return true;
  const positions = ids.map(id => /^([A-Z])([1-9][0-9]*)$/.exec(id));
  if (positions.some(x => !x)) return false;
  if (!positions.every(x => x[1] === positions[0][1])) return false;
  const nums = positions.map(x => Number(x[2])).sort((a, b) => a - b);
  return nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
}
export function expressSeatOffer(seats, quantity, requireTogether) {
  const open = seats.filter(seat => !seat.sold);
  if (!Number.isInteger(quantity) || quantity < 1) return [];
  if (requireTogether) {
    for (const first of open) {
      const group = open.filter(seat =>
        seat.row === first.row && seat.number >= first.number &&
        seat.number < first.number + quantity);
      if (group.length === quantity && areAdjacent(group.map(seat => seat.id))) return group;
    }
    return [];
  }
  return open.slice(0, quantity);
}
export function citylineQuote({ tierId, quantity, deliveryId = "eticket" }) {
  const tier = citylinePrice(tierId);
  const delivery = citylineDelivery(deliveryId);
  if (!tier || !delivery || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return null;
  const ticketsMinor = tier.priceMinor * quantity;
  const feeMinor = CITYLINE_TICKET_FEE_MINOR * quantity;
  const deliveryMinor = delivery.feeMinor;
  return { ticketsMinor, feeMinor, deliveryMinor,
    totalMinor: ticketsMinor + feeMinor + deliveryMinor };
}
export function citylineOfferCheck({ tierId, quantity, budgetMinor, deliveryId = "eticket",
  selectedSeatIds = [], seats = [], requireTogether = false,
  acceptRestrictedView = false, scenarioId = "standard" }) {
  const scenario = citylineScenario(scenarioId);
  const offered = citylineAvailableTiers(scenarioId).find(t => t.id === tierId);
  if (!offered) return { ok: false, reason: "Select a ticket price zone." };
  if (offered.soldOut) return { ok: false, reason: "That practice price zone is sold out. Choose another available zone." };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > scenario.maxTickets)
    return { ok: false, reason: "This practice event allows up to " + scenario.maxTickets + " tickets per order." };
  if (selectedSeatIds.length !== quantity)
    return { ok: false, reason: "Select exactly " + quantity + " ticket" + (quantity === 1 ? "" : "s") + "." };
  if (new Set(selectedSeatIds).size !== selectedSeatIds.length)
    return { ok: false, reason: "The same seat cannot be selected twice." };
  const mapped = selectedSeatIds.map(id => seats.find(seat => seat.id === id));
  if (mapped.some(seat => !seat || seat.sold))
    return { ok: false, reason: "One or more selected seats are unavailable. Re-select your seats." };
  if (requireTogether && !areAdjacent(selectedSeatIds))
    return { ok: false, reason: "These seats are not adjacent. Your Booking Plan requires seats together." };
  if (!acceptRestrictedView && (offered.restrictedView || mapped.some(seat => seat.restrictedView)))
    return { ok: false, reason: "Restricted-view seats were not authorized in this practice purchase." };
  const quote = citylineQuote({ tierId, quantity, deliveryId });
  if (!quote) return { ok: false, reason: "A valid ticket and delivery choice is required." };
  if (!Number.isSafeInteger(budgetMinor) || budgetMinor <= 0)
    return { ok: false, reason: "Set a valid maximum budget in HKD before practising." };
  if (quote.totalMinor > budgetMinor)
    return { ok: false, reason: "Total including fees exceeds your limit by " +
      citylineMoney(quote.totalMinor - budgetMinor) + ". Choose another price zone or delivery option.", quote };
  return { ok: true, reason: "Offer fits your ticket count and maximum total.", quote };
}
export function citylineNextFromResult(scenarioId) {
  return citylineScenario(scenarioId).checkoutUncertain ? "unknown" : "simulated-receipt";
}
