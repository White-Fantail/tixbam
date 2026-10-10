const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_WINDOWS, isSafeWebUrl, isHostAllowed, resolveStartUrl, resolveOfficialSaleUrl } = require("./security.cjs");

test("accepts official provider home pages and HTTPS event links", () => {
  assert.equal(resolveStartUrl("cityline").provider.name, "Cityline");
  assert.equal(resolveStartUrl("cityline", "https://venue.cityline.com/utsvInternet/path").url,
    "https://venue.cityline.com/utsvInternet/path");
  assert.equal(resolveStartUrl("yes24", "https://ticket.yes24.com/Pages/Perf/Detail/Detail.aspx?id=123").provider.id, "yes24");
});

test("registered Ticketmaster regional sale links open under the Ticketmaster add-on", () => {
  const officialLinks = [
    "https://www.ticketmaster.com/event/123",
    "https://www.ticketmaster.ca/event/123",
    "https://www.ticketmaster.co.uk/event/123",
    "https://ticketmaster.co.th/activity/detail/26th_youngk",
    "https://ticketmaster.sg/activity/detail/123",
    "https://www.ticketmaster.dk/event/123",
    "https://www.ticketmaster.de/event/123",
    "https://www.ticketmaster.es/event/aespa-live-tour--synk--complaexity--in-barcelona-entradas/1901386458",
    "https://www.ticketmaster.com.au/event/123",
    "https://www.ticketmaster.co.nz/event/123"
  ];
  for (const url of officialLinks) {
    assert.equal(resolveStartUrl("ticketmaster", url).provider.id, "ticketmaster", url);
    assert.equal(resolveOfficialSaleUrl("ticketmaster", url).providerId, "ticketmaster", url);
  }
});

test("NOL Korean and global ticket sales both resolve to the NOL add-on", () => {
  for (const url of [
    "https://nol.yanolja.com/ticket/products/26012865",
    "https://world.nol.com/en/ticket/places/26001084/products/26012865"
  ]) {
    assert.equal(resolveStartUrl("nol", url).provider.id, "nol", url);
    assert.equal(resolveOfficialSaleUrl("nol", url).providerId, "nol", url);
  }
});

test("regional provider allowlists never admit sibling brands or lookalike domains", () => {
  for (const url of [
    "https://ticketmaster.es.evil.example/",
    "https://ticketmaster.evil.example/",
    "https://faketicketmaster.es/",
    "https://nol.yanolja.com.evil.example/",
    "https://evil-yanolja.com/",
    "https://ticketmaster.es@evil.example/",
    "https://user:secret@ticketmaster.es/",
    "http://ticketmaster.es/"
  ]) {
    assert.throws(() => resolveOfficialSaleUrl("ticketmaster", url), url);
  }
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

test("rejects credential-lookalikes, custom TLS ports, and control character URL injection", () => {
  for(const candidate of [
    "https://cityline.com.hk:8443/events",
    "https://cityline.com.hk:444/events",
    "https://user@cityline.com.hk/",
    "https://cityline.com.hk/\\n<script>",
    "https://cityline.com.hk/\n%0a",
    "https://cityline.com.hk:65535/",
    "https://evil.test:1234/"
  ]){
    assert.equal(isSafeWebUrl(candidate),false,candidate);
  }
  assert.equal(isSafeWebUrl("https://cityline.com.hk:443/"),true);
  assert.equal(isSafeWebUrl("https://venue.cityline.com/utsvInternet/event"),true);
  assert.throws(()=>resolveOfficialSaleUrl("cityline","https://cityline.com.hk:444/events"));
});
