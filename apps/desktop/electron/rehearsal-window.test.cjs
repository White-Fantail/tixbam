const test = require("node:test");
const assert = require("node:assert/strict");
const { rehearsalTarget, findRehearsalBySender } = require("./rehearsal-window.cjs");

const plan = {
  id: "d6d6fd13-92a9-47ab-875c-9f40ad5df621",
  artist: "Sample Artist", title: "Concert", providerId: "cityline",
  currency: "HKD", quantity: 2, budgetMinor: 200000,
  requireTogether: true, allowFallback: false, preferencesReady: true,
  bookingUrl: "https://cityline.com.hk/checkout?queue=SENSITIVE",
  notes: "PRIVATE NOTE", paymentCard: "4111111111111111",
  cvv: "123", cookies: "secret", accountToken: "token",
};
test("native rehearsal target contains only the explicit safe purchase constraints", () => {
  const snapshot = rehearsalTarget(plan);
  assert.deepEqual(Object.keys(snapshot).sort(),
    ["id", "artist", "title", "providerId", "currency", "quantity", "budgetMinor",
      "requireTogether", "allowFallback", "preferencesReady"].sort());
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.quantity, 2);
  assert.equal(snapshot.budgetMinor, 200000);
  const raw = JSON.stringify(snapshot);
  for (const secret of ["SENSITIVE", "PRIVATE NOTE", "4111111111111111",
    "cookies", "accountToken", "cvv", "bookingUrl"]) assert.equal(raw.includes(secret), false);
});
test("invalid plan quantities, prices, currency and identifiers are refused", () => {
  for (const mutation of [
    { quantity: 0 }, { quantity: 22 }, { quantity: 1.4 },
    { budgetMinor: -1 }, { budgetMinor: 2.4 }, { budgetMinor: Number.MAX_VALUE },
    { id: "../escape" }, { id: "__proto__" },
    { currency: "nzd" }, { providerId: "../evil" }, { artist: "" },
    { title: "" }
  ]) {
    assert.throws(() => rehearsalTarget({ ...plan, ...mutation }));
  }
  assert.throws(() => rehearsalTarget(null));
});
test("rehearsal IPC sender matches only the exact live rehearsal window", () => {
  const sender = { id: 34 };
  const fakeWindows = new Map([["one", {
    target: rehearsalTarget(plan), win: {
      isDestroyed: () => false, webContents: sender
    }
  }]]);
  assert.deepEqual(findRehearsalBySender(fakeWindows, sender), fakeWindows.get("one"));
  assert.equal(findRehearsalBySender(fakeWindows, { id: 34 }), null);
  fakeWindows.get("one").win.isDestroyed = () => true;
  assert.equal(findRehearsalBySender(fakeWindows, sender), null);
});
