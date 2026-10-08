const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../addons/catalog.json");

test("all built-in add-ons have explicit, reviewed automation support levels", () => {
  const valid = new Set(["available", "restricted", "unverified"]);
  assert.equal(catalog.length, 6);
  for (const addon of catalog) {
    assert.match(addon.automation.reviewedAt, /^\\d{4}-\\d{2}-\\d{2}$/);
    for (const level of ["level1", "level2", "level3"]) {
      const item = addon.automation[level];
      assert.ok(valid.has(item.status), addon.id + " " + level + " must have a valid status");
      assert.ok(item.summary, addon.id + " " + level + " must have a reason");
      if (item.sourceUrl) assert.ok(item.sourceUrl.startsWith("https://"));
    }
    assert.equal(addon.automation.level1.status, "available");
    assert.notEqual(addon.automation.level2.status, "available", "L2 is not built or authorized");
    assert.notEqual(addon.automation.level3.status, "available", "L3 is not built or authorized");
  }
});

test("published automation restrictions are not displayed as supported", () => {
  for (const id of ["ticketmaster", "axs", "nol"]) {
    const addon = catalog.find((item) => item.id === id);
    assert.ok(addon);
    assert.equal(addon.automation.level2.status, "restricted");
    assert.equal(addon.automation.level3.status, "restricted");
    assert.ok(addon.automation.level2.sourceUrl);
    assert.ok(addon.automation.level3.sourceUrl);
  }
});
