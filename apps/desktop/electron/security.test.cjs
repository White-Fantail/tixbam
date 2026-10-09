const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_WINDOWS, isSafeWebUrl, isHostAllowed, resolveStartUrl, resolveOfficialSaleUrl } = require("./security.cjs");

test("accepts official provider home pages and HTTPS event links", () => {
  assert.equal(resolveStartUrl("cityline").provider.name, "Cityline");
  assert.equal(resolveStartUrl("cityline", "https://venue.cityline.com/utsvInternet/path").url,
    "https://venue.cityline.com/utsvInternet/path");
  assert.equal(resolveStartUrl("yes24", "https://ticket.yes24.com/Pages/Perf/Detail/Detail.aspx?id=123").provider.id, "yes24");
});

test("Cityline sale on a Live Nation event page opens in the Live Nation session", () => {
  const url = "https://www.livenation.hk/en/event/young-k-solo-tour-youngest-in-hong-kong";
  assert.deepEqual(resolveOfficialSaleUrl("cityline", url), { providerId: "livenation", url });
  assert.equal(resolveOfficialSaleUrl("cityline", "https://venue.cityline.com/utsvInternet/path").providerId, "cityline");
  assert.throws(() => resolveStartUrl("cityline", url), /does not belong/);
});

test("sale URLs reject unknown hosts, lookalikes, and unsafe schemes", () => {
  assert.throws(() => resolveOfficialSaleUrl("unknown", "https://www.livenation.hk"), /Unknown/);
  for (const url of [
    "https://cityline.com.hk.evil.example/",
    "https://www.livenation.hk.evil.example/",
    "https://user:pass@www.livenation.hk/",
    "http://www.livenation.hk/",
    "javascript:alert(1)"
  ]) assert.throws(() => resolveOfficialSaleUrl("cityline", url));
  assert.throws(() => resolveOfficialSaleUrl("cityline", "https://example.com/"), /No supported/);
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
