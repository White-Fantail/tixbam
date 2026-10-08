const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_WINDOWS, isSafeWebUrl, isHostAllowed, resolveStartUrl } = require("./security.cjs");

test("accepts official provider home pages and HTTPS event links", () => {
  assert.equal(resolveStartUrl("cityline").provider.name, "Cityline");
  assert.equal(resolveStartUrl("cityline", "https://venue.cityline.com/utsvInternet/path").url,
    "https://venue.cityline.com/utsvInternet/path");
  assert.equal(resolveStartUrl("yes24", "https://ticket.yes24.com/Pages/Perf/Detail/Detail.aspx?id=123").provider.id, "yes24");
});

test("rejects unknown provider and cross-provider links", () => {
  assert.throws(() => resolveStartUrl("unknown"), /Unknown/);
  assert.throws(() => resolveStartUrl("cityline", "https://www.ticketmaster.com/"), /does not belong/);
});

test("rejects lookalike hosts, unsafe schemes and credential-bearing URLs", () => {
  assert.equal(isHostAllowed("cityline.com.hk.evil.example", ["cityline.com.hk"]), false);
  assert.equal(isHostAllowed("venue.cityline.com", ["cityline.com"]), true);
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "http://cityline.com.hk", "https://user:password@cityline.com.hk", "https://cityline.com.hk.evil.example/"]) {
    assert.throws(() => resolveStartUrl("cityline", url));
  }
  assert.equal(isSafeWebUrl("https://kktix.com/"), true);
  assert.equal(MAX_WINDOWS, 6);
});
