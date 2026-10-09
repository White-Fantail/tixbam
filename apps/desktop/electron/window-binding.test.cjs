const test = require("node:test");
const assert = require("node:assert/strict");
const { assertBookingWindow } = require("./booking/window-binding.cjs");

test("live booking reads only the browser explicitly bound to its exact plan", () => {
  const linked = { providerId: "cityline", planId: "plan-one", popup: false };
  assert.equal(assertBookingWindow(linked, "plan-one"), true);
  for (const other of [undefined, null, "plan-two", ""]) {
    assert.throws(() => assertBookingWindow(linked, other), /Booking Plan|another Booking Plan/);
  }
  assert.throws(() => assertBookingWindow({ ...linked, popup: true }, "plan-one"), /main ticketing/);
});

test("unbound legacy watchlist options cannot hijack plan-linked windows", () => {
  const unlinked = { providerId: "cityline", planId: null, popup: false };
  assert.equal(assertBookingWindow(unlinked), true);
  assert.throws(() => assertBookingWindow(unlinked, "plan-one"), /not linked/);
  assert.throws(() => assertBookingWindow(null), /main ticketing/);
});
