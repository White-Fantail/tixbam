const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../addons/catalog.json");
const { resolveStartUrl, isHostAllowed } = require("./security.cjs");

test("bundled add-ons have unique, valid manifests", () => {
  assert.equal(new Set(catalog.map(addon => addon.id)).size, catalog.length);
  for (const addon of catalog) {
    assert.match(addon.id, /^[a-z][a-z0-9-]*$/);
    assert.match(addon.version, /^\d+\.\d+\.\d+$/);
    assert.ok(addon.name && addon.region && addon.description);
    assert.deepEqual(addon.capabilities, ["browser", "persistent-session"]);
    assert.ok(Array.isArray(addon.allowedHosts) && addon.allowedHosts.length > 0);
    assert.equal(resolveStartUrl(addon.id).url, new URL(addon.url).toString());
    assert.ok(isHostAllowed(new URL(addon.url).hostname, addon.allowedHosts));
    assert.ok(addon.allowedHosts.every(host => /^[a-z0-9.-]+$/.test(host)));
  }
});

test("untrusted and cross-provider URLs are rejected for all add-ons", () => {
  for (const addon of catalog) {
    assert.throws(() => resolveStartUrl(addon.id, "https://example.com/"));
    assert.throws(() => resolveStartUrl(addon.id, "file:///etc/passwd"));
    assert.throws(() => resolveStartUrl(addon.id, "https://user:secret@" + addon.allowedHosts[0] + "/"));
  }
});
