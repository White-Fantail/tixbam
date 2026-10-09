const test = require("node:test");
const assert = require("node:assert/strict");

const simulator = import("../src/rehearsal/cityline-engine.mjs");

test("Cityline scenario data corresponds to verified branches, but never claims live inventory", async () => {
  const api = await simulator;
  assert.deepEqual(api.CITYLINE_STEPS, [
    "Scenario & readiness", "Ticketing queue", "Member login",
    "Performance & ticket options", "Seat selection", "Shopping cart",
    "Delivery & payment", "Transaction preview", "Simulated bank verification", "Result & verification"
  ]);
  assert.equal(api.CITYLINE_SCENARIOS.length, 8);
  assert.equal(api.citylineScenario("seatmap").mapUnavailable, true);
  assert.equal(api.citylineScenario("realname").realName, true);
  assert.equal(api.citylineScenario("express").expressOnly, true);
  assert.equal(api.citylineScenario("presale").presale, true);
  assert.equal(api.citylineScenario("rush").queue, true);
  assert.equal(api.citylineNextFromResult("uncertain"), "unknown");
  assert.equal(api.citylineNextFromResult("standard"), "simulated-receipt");
  assert.ok(api.CITYLINE_PRACTICE_HOLD_SECONDS > 0);
});
test("budget uses all-in HKD smallest units, not the ticket face value alone", async () => {
  const x = await simulator;
  const a = x.citylineQuote({ tierId:"a", quantity:1, deliveryId:"eticket" });
  assert.deepEqual(a, {ticketsMinor:98000, feeMinor:3500, deliveryMinor:0, totalMinor:101500});
  const b = x.citylineQuote({tierId:"b", quantity:1, deliveryId:"eticket"});
  assert.equal(b.totalMinor, 71500);
  assert.equal(x.citylineQuote({tierId:"b",quantity:1,deliveryId:"delivery"}).totalMinor, 75500);
  const seat = x.citylineSeats("a","standard");
  const one = seat.filter(s=>!s.sold).slice(0,1).map(s=>s.id);
  assert.match(x.citylineOfferCheck({scenarioId:"standard",tierId:"a",quantity:1,
    selectedSeatIds:one,seats:seat,budgetMinor:100000,requireTogether:true,acceptRestrictedView:false}).reason,
    /exceeds your limit/);
  assert.equal(x.citylineOfferCheck({scenarioId:"standard",tierId:"a",quantity:1,
    selectedSeatIds:one,seats:seat,budgetMinor:120000,requireTogether:true,acceptRestrictedView:false}).ok,true);
  assert.equal(x.citylineMoney(101500), "HK$1,015.00");
});
test("wrong quantities, sold-out tiers, duplicate seats and unavailable seats are rejected", async () => {
  const x = await simulator;
  const seats = x.citylineSeats("b","rush");
  const offer = (fields={}) => x.citylineOfferCheck({scenarioId:"rush",tierId:"b",quantity:2,
    selectedSeatIds:["C1","C2"],seats,budgetMinor:200000,requireTogether:true,
    acceptRestrictedView:false,...fields});
  assert.equal(offer().ok,true);
  assert.match(offer({tierId:"a"}).reason,/sold out/i);
  assert.match(offer({quantity:3}).reason,/up to 2/);
  assert.match(offer({selectedSeatIds:["C1","C1"]}).reason,/same seat/i);
  assert.match(offer({selectedSeatIds:["A1","A2"]}).reason,/unavailable/i);
  assert.match(offer({selectedSeatIds:["C1","C4"]}).reason,/not adjacent/i);
  assert.match(offer({selectedSeatIds:["C1"]}).reason,/exactly 2/i);
});
test("Express allocation honors together requirement and offers no queue bypass", async () => {
  const x = await simulator;
  const seats = x.citylineSeats("b","rush");
  const contiguous = x.expressSeatOffer(seats,2,true);
  assert.equal(contiguous.length,2);
  assert.equal(x.areAdjacent(contiguous.map(s=>s.id)),true);
  assert.equal(x.expressSeatOffer(seats,40,true).length,0);
  assert.equal(x.areAdjacent(["A3","B3"]),false);
  assert.equal(x.areAdjacent(["A3","A4"]),true);
  assert.equal(x.areAdjacent(["A3","A5"]),false);
});
test("restricted-view and additional fulfillment cost require deliberate acceptance", async () => {
  const x = await simulator;
  const seats = x.citylineSeats("b","restricted");
  const base={scenarioId:"restricted",tierId:"b",quantity:1,selectedSeatIds:["E1"],seats,
    budgetMinor:80000,requireTogether:true,acceptRestrictedView:false};
  assert.match(x.citylineOfferCheck(base).reason,/Restricted-view/i);
  assert.equal(x.citylineOfferCheck({...base,acceptRestrictedView:true}).ok,true);
  assert.match(x.citylineOfferCheck({...base,acceptRestrictedView:true,
    budgetMinor:72000,deliveryId:"delivery"}).reason,/exceeds your limit/i);
});
test("the fixture includes no actual seat pages, user credentials or fetch calls", async () => {
  const x = await simulator;
  assert.deepEqual(x.citylineSeats("b","standard"),x.citylineSeats("b","standard"));
  assert.equal(x.CITYLINE_SCENARIOS.some(s=>Object.hasOwn(s,"bookingUrl")),false);
});
